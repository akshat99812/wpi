import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';

/**
 * Offshore-wind overlay (Pro-only): India's NIWE/FOWIND-identified offshore
 * zones (indicative polygons) + VGF/LiDAR project points, plus a `policy`
 * block, all from one GeoJSON (`/api/offshore-wind`).
 *
 * One source feeds four layers, split by the `kind` property:
 *   offshore-zones-fill / -outline   →  kind === 'zone'    (translucent fills)
 *   offshore-projects-pts / -hit     →  kind === 'project' (cyan-stroked dots)
 * Fills sit BELOW the mast/turbine pins (beforeId) so onshore clicks keep
 * priority; the points carry an invisible oversized hit layer like the masts.
 *
 * Clicking a zone or a project hands its properties to the page, which shows
 * them in the OffshoreWindTool card. The one fetch also returns the parsed
 * zones/projects/policy via `onData`, so the card's overview is populated even
 * before anything is clicked (and even while the layer is toggled off).
 */

const SOURCE_ID = 'offshore-wind';
export const OFFSHORE_ZONES_FILL_LAYER_ID = 'offshore-zones-fill';
export const OFFSHORE_ZONES_OUTLINE_LAYER_ID = 'offshore-zones-outline';
export const OFFSHORE_PROJECTS_LAYER_ID = 'offshore-projects-pts';
export const OFFSHORE_PROJECTS_HIT_LAYER_ID = 'offshore-projects-hit';

const ALL_LAYER_IDS = [
  OFFSHORE_ZONES_FILL_LAYER_ID,
  OFFSHORE_ZONES_OUTLINE_LAYER_ID,
  OFFSHORE_PROJECTS_LAYER_ID,
  OFFSHORE_PROJECTS_HIT_LAYER_ID,
];

// Cyan for the offshore zones (reads as "sea", clearly apart from the public
// mast blue #1d9bf0 and the red/amber exclusion fills); orange for the project
// pins. Exported so the Layers-card swatch + legend can't drift from the map.
export const OFFSHORE_ZONE_COLOR = '#06b6d4';
export const OFFSHORE_PROJECT_COLOR = '#f97316';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

/** Properties baked on each `kind: 'zone'` feature. */
export interface OffshoreZoneProps {
  id: string;
  name: string;
  state: string;
  potential_gw: number | null;
  status: string;
  note: string | null;
}

/** Properties baked on each `kind: 'project'` feature. */
export interface OffshoreProjectProps {
  id: string;
  name: string;
  state: string;
  type: string;
  capacity_mw: number | null;
  status: string;
  year: number | null;
  note: string | null;
}

/** One row of the `policy` foreign member on the GeoJSON. */
export interface OffshorePolicyItem {
  key: string;
  label: string;
  value: string;
  detail: string;
  year: number | null;
  source_name: string;
  source_url: string;
}

/** Parsed payload handed to the page once the data loads. */
export interface OffshoreData {
  zones: OffshoreZoneProps[];
  projects: OffshoreProjectProps[];
  policy: OffshorePolicyItem[];
}

export interface OffshoreWindOptions {
  /** e.g. "AOI draw armed" — clicks are dropped while it returns true. */
  isInteractionBlocked?: () => boolean;
  /** Fires with a clicked zone's properties. */
  onSelectZone?: (zone: OffshoreZoneProps) => void;
  /** Fires with a clicked project's properties. */
  onSelectProject?: (project: OffshoreProjectProps) => void;
  /**
   * Fires once AFTER the layers are added, with the parsed
   * zones/projects/policy. The page also uses this to apply the latest toggle
   * state — see addImpl for why this (not an `initialVisible` arg) owns the
   * initial visibility.
   */
  onData?: (data: OffshoreData) => void;
  /** Fires if the fetch fails, with a user-facing message for the panel. */
  onError?: (message: string) => void;
}

