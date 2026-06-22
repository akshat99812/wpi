import type {
  GeoJSONSource,
  Map as MlMap,
  MapLayerMouseEvent,
} from "maplibre-gl";

/**
 * Zoom-out "wind farm" overlay for the Pro map: one WHITE circle per district
 * (WT-MARUT / NIWE installed-capacity data, canonicalised to GADM district
 * centroids server-side — see apps/api/src/routes/windFarms.ts).
 *
 *  - Circle SIZE scales with installed capacity (MW) — bigger farm, bigger dot.
 *  - Circles render ONLY below FARM_CIRCLE_MAXZOOM. Clicking one flies smoothly
 *    in past that zoom, so the circles drop out (MapLibre `maxzoom`) and the
 *    exact turbine glyphs (turbines-pts, min-zoomed to match) take over, while
 *    the page opens a farm-data card.
 */

const SOURCE_ID = "wind-farms";
export const WIND_FARMS_LAYER_ID = "wind-farms-circles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

/** Circles vanish at/above this zoom; exact turbines take over. */
export const FARM_CIRCLE_MAXZOOM = 8;

/** ...and at/below this zoom too — too far out they overlap into a blob, so the
 *  country-overview stays clean. Circles live in the [MINZOOM, MAXZOOM) band. */
export const FARM_CIRCLE_MINZOOM = 4.5;

/** Zoom we fly to on click — past the handoff so turbines are visible. */
const FARM_FOCUS_ZOOM = 9.5;

// Radius (px) by installed MW — area grows with capacity so big farms dominate.
export const CAPACITY_RADIUS_STOPS: [number, number][] = [
  [1, 5],
  [50, 9],
  [200, 14],
  [600, 21],
  [1500, 30],
  [3000, 40],
  [4700, 48],
];

/** Build a MapLibre `interpolate` expression from [input, output] stops. */
function radiusExpr(): unknown[] {
  const expr: unknown[] = ["interpolate", ["linear"], ["get", "capacityMW"]];
  for (const [input, output] of CAPACITY_RADIUS_STOPS) expr.push(input, output);
  return expr;
}

/** Attributes carried by each farm circle (from the served GeoJSON). */
export interface WindFarmProps {
  district: string;
  capacityMW: number;
  weg: number;
  lon: number;
  lat: number;
}

export interface WindFarmsOptions {
  /** Fires with the clicked farm's attributes (page opens the data card). */
  onSelect?: (farm: WindFarmProps) => void;
}

let hoveredId: number | string | null = null;

/** Adds the wind-farm source + white circle layer (idempotent). */
export function addWindFarms(map: MlMap, opts: WindFarmsOptions = {}): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: `${API_URL}/api/wind-farms`,
      // Stable per-feature ids so the hover highlight can use feature-state.
      generateId: true,
      attribution:
        "Wind farms: <a href='https://wtmarut.niwe.res.in' target='_blank' rel='noopener'>WT-MARUT</a> (NIWE/MNRE); centroids: GADM",
    });
  }

  if (!map.getLayer(WIND_FARMS_LAYER_ID)) {
    // Added on top (no beforeId): at zoom-out the circles sit ABOVE everything
    // so the farms read cleanly; past FARM_CIRCLE_MAXZOOM the circles drop out
    // (maxzoom) and the exact turbines take over.
    map.addLayer({
      id: WIND_FARMS_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      minzoom: FARM_CIRCLE_MINZOOM,
      maxzoom: FARM_CIRCLE_MAXZOOM,
      paint: {
        "circle-radius": radiusExpr() as never,
        "circle-color": "#ffffff",
        // Lift the fill + ring slightly on hover for a responsive feel.
        "circle-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          1,
          0.9,
        ] as never,
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          2,
          1.2,
        ] as never,
        "circle-stroke-opacity": 0.6,
        // Smooth the hover transitions (no abrupt jumps).
        "circle-radius-transition": { duration: 160 } as never,
        "circle-stroke-width-transition": { duration: 160 } as never,
      },
    });

    installInteractivity(map, opts);
  }
}

/** Show/hide the wind-farm circles. */
export function setWindFarmsVisibility(map: MlMap, visible: boolean): void {
  try {
    if (map.getLayer(WIND_FARMS_LAYER_ID)) {
      map.setLayoutProperty(
        WIND_FARMS_LAYER_ID,
        "visibility",
        visible ? "visible" : "none",
      );
    }
  } catch (err) {
    console.error("[wind-farms] could not set visibility", err);
  }
}

/** Reload the source data (e.g. after a rebuild). */
export function refreshWindFarms(map: MlMap): void {
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  src?.setData(`${API_URL}/api/wind-farms`);
}

function setHover(map: MlMap, id: number | string | null): void {
  if (hoveredId !== null) {
    map.setFeatureState(
      { source: SOURCE_ID, id: hoveredId },
      { hover: false },
    );
  }
  hoveredId = id;
  if (id !== null) {
    map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
  }
}

function installInteractivity(map: MlMap, opts: WindFarmsOptions): void {
  const onMove = (e: MapLayerMouseEvent) => {
    map.getCanvas().style.cursor = "pointer";
    const id = e.features?.[0]?.id ?? null;
    if (id !== hoveredId) setHover(map, id);
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = "";
    setHover(map, null);
  };
  const onClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f || f.geometry.type !== "Point") return;
    const p = f.properties as {
      district?: string;
      capacityMW?: number;
      weg?: number;
    };
    const [lng, lat] = f.geometry.coordinates as [number, number];
    // Smooth cinematic zoom-in: circles fade out at maxzoom, turbines appear.
    map.flyTo({
      center: [lng, lat],
      zoom: FARM_FOCUS_ZOOM,
      duration: 1600,
      curve: 1.42,
      essential: true,
    });
    opts.onSelect?.({
      district: p.district ?? "",
      capacityMW: p.capacityMW ?? 0,
      weg: p.weg ?? 0,
      lon: lng,
      lat,
    });
  };

  map.on("mousemove", WIND_FARMS_LAYER_ID, onMove);
  map.on("mouseleave", WIND_FARMS_LAYER_ID, onLeave);
  map.on("click", WIND_FARMS_LAYER_ID, onClick);
}
