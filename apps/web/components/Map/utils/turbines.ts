import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { PRIVATE_MASTS_HIT_LAYER_ID } from './privateMasts';

/**
 * Individual wind-turbine overlay for the Pro map (Pro-only): near-black dots
 * from the MVT tiles at /api/tiles/turbines (OSM / OpenInfraMap
 * power=generator + generator:source=wind, ingested into PostGIS). Mirrors the
 * public-mast pins (windmills-pts): a slim visible circle layer plus an
 * oversized transparent hit layer so clicks land easily.
 *
 * Clicking a dot hands its id + coordinates to `onSelect`; the page fetches
 * GET /api/turbine/:id and shows the same kind of detail card the masts use.
 * Turbines yield priority to mast pins where the two overlap (the mast layers'
 * own click handlers own those clicks), so the chain stays deterministic.
 */

const SOURCE_ID = 'turbines';
export const TURBINES_LAYER_ID = 'turbines-pts';
export const TURBINES_HIT_LAYER_ID = 'turbines-hit';

// Near-black — matches the existing turbine SVG marker colour, reads as a dark
// glyph on the light road basemap and (with the white halo) on satellite too.
export const TURBINE_COLOR = '#0b0f17';

// Registered map image id for the little turbine glyph drawn at each point.
const TURBINE_ICON_ID = 'turbine-glyph';

// A compact wind-turbine silhouette: tapered tower + hub + three blades, with a
// white outline baked in so it separates from dark satellite tiles. Rendered at
// 2x and registered via map.addImage so a single symbol layer can stamp it at
// every turbine point (38k+ records — far cheaper than per-point DOM markers).
const TURBINE_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <g fill="none" stroke="#ffffff" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18.7 36 L20 19 L21.3 36 Z"/>
    <path d="M20 18 L20 6"/>
    <path d="M20 18 L30.4 24"/>
    <path d="M20 18 L9.6 24"/>
  </g>
  <g fill="${TURBINE_COLOR}" stroke="none">
    <path d="M18.7 36 L20 19 L21.3 36 Z"/>
    <path d="M19 6 a1 1 0 0 1 2 0 l-0.4 11 a0.6 0.6 0 0 1 -1.2 0 Z"/>
    <path d="M30.4 23 a1 1 0 0 1 -1 1.7 l-9.6 -5.7 a0.6 0.6 0 0 1 0.6 -1 Z"/>
    <path d="M9.6 24.7 a1 1 0 0 1 -1 -1.7 l9.9 -5 a0.6 0.6 0 0 1 0.6 1 Z"/>
  </g>
  <circle cx="20" cy="18" r="2.6" fill="${TURBINE_COLOR}" stroke="#ffffff" stroke-width="1.4"/>
</svg>`;

// Bump to bust the backend disk cache + browser cache after a re-ingestion or
// tile-schema change (mirrors WINDMILL_TILES_VERSION).
export const TURBINE_TILES_VERSION = 1;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

// Mast hit layers that win priority over turbines on overlap. The private-mast
// id comes from its module's exported constant so a rename can't desync it;
// 'windmills-hit' is a page-level literal with no exported constant (matching
// the convention in powerGrid.ts / measureDistance.ts).
const MAST_HIT_LAYERS = ['windmills-hit', PRIVATE_MASTS_HIT_LAYER_ID];

export interface TurbinesOptions {
  /** e.g. "AOI draw armed" — clicks are dropped while it returns true. */
  isInteractionBlocked?: () => boolean;
  /** Fires with the clicked turbine's id + its point coordinates. */
  onSelect?: (id: string, lngLat: { lng: number; lat: number }) => void;
}

interface Handlers {
  onClick: (e: MapMouseEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
}
const registry = new WeakMap<MlMap, Handlers>();

/**
 * Adds the turbine vector source + black-dot layers + interactivity
 * (idempotent). Synchronous: vector tiles load lazily, so there's no fetch to
 * await. Layers go on top so the dots are always visible; the click handler
 * yields to mast pins where they overlap.
 */
/**
 * Registers the turbine glyph as a map image (idempotent). addImage needs a
 * decoded raster, so we rasterise the inline SVG via an <img>; the symbol layer
 * references the id immediately and MapLibre repaints the glyphs in once the
 * async decode lands. pixelRatio:2 keeps it crisp on retina + when scaled up.
 */
function registerTurbineIcon(map: MlMap): void {
  if (map.hasImage(TURBINE_ICON_ID)) return;
  const img = new Image(40, 40);
  img.onload = () => {
    if (!map.hasImage(TURBINE_ICON_ID)) {
      map.addImage(TURBINE_ICON_ID, img, { pixelRatio: 2 });
    }
  };
  img.onerror = (err) =>
    console.error('[turbines] turbine icon failed to load', err);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TURBINE_ICON_SVG)}`;
}