interface Handlers {
  onZoneClick: (e: MapMouseEvent) => void;
  onProjectClick: (e: MapMouseEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
}
const registry = new WeakMap<MlMap, Handlers>();
// In-flight/done guard — the add awaits a fetch, so getSource alone can't make
// double calls idempotent (mirrors privateMasts).
const addStarted = new WeakSet<MlMap>();

const num = (v: unknown): number | null =>
  v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
const str = (v: unknown, fallback = ''): string =>
  v != null && v !== '' ? String(v) : fallback;

function toZone(p: Record<string, unknown>): OffshoreZoneProps {
  return {
    id: str(p.id),
    name: str(p.name, 'Offshore zone'),
    state: str(p.state),
    potential_gw: num(p.potential_gw),
    status: str(p.status),
    note: p.note != null && p.note !== '' ? String(p.note) : null,
  };
}

function toProject(p: Record<string, unknown>): OffshoreProjectProps {
  return {
    id: str(p.id),
    name: str(p.name, 'Offshore project'),
    state: str(p.state),
    type: str(p.type),
    capacity_mw: num(p.capacity_mw),
    status: str(p.status),
    year: num(p.year),
    note: p.note != null && p.note !== '' ? String(p.note) : null,
  };
}

/**
 * Fetches the offshore data and adds the zone fills + project pins
 * (idempotent, fire-and-forget). Inserted below the mast pins so onshore
 * clicks keep priority where they (rarely) overlap.
 */
export function addOffshoreWind(map: MlMap, opts: OffshoreWindOptions = {}): void {
  if (addStarted.has(map)) return;
  addStarted.add(map);
  void addImpl(map, opts).catch((err) => {
    addStarted.delete(map); // allow retry on the next toggle
    console.error('[offshore-wind] could not add layer', err);
    opts.onError?.('Could not load offshore-wind data.');
  });
}

async function addImpl(map: MlMap, opts: OffshoreWindOptions): Promise<void> {
  const res = await fetch(`${API_URL}/api/offshore-wind`, {
    credentials: 'include',
  });
  if (!res.ok) {
    // Surface a specific, user-facing message (mirrors the mast/turbine
    // fetches). Return rather than throw so the wrapper's generic onError
    // doesn't clobber it; allow a retry on the next toggle.
    addStarted.delete(map);
    if (res.status === 401) opts.onError?.('Your Pro session ended — please sign in again.');
    else if (res.status === 403) opts.onError?.('Offshore data is a Pro feature.');
    else if (res.status === 429) opts.onError?.('Slow down a bit — too many requests.');
    else opts.onError?.(`Could not load offshore data (${res.status}).`);
    return;
  }
  const data = (await res.json()) as GeoJSON.FeatureCollection & {
    policy?: OffshorePolicyItem[];
  };

  if (!map.getCanvas()) return; // map destroyed while fetching

  // Parse the overview (zones, projects, policy) — handed to the page via
  // onData once the layers are actually added (see below).
  const zones: OffshoreZoneProps[] = [];
  const projects: OffshoreProjectProps[] = [];
  for (const f of data.features ?? []) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    if (p.kind === 'zone') zones.push(toZone(p));
    else if (p.kind === 'project') projects.push(toProject(p));
  }

  if (!map.getSource(SOURCE_ID)) {
    // generateId gives the zone-hover feature-state stable numeric ids. That's
    // safe because the source is loaded once and never setData'd; if live
    // updates are ever added, key hover off feature.properties.id instead.
    map.addSource(SOURCE_ID, { type: 'geojson', data, generateId: true });
  }

  const before = map.getLayer('windmills-pts') ? 'windmills-pts' : undefined;

