import type {
  GeoJSONSource,
  Map as MlMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  PointLike,
} from "maplibre-gl";
import { haversineKm } from "@/lib/analysis/geometry";
import { PRIVATE_MASTS_HIT_LAYER_ID } from "./privateMasts";
import {
  POWER_LINES_CASING_LAYER_ID,
  POWER_LINES_LAYER_ID,
  POWER_SUBSTATIONS_LAYER_ID,
} from "./powerGrid";
import { AOI_COMMITTED_FILL_LAYER_ID } from "./aoiDraw";

/**
 * Point-to-point distance measurement for the Pro map, modeled on
 * AoiDrawController: the controller owns the map sources/layers and the
 * click/mousemove handlers; useMeasureDistance owns the React state machine,
 * Esc handling and doubleClickZoom.
 *
 * Lifecycle (phases): idle → armed → onePoint → done. "done" is still armed —
 * the next click starts a fresh measurement (clearing the previous line
 * immediately), so consecutive measurements are fluid. Disarming keeps a
 * completed line on the map; only clear() removes it.
 *
 * Distance is the haversine between the two snapped points — no routing. The
 * line renders as a straight 2-point LineString, deliberately NOT densified
 * into a great-circle arc: at the sub-100 km scales this tool serves, the
 * divergence from the true arc is sub-pixel.
 */

export type MeasurePhase = "idle" | "armed" | "onePoint" | "done";

export interface MeasurePoint {
  /** Snapped [lon, lat]. Coordinates are stored, not feature references — a
   *  measurement anchored to the AOI survives the AOI being cleared. */
  lngLat: [number, number];
  /** What the point snapped to ("Mast", "Substation", … or "Point"). */
  label: string;
}

export interface MeasureState {
  phase: MeasurePhase;
  pointA: MeasurePoint | null;
  pointB: MeasurePoint | null;
  /** Haversine km between A and B once both are placed. */
  distanceKm: number | null;
}

export interface MeasureCallbacks {
  /** Phase / point transitions (never fires per-mousemove). */
  onChange: (state: MeasureState) => void;
  /** Live A→cursor distance while placing point B (null = no ghost).
   *  Deduped to display granularity so it's safe to setState from. */
  onLiveDistance: (km: number | null) => void;
}

const SOURCE = "measure";
const GHOST_SOURCE = "measure-ghost";
const LAYER_GHOST = "measure-ghost-line";
const LAYER_LINE = "measure-line";
const LAYER_POINTS = "measure-points";
const LAYER_LABEL = "measure-label";

/** Half-size (px) of the snap tolerance bbox around the click point. Mast
 *  hit-layers have fat targets already; substation icons and thin lines
 *  don't — the bbox is what makes them snappable at low zoom. */
const SNAP_PX = 5;

// Emerald — unused by the other overlays (AOI sky, boundaries orange,
// private masts yellow, pins blue) and legible on both basemaps.
const MEASURE_COLOR = "#34d399";
const LABEL_HALO_COLOR = "#0f172a";

const EMPTY_FC = {
  type: "FeatureCollection",
  features: [],
} as GeoJSON.FeatureCollection;

