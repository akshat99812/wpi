import maplibregl, {
  type LayerSpecification,
  type Map as MlMap,
  type MapMouseEvent,
} from 'maplibre-gl';
import { TURBINES_HIT_LAYER_ID } from './turbines';
import { PRIVATE_MASTS_HIT_LAYER_ID } from './privateMasts';

// maplibre-gl v5 doesn't re-export ExpressionSpecification (mirrors powerGrid.ts):
// derive it as the array-shaped member of a data-driven paint property's union.
type ExpressionSpecification = Extract<
  NonNullable<NonNullable<Extract<LayerSpecification, { type: 'line' }>['paint']>['line-width']>,
  unknown[]
>;

/**
 * Legal exclusion-zone overlay for the Pro map (Pro-only). Semi-transparent
 * fills from /api/tiles/exclusions: RED = hard exclusion (notified legal
 * boundary / strict layer), AMBER = verify-before-use. Polygons come from
 * wce.excl_polygon + wce.excl_buffer (loaded by scripts/ingest-exclusions.ts).
 *
 * Fills sit BELOW the point layers (masts, turbines) so those stay clickable.
 * Clicking a zone opens a small popup explaining the "why" — layer, class,
 * legal-vs-screening, and per-source provenance fetched once from
 * /api/exclusion-sources.
 */

const SOURCE_ID = 'exclusions';
const SOURCE_LAYER = 'exclusions';
export const EXCL_FILL_LAYER_ID = 'exclusions-fill';
export const EXCL_OUTLINE_LAYER_ID = 'exclusions-outline';

// red-600 / amber-600 — read on both the light road basemap and satellite.
export const EXCL_RED = '#dc2626';
export const EXCL_AMBER = '#d97706';

// Bump to bust the browser cache after a re-bake / tile-schema change.
export const EXCLUSION_TILES_VERSION = 3;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

// Point hit layers that win priority over exclusion fills on overlap — their
// own click handlers own those clicks (a click on a turbine opens its card).
const POINT_HIT_LAYERS = [TURBINES_HIT_LAYER_ID, 'windmills-hit', PRIVATE_MASTS_HIT_LAYER_ID];

// Human-readable layer labels for the popup (falls back to the raw code).
// Exported so the site-analysis exclusion breakdown reuses the same names.
export const LAYER_LABELS: Record<string, string> = {
  crz_1: 'CRZ-I (coastal, no-development)',
  crz_other: 'CRZ-II/III/IV (coastal)',
  ramsar: 'Ramsar wetland',
  wetland_notified: 'Notified wetland',
  wetland_inventory: 'Wetland (inventory — screening)',
  forest_legal: 'Reserved / Protected Forest',
  forest_cover: 'Forest cover (screening)',
  national_park: 'National Park',
  wildlife_sanctuary: 'Wildlife Sanctuary',
  conservation_reserve: 'Conservation Reserve',
  community_reserve: 'Community Reserve',
  tiger_reserve_core: 'Tiger Reserve (core)',
  esz_notified: 'Eco-Sensitive Zone (notified)',
  esz_default_10km: 'Eco-Sensitive Zone (default 10 km)',
  asi_prohibited_100m: 'ASI prohibited (100 m)',
  asi_regulated_300m: 'ASI regulated (300 m)',
  settlement_500m: 'Settlement setback (500 m)',
};

/** Full provenance row from /api/exclusion-sources (wce.source_registry). */
export interface ExclusionSource {
  source_id: string;
  layer_code: string | null;
  class: string | null;
  legal_tier: number;
  is_legal_boundary: boolean;
  license: string;
  authority: string | null;
  notes: string | null;
}

let exclusionSourcesCache: ExclusionSource[] | null = null;
let exclusionSourcesPromise: Promise<ExclusionSource[]> | null = null;

/** Fetch (once, cached) the exclusion data-source registry — used by the
 *  site-analysis "sources" popover. Pro-gated; degrades to [] on any failure. */
export async function fetchExclusionSources(): Promise<ExclusionSource[]> {
  if (exclusionSourcesCache) return exclusionSourcesCache;
  if (!exclusionSourcesPromise) {
    exclusionSourcesPromise = fetch(`${API_URL}/api/exclusion-sources`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? (r.json() as Promise<ExclusionSource[]>) : []))
      .then((rows) => {
        exclusionSourcesCache = Array.isArray(rows) ? rows : [];
        return exclusionSourcesCache;
      })
      .catch(() => [] as ExclusionSource[]);
  }
  return exclusionSourcesPromise;
}

type SourceMeta = {
  source_id: string;
  legal_tier: number;
  is_legal_boundary: boolean;
  license: string;
  authority: string | null;
  notes: string | null;
};
let sourceMetaCache: Record<string, SourceMeta> | null = null;
let sourceMetaPromise: Promise<Record<string, SourceMeta>> | null = null;

async function loadSourceMeta(): Promise<Record<string, SourceMeta>> {
  if (sourceMetaCache) return sourceMetaCache;
  if (!sourceMetaPromise) {
    sourceMetaPromise = fetch(`${API_URL}/api/exclusion-sources`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SourceMeta[]) => {
        sourceMetaCache = Object.fromEntries(rows.map((r) => [r.source_id, r]));
        return sourceMetaCache;
      })
      .catch(() => ({}) as Record<string, SourceMeta>);
  }
  return sourceMetaPromise;
}

export interface ExclusionsOptions {
  /** e.g. "AOI draw armed" — clicks are dropped while it returns true. */
  isInteractionBlocked?: () => boolean;
  /** Layer id to insert the fills BEFORE (keeps them under point markers). */
  beforeId?: string;
}