export function addTurbines(map: MlMap, opts: TurbinesOptions = {}): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'vector',
      tiles: [
        `${API_URL}/api/tiles/turbines/{z}/{x}/{y}.mvt?v=${TURBINE_TILES_VERSION}`,
      ],
      minzoom: 4,
      maxzoom: 16,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · ' +
        '<a href="https://openinframap.org" target="_blank" rel="noopener">OpenInfraMap</a>',
    });
  }

  registerTurbineIcon(map);

  if (!map.getLayer(TURBINES_LAYER_ID)) {
    map.addLayer({
      id: TURBINES_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      'source-layer': 'turbines',
      layout: {
        'icon-image': TURBINE_ICON_ID,
        // Smaller than the mast pins — turbines are far more numerous, so a
        // compact glyph keeps dense corridors (TN/GJ) readable.
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          4, 0.6,
          10, 1.1,
          16, 1.9,
        ],
        // Show every turbine — no collision-hiding — and anchor the tower base
        // on the point so the glyph "stands" where the turbine is.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'bottom',
      },
    });
  }

  if (!map.getLayer(TURBINES_HIT_LAYER_ID)) {
    // Oversized transparent hit-target so clicks/hovers catch even when the
    // cursor isn't dead-on the slim dot. Added after the visible layer → on top
    // in event order.
    map.addLayer({
      id: TURBINES_HIT_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      'source-layer': 'turbines',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 7,
          10, 11,
          16, 16,
        ],
        'circle-color': '#000',
        'circle-opacity': 0,
      },
    });
  }

  installInteractivity(map, opts);
}

/** Show/hide the turbine layers (Layers-card toggle). */
export function setTurbinesVisibility(map: MlMap, visible: boolean): void {
  try {
    for (const id of [TURBINES_LAYER_ID, TURBINES_HIT_LAYER_ID]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  } catch (err) {
    console.error('[turbines] could not set visibility', err);
  }
}

function anyMastUnderCursor(map: MlMap, point: { x: number; y: number }): boolean {
  const layers = MAST_HIT_LAYERS.filter((id) => map.getLayer(id));
  if (layers.length === 0) return false;
  return (
    map.queryRenderedFeatures([point.x, point.y] as [number, number], { layers })
      .length > 0
  );
}

function installInteractivity(map: MlMap, opts: TurbinesOptions): void {
  if (registry.has(map)) return;

  const onClick = (e: MapMouseEvent) => {
    // Armed tools (AOI draw / measure) own every map click.
    if (opts.isInteractionBlocked?.()) return;
    if (!map.getLayer(TURBINES_HIT_LAYER_ID)) return;
    // Mast pins win where they overlap a turbine — their handlers own it.
    if (anyMastUnderCursor(map, e.point)) return;
    const feature = map.queryRenderedFeatures(
      [e.point.x, e.point.y] as [number, number],
      { layers: [TURBINES_HIT_LAYER_ID] },
    )[0];
    if (!feature || feature.geometry.type !== 'Point') return;
    const id = feature.properties?.id as string | undefined;
    if (!id) return;
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    opts.onSelect?.(id, { lng, lat });
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', TURBINES_HIT_LAYER_ID, onClick);
  map.on('mouseenter', TURBINES_HIT_LAYER_ID, onEnter);
  map.on('mouseleave', TURBINES_HIT_LAYER_ID, onLeave);
  registry.set(map, { onClick, onEnter, onLeave });
}
