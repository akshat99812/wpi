import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  ValidateNotSelfIntersecting,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import {
  AOI_MAX_KM2,
  POINT_MODE_SQUARE_KM,
  ringAreaKm2,
  squareRingAround,
} from "@/lib/analysis/geometry";

export type AoiDrawMode = "point" | "rectangle" | "polygon";

export interface AoiDrawCallbacks {
  /** Live area while drawing (null = nothing in progress). */
  onLiveArea: (areaKm2: number | null, overCap: boolean) => void;
  /** A shape was completed (ring is closed, lon/lat). */
  onCommit: (ring: [number, number][], mode: AoiDrawMode) => void;
}

const COMMITTED_SOURCE = "aoi-committed";
const COMMITTED_FILL = "aoi-fill";
const COMMITTED_LINE = "aoi-line";
/** Committed-AOI fill layer id — a snap target for the measure tool. */
export const AOI_COMMITTED_FILL_LAYER_ID = COMMITTED_FILL;
const GHOST_SOURCE = "aoi-ghost";
const GHOST_FILL = "aoi-ghost-fill";
const GHOST_LINE = "aoi-ghost-line";

/** Anchor the AOI layers below the mast pins, like the farm boundaries. */
const PIN_LAYER = "windmills-pts";

// Sky palette — deliberately distinct from the windfarm-boundary orange.
const AOI_FILL_COLOR = "#0ea5e9";
const AOI_FILL_OPACITY = 0.15;
const AOI_LINE_COLOR = "#38bdf8";
const AOI_LINE_WIDTH = 1.6;
/** Preview color while the in-progress shape exceeds the 2,500 km² cap. */
const OVER_CAP_COLOR = "#ef4444";

const EMPTY_FC = {
  type: "FeatureCollection",
  features: [],
} as GeoJSON.FeatureCollection;

function ringFeature(ring: [number, number][]): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

export class AoiDrawController {
  private draw: TerraDraw | null = null;
  private armed: AoiDrawMode | null = null;
  private destroyed = false;
  /** True while the in-progress shape exceeds the cap (drives red preview). */
  private liveOverCap = false;
  private readonly onPointMove = (e: MapMouseEvent) => {
    this.setGhost(squareRingAround(e.lngLat.lng, e.lngLat.lat, POINT_MODE_SQUARE_KM));
  };
  private readonly onPointClick = (e: MapMouseEvent) => {
    const ring = squareRingAround(e.lngLat.lng, e.lngLat.lat, POINT_MODE_SQUARE_KM);
    this.disarm();
    this.callbacks.onCommit(ring, "point");
  };
  private readonly onMapMouseOut = () => this.setGhost(null);

  constructor(
    private readonly map: MlMap,
    private readonly callbacks: AoiDrawCallbacks,
  ) {}

  get armedMode(): AoiDrawMode | null {
    return this.armed;
  }

  /** Start (or switch) a selection mode. Cancels any in-progress draw. */
  arm(mode: AoiDrawMode): void {
    if (this.destroyed) return;
    this.disarm();
    this.armed = mode;
    this.map.getCanvas().style.cursor = "crosshair";
    if (mode === "point") {
      this.map.on("mousemove", this.onPointMove);
      this.map.on("click", this.onPointClick);
      this.map.on("mouseout", this.onMapMouseOut);
      return;
    }
    const draw = this.ensureTerraDraw();
    draw.setMode(mode);
  }

  /** Cancel any in-progress draw and leave selection mode. Idempotent. */
  disarm(): void {
    if (this.armed === "point") {
      this.map.off("mousemove", this.onPointMove);
      this.map.off("click", this.onPointClick);
      this.map.off("mouseout", this.onMapMouseOut);
      this.setGhost(null);
    } else if (this.armed && this.draw) {
      try {
        this.draw.clear();
        this.draw.setMode("static");
      } catch (err) {
        console.error("[aoi-draw] could not cancel draw", err);
      }
    }
    if (this.armed) {
      this.armed = null;
      this.map.getCanvas().style.cursor = "";
      this.callbacks.onLiveArea(null, false);
    }
  }