const registry = new WeakMap<MlMap, (e: MapMouseEvent) => void>();

/** First of the candidate ids that currently exists on the map. */
function firstExistingLayer(map: MlMap, ids: string[]): string | undefined {
  return ids.find((id) => map.getLayer(id));
}

export function addExclusions(map: MlMap, opts: ExclusionsOptions = {}): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'vector',
      tiles: [`${API_URL}/api/tiles/exclusions/{z}/{x}/{y}.mvt?v=${EXCLUSION_TILES_VERSION}`],
      // Baked z4–14 so zones stay visible when zoomed out (the map's min zoom is 4).
      minzoom: 4,
      // MapLibre overzooms 14 → 16 (reuses z14 tiles), so the client never
      // requests z15/16 — fewer tiles, same on-screen detail.
      maxzoom: 14,
      attribution:
        'Exclusion zones: NCSCM/Parivesh, PM GatiShakti, SOI, FSI · ' +
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    });
  }

  // Insert below the lowest point layer so masts/turbines stay clickable on top.
  const beforeId =
    opts.beforeId && map.getLayer(opts.beforeId)
      ? opts.beforeId
      : firstExistingLayer(map, POINT_HIT_LAYERS);

  const fillColor: ExpressionSpecification = [
    'match', ['get', 'cls'], 'red', EXCL_RED, 'amber', EXCL_AMBER, '#64748b',
  ];

  if (!map.getLayer(EXCL_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: EXCL_FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        'source-layer': SOURCE_LAYER,
        paint: {
          'fill-color': fillColor,
          // Derived buffers (ESZ-default/ASI/settlement) render softer than the
          // downloaded legal zones so the eye reads them as advisory.
          'fill-opacity': ['case', ['==', ['get', 'kind'], 'buffer'], 0.15, 0.3],
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(EXCL_OUTLINE_LAYER_ID)) {
    map.addLayer(
      {
        id: EXCL_OUTLINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        'source-layer': SOURCE_LAYER,
        paint: {
          'line-color': fillColor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.2],
          'line-opacity': 0.85,
        },
      },
      beforeId,
    );
  }

  installInteractivity(map, opts);
}

/** Show/hide the exclusion layers (Layers-card toggle). */
export function setExclusionsVisibility(map: MlMap, visible: boolean): void {
  try {
    for (const id of [EXCL_FILL_LAYER_ID, EXCL_OUTLINE_LAYER_ID]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  } catch (err) {
    console.error('[exclusions] could not set visibility', err);
  }
}

function anyPointUnderCursor(map: MlMap, point: { x: number; y: number }): boolean {
  const layers = POINT_HIT_LAYERS.filter((id) => map.getLayer(id));
  if (layers.length === 0) return false;
  return (
    map.queryRenderedFeatures([point.x, point.y] as [number, number], { layers }).length > 0
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function popupHtml(props: Record<string, unknown>, meta?: SourceMeta): string {
  const lc = String(props.lc ?? '');
  const cls = String(props.cls ?? '');
  const legal = props.legal === true || props.legal === 'true';
  const label = LAYER_LABELS[lc] ?? lc;
  const clsColor = cls === 'red' ? EXCL_RED : EXCL_AMBER;
  const clsText = cls === 'red' ? 'Hard exclusion' : 'Verify before use';
  const status = legal
    ? 'Legal boundary'
    : 'Indicative / screening — verify against the gazette';
  const tier = meta ? `tier ${meta.legal_tier}` : '';
  const src = meta?.authority || String(props.src ?? '');
  const note = meta?.notes
    ? `<div style="margin-top:6px;color:#94a3b8;font-size:11px;line-height:1.4">${escapeHtml(meta.notes)}</div>`
    : '';
  return `
    <div style="font-family:system-ui,sans-serif;max-width:240px">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;color:#0f172a">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${clsColor}"></span>
        ${escapeHtml(label)}
      </div>
      <div style="margin-top:4px;font-size:12px;color:${clsColor};font-weight:600">${clsText}</div>
      <div style="margin-top:2px;font-size:11px;color:#475569">${escapeHtml(status)}</div>
      <div style="margin-top:6px;font-size:11px;color:#64748b">${escapeHtml(src)}${tier ? ` · ${tier}` : ''}</div>
      ${note}
    </div>`;
}

function installInteractivity(map: MlMap, opts: ExclusionsOptions): void {
  if (registry.has(map)) return;

  const onClick = (e: MapMouseEvent) => {
    if (opts.isInteractionBlocked?.()) return;
    if (!map.getLayer(EXCL_FILL_LAYER_ID)) return;
    // Don't open a zone popup if a clickable point sits under the cursor.
    if (anyPointUnderCursor(map, e.point)) return;
    const feature = map.queryRenderedFeatures([e.point.x, e.point.y] as [number, number], {
      layers: [EXCL_FILL_LAYER_ID],
    })[0];
    if (!feature) return;
    const props = feature.properties ?? {};
    void loadSourceMeta().then((meta) => {
      new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setHTML(popupHtml(props, meta[String(props.src ?? '')]))
        .addTo(map);
    });
  };

  map.on('click', EXCL_FILL_LAYER_ID, onClick);
  map.on('mouseenter', EXCL_FILL_LAYER_ID, () => {
    if (!opts.isInteractionBlocked?.()) map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', EXCL_FILL_LAYER_ID, () => {
    map.getCanvas().style.cursor = '';
  });
  registry.set(map, onClick);
}