  if (!map.getLayer(OFFSHORE_ZONES_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: OFFSHORE_ZONES_FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'zone'],
        paint: {
          'fill-color': OFFSHORE_ZONE_COLOR,
          // Brighten the hovered zone so it reads as interactive.
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.35,
            0.18,
          ],
        },
      },
      before,
    );
  }

  if (!map.getLayer(OFFSHORE_ZONES_OUTLINE_LAYER_ID)) {
    map.addLayer(
      {
        id: OFFSHORE_ZONES_OUTLINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'zone'],
        paint: {
          'line-color': OFFSHORE_ZONE_COLOR,
          'line-width': 1.5,
          // Brighten with the fill on hover so the whole zone reads as one.
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            1,
            0.85,
          ],
        },
      },
      before,
    );
  }

  if (!map.getLayer(OFFSHORE_PROJECTS_LAYER_ID)) {
    map.addLayer(
      {
        id: OFFSHORE_PROJECTS_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'project'],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 3,
            10, 5,
            16, 8,
          ],
          'circle-color': OFFSHORE_PROJECT_COLOR,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#0a0a0a',
          'circle-opacity': 0.95,
        },
      },
      before,
    );
  }

  if (!map.getLayer(OFFSHORE_PROJECTS_HIT_LAYER_ID)) {
    // Invisible oversized hit target — same radius ramp as the mast hit layer.
    map.addLayer(
      {
        id: OFFSHORE_PROJECTS_HIT_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'project'],
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

  // Layers exist now — hand the parsed overview to the page. The page's onData
  // handler also re-applies the latest toggle state: its synchronous visibility
  // effect ran while this async add was still in flight (and no-op'd, since the
  // layers didn't exist yet), so onData is the single source of truth for the
  // initial visibility and prevents a default-visible flash.
  opts.onData?.({ zones, projects, policy: data.policy ?? [] });
}

/** Show/hide all four offshore layers (Layers-card toggle). */
export function setOffshoreWindVisibility(map: MlMap, visible: boolean): void {
  try {
    for (const id of ALL_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  } catch (err) {
    console.error('[offshore-wind] could not set visibility', err);
  }
}

function installInteractivity(map: MlMap, opts: OffshoreWindOptions): void {
  if (registry.has(map)) return;

  let hoveredZoneId: number | string | null = null;
  const clearZoneHover = () => {
    if (hoveredZoneId !== null) {
      map.setFeatureState(
        { source: SOURCE_ID, id: hoveredZoneId },
        { hover: false },
      );
      hoveredZoneId = null;
    }
  };

  const onZoneClick = (e: MapMouseEvent) => {
    if (opts.isInteractionBlocked?.()) return;
    // Project pins sit INSIDE the zone polygons, so a pin click also hits the
    // zone fill. Yield to the pins (rendered on top) so the two selections
    // don't race — same pattern as turbines yielding to masts.
    if (
      map.getLayer(OFFSHORE_PROJECTS_HIT_LAYER_ID) &&
      map.queryRenderedFeatures([e.point.x, e.point.y] as [number, number], {
        layers: [OFFSHORE_PROJECTS_HIT_LAYER_ID],
      }).length > 0
    ) {
      return;
    }
    const feat = (
      e as MapMouseEvent & { features?: GeoJSON.Feature[] }
    ).features?.[0];
    if (!feat) return;
    opts.onSelectZone?.(toZone((feat.properties ?? {}) as Record<string, unknown>));
  };

  const onProjectClick = (e: MapMouseEvent) => {
    if (opts.isInteractionBlocked?.()) return;
    if (!map.getLayer(OFFSHORE_PROJECTS_HIT_LAYER_ID)) return;
    const feature = map.queryRenderedFeatures(
      [e.point.x, e.point.y] as [number, number],
      { layers: [OFFSHORE_PROJECTS_HIT_LAYER_ID] },
    )[0];
    if (!feature) return;
    opts.onSelectProject?.(
      toProject((feature.properties ?? {}) as Record<string, unknown>),
    );
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  // Zone hover highlight via feature-state.
  map.on('mousemove', OFFSHORE_ZONES_FILL_LAYER_ID, (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const id = (
      e as MapMouseEvent & { features?: GeoJSON.Feature[] }
    ).features?.[0]?.id;
    if (id == null || id === hoveredZoneId) return;
    clearZoneHover();
    hoveredZoneId = id;
    map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
  });
  map.on('mouseleave', OFFSHORE_ZONES_FILL_LAYER_ID, () => {
    map.getCanvas().style.cursor = '';
    clearZoneHover();
  });

  map.on('click', OFFSHORE_ZONES_FILL_LAYER_ID, onZoneClick);
  map.on('click', OFFSHORE_PROJECTS_HIT_LAYER_ID, onProjectClick);
  map.on('mouseenter', OFFSHORE_PROJECTS_HIT_LAYER_ID, onEnter);
  map.on('mouseleave', OFFSHORE_PROJECTS_HIT_LAYER_ID, onLeave);
  registry.set(map, { onZoneClick, onProjectClick, onEnter, onLeave });
}
