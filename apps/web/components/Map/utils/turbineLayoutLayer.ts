import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from "maplibre-gl";
import type { TurbineLayout } from "@/lib/analysis/layout";

/**
 * Renders an uploaded micro-sited turbine layout on the pro-map: one teal dot
 * per exact turbine position, with the selected turbine promoted to a larger
 * orange dot. Clicking a dot fires `onTurbineClick(id)` so the analysis hook can
 * run that turbine's individual 5×5 km screening.
 *
 * The layout's footprint polygon is drawn by the AOI draw controller (via
 * setCommitted) — this controller owns only the point markers, keeping the two
 * concerns independent.
 */

const SRC = "turbine-layout";
const PT_LAYER = "turbine-layout-pts";
const SEL_LAYER = "turbine-layout-selected";

const TURBINE_COLOR = "#2dd4bf"; // teal — distinct from OSM black turbines + orange routes
const SELECTED_COLOR = "#fb923c"; // orange highlight for the active turbine

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export interface TurbineLayoutCallbacks {
  /** A turbine marker was clicked. */
  onTurbineClick: (id: string) => void;
  /** True while another tool owns clicks (AOI draw / measure armed) — turbine
   *  clicks and hover-cursor changes are suppressed so the tools don't collide. */
  isInteractionBlocked?: () => boolean;
}

export class TurbineLayoutController {
  private layout: TurbineLayout | null = null;
  private selectedId: string | null = null;
  private destroyed = false;
  private bound = false;

  private readonly onLayerClick = (e: MapMouseEvent & { features?: GeoJSON.Feature[] }) => {
    // Another tool (AOI draw / measure) owns clicks — ignore turbine clicks so
    // a marker click can't double-commit a draw and wipe the layout.
    if (this.callbacks.isInteractionBlocked?.()) return;
    const id = e.features?.[0]?.properties?.id as string | undefined;
    if (id) this.callbacks.onTurbineClick(id);
  };
  private readonly onEnter = () => {
    // Don't override a draw tool's crosshair cursor while it owns clicks.
    if (this.callbacks.isInteractionBlocked?.()) return;
    this.map.getCanvas().style.cursor = "pointer";
  };
  private readonly onLeave = () => {
    if (this.callbacks.isInteractionBlocked?.()) return;
    this.map.getCanvas().style.cursor = "";
  };

  constructor(
    private readonly map: MlMap,
    private readonly callbacks: TurbineLayoutCallbacks,
  ) {}

  /** Replace the rendered layout (null clears markers + selection). */
  setLayout(layout: TurbineLayout | null): void {
    if (this.destroyed) return;
    this.layout = layout;
    if (!layout) this.selectedId = null;
    this.ensureLayers();
    this.render();
  }

  /** Highlight one turbine (null clears the highlight). */
  setSelected(id: string | null): void {
    if (this.destroyed) return;
    this.selectedId = id;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    try {
      for (const layer of [PT_LAYER, SEL_LAYER]) {
        if (this.bound) {
          this.map.off("click", layer, this.onLayerClick);
          this.map.off("mouseenter", layer, this.onEnter);
          this.map.off("mouseleave", layer, this.onLeave);
        }
        if (this.map.getLayer(layer)) this.map.removeLayer(layer);
      }
      if (this.map.getSource(SRC)) this.map.removeSource(SRC);
      // Drop any lingering "pointer" cursor we set on hover.
      this.map.getCanvas().style.cursor = "";
    } catch (err) {
      // Map may already be tearing down (page unmount) — nothing to clean.
      console.error("[turbine-layout] cleanup failed", err);
    }
  }

  private toFeatureCollection(): GeoJSON.FeatureCollection {
    if (!this.layout) return EMPTY_FC;
    return {
      type: "FeatureCollection",
      features: this.layout.points.map((p) => ({
        type: "Feature",
        properties: {
          id: p.id,
          name: p.name ?? "",
          selected: p.id === this.selectedId,
        },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      })),
    };
  }

  private render(): void {
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(this.toFeatureCollection());
  }

  private ensureLayers(): void {
    if (this.map.getSource(SRC)) return;
    this.map.addSource(SRC, { type: "geojson", data: EMPTY_FC });
    // Base markers (everything not currently selected).
    this.map.addLayer({
      id: PT_LAYER,
      type: "circle",
      source: SRC,
      filter: ["!=", ["get", "selected"], true],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.6, 10, 4, 14, 5.5],
        "circle-color": TURBINE_COLOR,
        "circle-stroke-color": "#0b0f19",
        "circle-stroke-width": 1,
        "circle-opacity": 0.95,
      },
    });
    // Selected marker on top.
    this.map.addLayer({
      id: SEL_LAYER,
      type: "circle",
      source: SRC,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 10, 7, 14, 9],
        "circle-color": SELECTED_COLOR,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
    this.bindInteractions();
  }

  private bindInteractions(): void {
    if (this.bound) return;
    this.bound = true;
    for (const layer of [PT_LAYER, SEL_LAYER]) {
      this.map.on("click", layer, this.onLayerClick);
      this.map.on("mouseenter", layer, this.onEnter);
      this.map.on("mouseleave", layer, this.onLeave);
    }
  }
}