  /** Pan/zoom the map to fit a ring (used after a file upload). */
  fitToRing(ring: [number, number][]): void {
    if (this.destroyed || ring.length === 0) return;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    this.map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 80, maxZoom: 12, duration: 800 },
    );
  }

  setCommitted(ring: [number, number][] | null): void {
    if (this.destroyed) return;
    this.ensureCommittedLayers();
    const src = this.map.getSource(COMMITTED_SOURCE) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      ring
        ? { type: "FeatureCollection", features: [ringFeature(ring)] }
        : EMPTY_FC,
    );
  }

  destroy(): void {
    this.disarm();
    this.destroyed = true;
    if (this.draw) {
      try {
        this.draw.stop();
      } catch (err) {
        console.error("[aoi-draw] terra-draw stop failed", err);
      }
      this.draw = null;
    }
    try {
      for (const id of [COMMITTED_FILL, COMMITTED_LINE, GHOST_FILL, GHOST_LINE]) {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      }
      for (const id of [COMMITTED_SOURCE, GHOST_SOURCE]) {
        if (this.map.getSource(id)) this.map.removeSource(id);
      }
    } catch (err) {
      // Map may already be tearing down (page unmount) — nothing to clean.
      console.error("[aoi-draw] layer cleanup failed", err);
    }
  }

  // ── terra-draw (rectangle + polygon) ──────────────────────────────────────

  private ensureTerraDraw(): TerraDraw {
    if (this.draw) return this.draw;
    let lastReportedArea = -1;
    let lastReportedOverCap = false;
    const reportLiveArea = (area: number, overCap: boolean) => {
      this.liveOverCap = overCap;
      const areaChanged = Math.abs(area - lastReportedArea) >= 0.05;
      if (!areaChanged && overCap === lastReportedOverCap) return;
      lastReportedArea = area;
      lastReportedOverCap = overCap;
      this.callbacks.onLiveArea(area, overCap);
    };
    const capValidation = (
      feature: { geometry: { type: string; coordinates: unknown } },
      context?: { updateType?: string },
    ) => {
      if (feature.geometry.type !== "Polygon") return { valid: true as const };
      const ring =
        (feature.geometry.coordinates as [number, number][][])[0] ?? [];
      const area = ringAreaKm2(ring);
      const overCap = area > AOI_MAX_KM2;
      reportLiveArea(area, overCap);
      if (!overCap) return { valid: true as const };
      // Over cap: preview may keep tracking the cursor; placement may not.
      return context?.updateType === "provisional"
        ? { valid: true as const }
        : { valid: false as const, reason: `Area exceeds ${AOI_MAX_KM2} km²` };
    };
    // Preview turns red while the shape is over the cap.
    const previewFill = () => (this.liveOverCap ? OVER_CAP_COLOR : AOI_FILL_COLOR);
    const previewOutline = () => (this.liveOverCap ? OVER_CAP_COLOR : AOI_LINE_COLOR);

    const adapter = new TerraDrawMapLibreGLAdapter({
      map: this.map,
      ...(this.map.getLayer(PIN_LAYER) ? { renderBelowLayerId: PIN_LAYER } : {}),
    });

    const draw = new TerraDraw({
      adapter,
      modes: [
        new TerraDrawRectangleMode({
          validation: capValidation,
          styles: {
            fillColor: previewFill as never,
            outlineColor: previewOutline as never,
          },
        }),
        new TerraDrawPolygonMode({
          showCoordinatePoints: true,
          styles: {
            fillColor: previewFill as never,
            outlineColor: previewOutline as never,
          },
          validation: (feature, context) => {
            const cap = capValidation(
              feature as never,
              context as { updateType?: string },
            );
            if (!cap.valid) return cap;
            const updateType = (context as { updateType?: string }).updateType;
            if (updateType === "finish" || updateType === "commit") {
              return ValidateNotSelfIntersecting(feature as never);
            }
            return { valid: true };
          },
          keyEvents: { cancel: "Escape", finish: "Enter" },
        }),
      ],
    });
    draw.start();
    draw.setMode("static");

    draw.on("change", (ids, type) => {
      if (type === "delete" || ids.length === 0) return;
      const feat = draw.getSnapshotFeature(ids[0]);
      if (feat?.geometry.type !== "Polygon") return;
      const ring = (feat.geometry.coordinates as [number, number][][])[0] ?? [];
      if (ring.length < 3) return;
      const area = ringAreaKm2(ring);
      reportLiveArea(area, area > AOI_MAX_KM2);
    });

    draw.on("finish", (id) => {
      const feat = draw.getSnapshotFeature(id);
      if (feat?.geometry.type !== "Polygon") return;
      const ring = (feat.geometry.coordinates as [number, number][][])[0] ?? [];
      const mode: AoiDrawMode =
        this.armed === "rectangle" ? "rectangle" : "polygon";
      draw.clear();
      draw.setMode("static");
      this.armed = null;
      this.map.getCanvas().style.cursor = "";
      this.callbacks.onLiveArea(null, false);
      this.callbacks.onCommit(ring as [number, number][], mode);
    });

    this.draw = draw;
    return draw;
  }
  
  private setGhost(ring: [number, number][] | null): void {
    this.ensureGhostLayers();
    const src = this.map.getSource(GHOST_SOURCE) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      ring
        ? { type: "FeatureCollection", features: [ringFeature(ring)] }
        : EMPTY_FC,
    );
  }

  private ensureCommittedLayers(): void {
    if (this.map.getSource(COMMITTED_SOURCE)) return;
    const beforeId = this.map.getLayer(PIN_LAYER) ? PIN_LAYER : undefined;
    this.map.addSource(COMMITTED_SOURCE, { type: "geojson", data: EMPTY_FC });
    this.map.addLayer(
      {
        id: COMMITTED_FILL,
        type: "fill",
        source: COMMITTED_SOURCE,
        paint: { "fill-color": AOI_FILL_COLOR, "fill-opacity": AOI_FILL_OPACITY },
      },
      beforeId,
    );
    this.map.addLayer(
      {
        id: COMMITTED_LINE,
        type: "line",
        source: COMMITTED_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": AOI_LINE_COLOR,
          "line-width": AOI_LINE_WIDTH,
          "line-opacity": 0.95,
        },
      },
      beforeId,
    );
  }

  private ensureGhostLayers(): void {
    if (this.map.getSource(GHOST_SOURCE)) return;
    const beforeId = this.map.getLayer(PIN_LAYER) ? PIN_LAYER : undefined;
    this.map.addSource(GHOST_SOURCE, { type: "geojson", data: EMPTY_FC });
    this.map.addLayer(
      {
        id: GHOST_FILL,
        type: "fill",
        source: GHOST_SOURCE,
        paint: { "fill-color": AOI_FILL_COLOR, "fill-opacity": 0.08 },
      },
      beforeId,
    );
    this.map.addLayer(
      {
        id: GHOST_LINE,
        type: "line",
        source: GHOST_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": AOI_LINE_COLOR,
          "line-width": 1.2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.8,
        },
      },
      beforeId,
    );
  }
}
