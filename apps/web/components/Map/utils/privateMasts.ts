import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';

/**
 * Private-mast overlay (Pro-only): yellow circles from /api/private-masts —
 * the proprietary inventory served as GeoJSON, distinct from the blue public
 * WRA masts that arrive as vector tiles. Features carry `hcat`, the same
 * height bucket the public tiles use, so the Layers-card chips filter both
 * layers with one expression (the page sets it on PRIVATE_MASTS_LAYER_ID too).
 *
 * Clicking a pin hands the feature to `onSelect` — the page maps it into the
 * same MastDataTool card the public masts use (absent attributes stay blank).
 */

const SOURCE_ID = 'private-masts';
export const PRIVATE_MASTS_LAYER_ID = 'private-masts-pts';
// Invisible oversized hit target on top of the pins — same radii as the
// public masts' windmills-hit layer, so both feel equally clickable.
export const PRIVATE_MASTS_HIT_LAYER_ID = 'private-masts-hit';

// Amber — clearly separated from the public-mast blue (#1d9bf0) on both
// basemaps; exported for the Layers-card swatch so it can't drift.
export const PRIVATE_MAST_COLOR = '#fbbf24';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

/** What /api/private-masts puts in feature.properties. */
export interface PrivateMastProps {
  name: string;
  heightM: number | null;
  elevationMasl: number | null;
}

export interface PrivateMastsOptions {
  /** e.g. "AOI draw armed" — clicks are dropped while it returns true. */
  isInteractionBlocked?: () => boolean;
  /** Fires with the clicked mast's properties + its true point coordinates. */
  onSelect?: (props: PrivateMastProps, lngLat: { lng: number; lat: number }) => void;
}

interface Handlers {
  onClick: (e: MapMouseEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
}
const registry = new WeakMap<MlMap, Handlers>();
// In-flight/done guard — the add awaits a fetch, so getSource alone can't
// make double calls idempotent.
const addStarted = new WeakSet<MlMap>();

/**
 * Fetches the private masts and adds the source + yellow circle layer
 * (idempotent, fire-and-forget). Inserted below the public mast pins so
 * public-mast clicks keep priority where they overlap.
 */
export function addPrivateMasts(map: MlMap, opts: PrivateMastsOptions = {}): void {
  if (addStarted.has(map)) return;
  addStarted.add(map);
  void addImpl(map, opts).catch((err) => {
    addStarted.delete(map); // allow retry on the next toggle
    console.error('[private-masts] could not add layer', err);
  });
}

async function addImpl(map: MlMap, opts: PrivateMastsOptions): Promise<void> {
  const res = await fetch(`${API_URL}/api/private-masts`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`private masts fetch failed: ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;

  if (!map.getCanvas()) return; // map destroyed while fetching

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data });
  }

  if (!map.getLayer(PRIVATE_MASTS_LAYER_ID)) {
    // Same radius ramp as the public pins so the two read as one family.
    const before = map.getLayer('windmills-pts') ? 'windmills-pts' : undefined;
    map.addLayer(
      {
        id: PRIVATE_MASTS_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 3,
            10, 5,
            16, 9,
          ],
          'circle-color': PRIVATE_MAST_COLOR,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#0a0a0a',
          'circle-opacity': 0.9,
        },
      },
      before,
    );
  }

  if (!map.getLayer(PRIVATE_MASTS_HIT_LAYER_ID)) {
    // Mirrors windmills-hit exactly (radius ramp 10→14→20, fully transparent),
    // inserted at the same anchor so it sits above the visible pins.
    const before = map.getLayer('windmills-pts') ? 'windmills-pts' : undefined;
    map.addLayer(
      {
        id: PRIVATE_MASTS_HIT_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 10,
            10, 14,
            16, 20,
          ],
          'circle-color': '#000',
          'circle-opacity': 0,
        },
      },
      before,
    );
  }

  installInteractivity(map, opts);
}

/** Show/hide the layer + its hit target (Layers-card toggle). */
export function setPrivateMastsVisibility(map: MlMap, visible: boolean): void {
  try {
    for (const id of [PRIVATE_MASTS_LAYER_ID, PRIVATE_MASTS_HIT_LAYER_ID]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  } catch (err) {
    console.error('[private-masts] could not set visibility', err);
  }
}

function installInteractivity(map: MlMap, opts: PrivateMastsOptions): void {
  if (registry.has(map)) return;

  const onClick = (e: MapMouseEvent) => {
    // Respect the page's click-priority chain: nothing while AOI-drawing,
    // and public masts (rendered above) own overlapping clicks.
    if (opts.isInteractionBlocked?.()) return;
    if (!map.getLayer(PRIVATE_MASTS_HIT_LAYER_ID)) return;
    const feature = map.queryRenderedFeatures(
      [e.point.x, e.point.y] as [number, number],
      { layers: [PRIVATE_MASTS_HIT_LAYER_ID] },
    )[0];
    if (!feature || feature.geometry.type !== 'Point') return;
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    const p = feature.properties ?? {};
    opts.onSelect?.(
      {
        name: String(p.name ?? 'Private mast'),
        heightM: p.heightM != null && p.heightM !== '' ? Number(p.heightM) : null,
        elevationMasl:
          p.elevationMasl != null && p.elevationMasl !== ''
            ? Number(p.elevationMasl)
            : null,
      },
      { lng, lat },
    );
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', PRIVATE_MASTS_HIT_LAYER_ID, onClick);
  map.on('mouseenter', PRIVATE_MASTS_HIT_LAYER_ID, onEnter);
  map.on('mouseleave', PRIVATE_MASTS_HIT_LAYER_ID, onLeave);
  registry.set(map, { onClick, onEnter, onLeave });
}