/** "412 m" under 1 km, otherwise "3.42 km" / "12.4 km". */
export function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`;
}

export class MeasureController {
  private phase: MeasurePhase = "idle";
  private pointA: MeasurePoint | null = null;
  private pointB: MeasurePoint | null = null;
  private destroyed = false;
  /** Last live distance as displayed — dedupes the per-mousemove callback. */
  private lastLiveLabel: string | null = null;

  constructor(
    private readonly map: MlMap,
    private readonly callbacks: MeasureCallbacks,
  ) {
    // The pro-map basemap toggle is opacity-based (no setStyle), but if a
    // style swap ever lands, re-add our sources/layers and repaint the
    // current measurement — a completed line must survive the swap.
    this.map.on("style.load", this.onStyleReload);
  }

  /** Arm (or re-arm) the tool. A persisted completed line stays — the next
   *  click replaces it. */
  arm(): void {
    if (this.destroyed || this.phase !== "idle") return;
    this.map.getCanvas().style.cursor = "crosshair";
    this.map.on("click", this.onClick);
    this.map.on("mousemove", this.onMove);
    this.map.on("mouseout", this.onMouseOut);
    this.phase = this.pointA && this.pointB ? "done" : "armed";
    this.emit();
  }

  /** Leave the tool. A completed line persists; a half-placed point A is
   *  dropped. Idempotent. */
  disarm(): void {
    if (this.phase === "idle") return;
    this.map.off("click", this.onClick);
    this.map.off("mousemove", this.onMove);
    this.map.off("mouseout", this.onMouseOut);
    this.map.getCanvas().style.cursor = "";
    if (this.phase === "onePoint") {
      this.pointA = null;
      this.setGhost(null);
      this.refreshCommitted();
    }
    this.phase = "idle";
    this.emit();
  }

  /** Esc while placing point B: drop A, back to armed. */
  resetToArmed(): void {
    if (this.phase !== "onePoint") return;
    this.pointA = null;
    this.setGhost(null);
    this.phase = "armed";
    this.refreshCommitted();
    this.emit();
  }

  /** Remove the measurement entirely and leave the tool. */
  clear(): void {
    this.disarm();
    if (!this.pointA && !this.pointB) return;
    this.pointA = null;
    this.pointB = null;
    this.refreshCommitted();
    this.emit();
  }

  destroy(): void {
    this.disarm();
    this.destroyed = true;
    this.map.off("style.load", this.onStyleReload);
    try {
      for (const id of [LAYER_LABEL, LAYER_POINTS, LAYER_LINE, LAYER_GHOST]) {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      }
      for (const id of [SOURCE, GHOST_SOURCE]) {
        if (this.map.getSource(id)) this.map.removeSource(id);
      }
    } catch (err) {
      // Map may already be tearing down (page unmount) — nothing to clean.
      console.error("[measure] layer cleanup failed", err);
    }
  }

  // ── map event handlers ────────────────────────────────────────────────────

  private readonly onClick = (e: MapMouseEvent) => {
    if (this.phase === "armed" || this.phase === "done") {
      // First click of a fresh measurement clears the previous line
      // immediately (not after point B).
      this.pointA = this.snap(e);
      this.pointB = null;
      this.phase = "onePoint";
      this.refreshCommitted();
      this.emit();
      return;
    }
    if (this.phase === "onePoint" && this.pointA) {
      // A genuine A=B click is allowed and just reads 0 m.
      this.pointB = this.snap(e);
      this.phase = "done";
      this.setGhost(null);
      this.refreshCommitted();
      this.emit();
    }
  };

  private readonly onMove = (e: MapMouseEvent) => {
    // Re-assert the crosshair when nothing else owns the cursor: the mast
    // hit-layers' mouseleave resets it to "" (their pointer-on-hover is kept
    // as a "this will snap" affordance, but must not eat the crosshair).
    const canvas = this.map.getCanvas();
    if (canvas.style.cursor === "") canvas.style.cursor = "crosshair";
    if (this.phase !== "onePoint" || !this.pointA) return;
    const cursor: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    this.setGhost(cursor);
    this.reportLive(haversineKm(this.pointA.lngLat, cursor));
  };

  private readonly onMouseOut = () => {
    this.setGhost(null);
  };

  private readonly onStyleReload = () => {
    if (this.destroyed) return;
    // Ghost state is not repainted (it reappears on the next mousemove);
    // the committed line + label always come back.
    this.refreshCommitted();
  };

  // ── snapping ──────────────────────────────────────────────────────────────

  /** Snap a click to the highest-priority target under a tolerance bbox:
   *  mast > private mast > substation > transmission line > AOI polygon >
   *  free point. queryRenderedFeatures only sees rendered features, so
   *  toggled-off layers and below-minzoom pins correctly don't snap —
   *  that's intentional, not accidental. */
  private snap(e: MapMouseEvent): MeasurePoint {
    const { x, y } = e.point;
    const bbox: [PointLike, PointLike] = [
      [x - SNAP_PX, y - SNAP_PX],
      [x + SNAP_PX, y + SNAP_PX],
    ];
    const query = (layerId: string): MapGeoJSONFeature[] => {
      // Grid / AOI layers are created lazily and queryRenderedFeatures
      // throws on unknown layer ids — guard existence per layer.
      if (!this.map.getLayer(layerId)) return [];
      return this.map.queryRenderedFeatures(bbox, { layers: [layerId] });
    };
    const featurePoint = (feat: MapGeoJSONFeature): [number, number] | null =>
      feat.geometry.type === "Point"
        ? (feat.geometry.coordinates as [number, number])
        : null;
    const clickSpot: [number, number] = [e.lngLat.lng, e.lngLat.lat];

    const mast = query("windmills-hit").map(featurePoint).find(Boolean);
    // NIWE tiles ship only id + hcat — the station name isn't available
    // client-side without a detail fetch, so the label is just "Mast".
    if (mast) return { lngLat: mast, label: "Mast" };

    const pvtFeat = query(PRIVATE_MASTS_HIT_LAYER_ID)[0];
    if (pvtFeat) {
      const pt = featurePoint(pvtFeat);
      if (pt) {
        const name = pvtFeat.properties?.name;
        return {
          lngLat: pt,
          label:
            typeof name === "string" && name
              ? `Mast (PVT) · ${name}`
              : "Mast (PVT)",
        };
      }
    }

    const substation = query(POWER_SUBSTATIONS_LAYER_ID)
      .map(featurePoint)
      .find(Boolean);
    if (substation) return { lngLat: substation, label: "Substation" };

    // Line + AOI snaps use the click SPOT on the feature, not a
    // nearest-point projection — that's the v2 fancy version.
    const lineHit =
      query(POWER_LINES_LAYER_ID).length > 0 ||
      query(POWER_LINES_CASING_LAYER_ID).length > 0;
    if (lineHit) return { lngLat: clickSpot, label: "Transmission line" };

    if (query(AOI_COMMITTED_FILL_LAYER_ID).length > 0) {
      return { lngLat: clickSpot, label: "AOI polygon" };
    }

    return { lngLat: clickSpot, label: "Point" };
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private emit(): void {
    this.callbacks.onChange({
      phase: this.phase,
      pointA: this.pointA,
      pointB: this.pointB,
      distanceKm:
        this.pointA && this.pointB
          ? haversineKm(this.pointA.lngLat, this.pointB.lngLat)
          : null,
    });
  }

  private reportLive(km: number | null): void {
    const label = km == null ? null : formatDistanceKm(km);
    if (label === this.lastLiveLabel) return;
    this.lastLiveLabel = label;
    this.callbacks.onLiveDistance(km);
  }

  private setGhost(cursor: [number, number] | null): void {
    this.ensureLayers();
    const src = this.map.getSource(GHOST_SOURCE) as GeoJSONSource | undefined;
    if (!src) return;
    if (!cursor || !this.pointA) {
      this.reportLive(null);
      src.setData(EMPTY_FC);
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [this.pointA.lngLat, cursor],
          },
        },
      ],
    });
  }

  private refreshCommitted(): void {
    this.ensureLayers();
    const src = this.map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(this.committedFc());
  }

  private committedFc(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    const a = this.pointA;
    const b = this.pointB;
    if (a) features.push(endpointFeature(a.lngLat));
    if (a && b) {
      features.push(endpointFeature(b.lngLat));
      features.push({
        type: "Feature",
        properties: { role: "line" },
        geometry: { type: "LineString", coordinates: [a.lngLat, b.lngLat] },
      });
      // The label is its own Point feature at the midpoint: keeps the text
      // horizontal (symbol-placement: line-center rotates with the line).
      const mid: [number, number] = [
        (a.lngLat[0] + b.lngLat[0]) / 2,
        (a.lngLat[1] + b.lngLat[1]) / 2,
      ];
      features.push({
        type: "Feature",
        properties: {
          role: "label",
          label: formatDistanceKm(haversineKm(a.lngLat, b.lngLat)),
        },
        geometry: { type: "Point", coordinates: mid },
      });
    }
    return { type: "FeatureCollection", features };
  }

  /** Idempotent. No beforeId: measurement layers go on top of everything,
   *  including the mast pins — they're transient tooling, never data. */
  private ensureLayers(): void {
    if (this.map.getSource(SOURCE)) return;
    this.map.addSource(SOURCE, { type: "geojson", data: EMPTY_FC });
    this.map.addSource(GHOST_SOURCE, { type: "geojson", data: EMPTY_FC });
    this.map.addLayer({
      id: LAYER_GHOST,
      type: "line",
      source: GHOST_SOURCE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": MEASURE_COLOR,
        "line-width": 1.8,
        "line-dasharray": [2, 2],
        "line-opacity": 0.8,
      },
    });
    this.map.addLayer({
      id: LAYER_LINE,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "role"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": MEASURE_COLOR,
        "line-width": 2.2,
        "line-opacity": 0.95,
      },
    });
    this.map.addLayer({
      id: LAYER_POINTS,
      type: "circle",
      source: SOURCE,
      // Endpoints only — the midpoint label is also a Point feature.
      filter: ["==", ["get", "role"], "endpoint"],
      paint: {
        "circle-radius": 4.5,
        "circle-color": MEASURE_COLOR,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#0a0a0a",
      },
    });
    this.map.addLayer({
      id: LAYER_LABEL,
      type: "symbol",
      source: SOURCE,
      filter: ["==", ["get", "role"], "label"],
      layout: {
        "text-field": ["get", "label"],
        // Stack served by the OpenFreeMap glyph endpoint the basemap uses.
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-offset": [0, -0.9],
        // The label must always render, even over dense pin clusters.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
        // Halo keeps the readout legible over satellite imagery.
        "text-halo-color": LABEL_HALO_COLOR,
        "text-halo-width": 1.4,
      },
    });
  }
}

function endpointFeature(lngLat: [number, number]): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { role: "endpoint" },
    geometry: { type: "Point", coordinates: lngLat },
  };
}
