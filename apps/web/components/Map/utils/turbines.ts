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

// Near-black — matches the existing turbine SVG marker colour, reads as a black
// dot on the light road basemap and (with the light stroke) on satellite too.
export const TURBINE_COLOR = '#0b0f17';

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

  if (!map.getLayer(TURBINES_LAYER_ID)) {
    map.addLayer({
      id: TURBINES_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      'source-layer': 'turbines',
      paint: {
        // Smaller than the mast pins — turbines are far more numerous, so a
        // slimmer dot keeps dense corridors (TN/GJ) readable.
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 2,
          10, 3.5,
          16, 6.5,
        ],
        'circle-color': TURBINE_COLOR,
        // Light hairline so the black dot separates from dark satellite tiles
        // and from clustered neighbours.
        'circle-stroke-color': 'rgba(255,255,255,0.85)',
        'circle-stroke-width': [
          'interpolate', ['linear'], ['zoom'],
          4, 0.4,
          10, 0.8,
          16, 1.2,
        ],
        'circle-opacity': 0.95,
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
