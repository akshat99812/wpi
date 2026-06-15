import maplibregl from 'maplibre-gl';
import type {
  FilterSpecification,
  LayerSpecification,
  Map as MlMap,
  MapMouseEvent,
} from 'maplibre-gl';

// maplibre-gl v5 doesn't re-export ExpressionSpecification (its bundled
// style-spec d.ts declares the type without exporting it), so derive it from
// an exported data-driven paint property: the expression form is the only
// array-shaped member of that union.
type ExpressionSpecification = Extract<
  NonNullable<
    NonNullable<Extract<LayerSpecification, { type: 'line' }>['paint']>['line-width']
  >,
  unknown[]
>;

/**
 * Electricity-grid overlay for the Pro map: transmission lines (voltage-
 * styled), substations, and wind/solar power plants from OpenInfraMap vector
 * tiles, proxied + disk-cached by our backend
 * (apps/api/src/routes/powerTiles.ts).
 *
 * Tile schema verified 2026-06-10 against live tiles over central India
 * (765 kV Seoni corridor), Muppandal (wind) and Bhadla (solar):
 *  - layer `power_line` (line). `voltage` is a NUMBER already in kV
 *    (11, 132, 220, 765 …). Extra: `voltage_2`, `circuits`, `name`.
 *  - layer `power_substation_point` (point — present at ALL zooms; the
 *    polygon `power_substation` layer only appears at high zoom, so we
 *    render the point layer only). `voltage` is a STRING in kV
 *    ("220.0000000000000000"), plus `voltage_2`/`voltage_3`, `name`,
 *    `operator`.
 *  - layer `power_plant_point` (point — present from low zoom; mirrors the
 *    `power_plant` polygons). `source` values are exactly "wind" / "solar"
 *    (also coal/hydro/gas/nuclear, which we filter out), `output` is a
 *    STRING in MW, plus `name`, `operator`.
 *  - upstream max served zoom: 17 (z18 → 404).
 *
 * India-only clip: OpenInfraMap is global, so the overlay is clipped to a
 * simplified dissolved India outline (public/india-outline.geojson, ~21 KB,
 * generated from the same state boundaries the map already draws) via
 * MapLibre `within` filters, plus a source `bounds` so tiles outside the
 * country's bbox are never fetched. Known tradeoff: a line SEGMENT that
 * crosses the border inside one tile fails `within` and drops entirely —
 * cross-border interconnectors fade out at the border, which is the point.
 *
 * Perf: `within` ray-casts every feature against the outline DURING tile
 * parsing (worker-side), so the outline is deliberately filter-grade —
 * buffered +2 km, simplified to ~1.3k vertices, islet rings dropped. The
 * outline is also awaited BEFORE the layers are created, so tiles are laid
 * out exactly once (adding layers unclipped and re-filtering later would
 * re-parse every loaded tile — visible as a slow first enable).
 */

// ── Source / layer ids ───────────────────────────────────────────────────
const SOURCE_ID = 'power-grid';
const LAYER_CASING = 'power-lines-casing';
const LAYER_LINES = 'power-lines';
const LAYER_SUBSTATIONS = 'power-substations';
const LAYER_PLANTS = 'power-plants';
const ALL_LAYER_IDS = [LAYER_CASING, LAYER_LINES, LAYER_SUBSTATIONS, LAYER_PLANTS];

// Snap targets for the measure tool (queryRenderedFeatures needs the ids).
export const POWER_LINES_LAYER_ID = LAYER_LINES;
export const POWER_LINES_CASING_LAYER_ID = LAYER_CASING;
export const POWER_SUBSTATIONS_LAYER_ID = LAYER_SUBSTATIONS;

// Source-layer names inside the tiles (verified — see header comment).
const SRC_LAYER_LINES = 'power_line';
const SRC_LAYER_SUBSTATIONS = 'power_substation_point';
const SRC_LAYER_PLANTS = 'power_plant_point';

const VOLTAGE_PROP = 'voltage';
const PLANT_SOURCE_PROP = 'source';

// Bump to force a full cache refresh (busts browser + backend disk cache).
export const POWER_TILES_VERSION = 1;
// Verified upstream max served zoom (z18 → 404); mirrored by the proxy clamp.
const VERIFIED_MAX_ZOOM = 17;

// India bbox (from india-outline.geojson) — tiles outside are never fetched.
const INDIA_BOUNDS: [number, number, number, number] = [68.08, 6.74, 97.43, 37.09];
// How long addPowerGrid waits for the outline before adding the layers
// unclipped (applyIndiaClip patches the filters when the fetch lands).
const OUTLINE_WAIT_MS = 1_500;
// Simplified dissolved India outline used by the `within` clip filters.
const INDIA_OUTLINE_URL = '/india-outline.geojson';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

// ── Styling constants (exported — the Layers-card legend imports these) ──
// Verified: tiles carry kV already, so the divisor is 1 (it would be 1000 if
// they shipped raw OSM volts).
const VOLTAGE_DIVISOR = 1;

/** Descending [min kV, colour] bands. OpenInfraMap-style palette. */
export const VOLTAGE_COLORS: [number, string][] = [
  [765, '#00C1CF'], // cyan
  [400, '#B54EB2'], // purple
  [220, '#C73030'], // red
  [132, '#E55C00'], // orange
  [66,  '#B59F10'], // olive
  [33,  '#7A9939'], // green
  [11,  '#6E97B8'], // blue — also catches anything > 0 below 33 kV
];
export const VOLTAGE_UNKNOWN = '#7A7A85';

/** Voltage bands exposed as isolatable chips in the Layers card — one per
 *  VOLTAGE_COLORS entry, highest kV first. Selecting a subset isolates the
 *  grid LINES to those bands (see setPowerGridVoltageFilter). */
export const VOLTAGE_BANDS: { kv: number; color: string }[] =
  VOLTAGE_COLORS.map(([kv, color]) => ({ kv, color }));

export const LOW_VOLTAGE_VISIBLE_ZOOM = 10;
export const EHV_MIN_VOLTAGE = 220; // kV

export const SUBSTATION_MIN_ZOOM = 8;
export const PLANT_MIN_ZOOM = 6; // wind/solar plants are sparse; show earlier

/** Verified `source` values in the tiles for the plants we show. */
export const PLANT_SOURCES = ['wind', 'solar'] as const;
export const PLANT_COLORS: Record<(typeof PLANT_SOURCES)[number], string> = {
  wind:  '#1B8FB5',
  solar: '#F2A93B',
};

// Casing keeps thin lines legible over satellite imagery.
const CASING_COLOR = '#1a1a1a';
const CASING_OPACITY = 0.5;
const CASING_EXTRA_WIDTH = 0.6;

// ── Shared expressions ───────────────────────────────────────────────────
// Substation voltages are strings, line voltages are numbers — to-number
// normalises both; missing voltage becomes 0 (→ "unknown" grey, hidden
// below LOW_VOLTAGE_VISIBLE_ZOOM by the line filter).
const voltageKv: ExpressionSpecification = [
  '/',
  ['to-number', ['get', VOLTAGE_PROP]],
  VOLTAGE_DIVISOR,
];

/** ≥765 cyan, ≥400 purple … >0 blue, else/missing grey. */
function voltageColorExpr(): ExpressionSpecification {
  const expr: unknown[] = ['case'];
  for (const [kv, color] of VOLTAGE_COLORS.slice(0, -1)) {
    expr.push(['>=', voltageKv, kv], color);
  }
  // Last band is the "anything tagged > 0 kV" bucket.
  const last = VOLTAGE_COLORS[VOLTAGE_COLORS.length - 1];
  expr.push(['>', voltageKv, 0], last[1]);
  expr.push(VOLTAGE_UNKNOWN);
  return expr as ExpressionSpecification;
}

/** Zoom-interpolated × voltage-stepped line width (+pad for the casing). */
function lineWidthExpr(pad = 0): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    5,  ['step', voltageKv, 0.35 + pad, 220, 0.55 + pad, 400, 0.8 + pad],
    10, ['step', voltageKv, 0.5 + pad, 66, 0.7 + pad, 220, 1.0 + pad, 400, 1.4 + pad],
    14, ['step', voltageKv, 1.0 + pad, 220, 1.5 + pad, 400, 2.0 + pad],
  ] as ExpressionSpecification;
}

// ── Badge icons (substations + plants) ───────────────────────────────────
// Rounded-square badge in the feature's colour with a white SVG glyph —
// lightning bolt for substations, factory silhouette for plants — rendered
// onto a canvas at runtime via Path2D (no sprite assets). Pre-coloured
// variants instead of SDFs: canvas shapes make poor distance fields and
// the handful of tiny images is cheap.

const SUBSTATION_ICON_PREFIX = 'power-substation-';
const PLANT_ICON_PREFIX = 'power-plant-';
// Drawn at 2× (pixelRatio 2) — 20 px logical.
const ICON_CANVAS_PX = 40;

// 24×24-viewBox SVG path data, filled white onto the badge.
const BOLT_GLYPH = 'M11.5 2 4 13h5l-1 9 7.5-11H10z';
// Sawtooth roof rising into a chimney block on the right.
const FACTORY_GLYPH = 'M2 21V10l5 3v-3l5 3v-3l5 3V4h5v17H2z';

function substationIconId(suffix: string): string {
  return `${SUBSTATION_ICON_PREFIX}${suffix}`;
}

function plantIconId(source: string): string {
  return `${PLANT_ICON_PREFIX}${source}`;
}

function drawBadgeIcon(color: string, glyph: string): ImageData | null {
  const s = ICON_CANVAS_PX;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Badge: rounded square with a dark rim so it separates on the light road
  // basemap (the white glyph carries visibility on satellite).
  const inset = 2.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(inset, inset, s - 2 * inset, s - 2 * inset, 9);
  } else {
    ctx.rect(inset, inset, s - 2 * inset, s - 2 * inset);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(10,14,24,0.9)';
  ctx.stroke();

  // Glyph: scale the 24-unit viewBox into the badge with breathing room.
  const glyphBox = s - 14;
  ctx.save();
  ctx.translate((s - glyphBox) / 2, (s - glyphBox) / 2);
  ctx.scale(glyphBox / 24, glyphBox / 24);
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(glyph));
  ctx.restore();
  return ctx.getImageData(0, 0, s, s);
}

function substationIconEntries(): [string, string][] {
  return [
    ...VOLTAGE_COLORS.map(
      ([kv, color]) => [String(kv), color] as [string, string],
    ),
    ['unknown', VOLTAGE_UNKNOWN],
  ];
}

function ensureSubstationIcons(map: MlMap): void {
  for (const [suffix, color] of substationIconEntries()) {
    const id = substationIconId(suffix);
    if (map.hasImage(id)) continue;
    const img = drawBadgeIcon(color, BOLT_GLYPH);
    if (img) map.addImage(id, img, { pixelRatio: 2 });
  }
}

function ensurePlantIcons(map: MlMap): void {
  for (const source of PLANT_SOURCES) {
    const id = plantIconId(source);
    if (map.hasImage(id)) continue;
    const img = drawBadgeIcon(PLANT_COLORS[source], FACTORY_GLYPH);
    if (img) map.addImage(id, img, { pixelRatio: 2 });
  }
}

/** Same cascade as voltageColorExpr, but resolving to icon names. */
function substationIconExpr(): ExpressionSpecification {
  const expr: unknown[] = ['case'];
  for (const [kv] of VOLTAGE_COLORS.slice(0, -1)) {
    expr.push(['>=', voltageKv, kv], substationIconId(String(kv)));
  }
  const last = VOLTAGE_COLORS[VOLTAGE_COLORS.length - 1];
  expr.push(['>', voltageKv, 0], substationIconId(String(last[0])));
  expr.push(substationIconId('unknown'));
  return expr as ExpressionSpecification;
}

// ── India clip (within-filter) ───────────────────────────────────────────
// The simplified outline is fetched once per session and cached; until it
// arrives (or if it 404s) the layers render unclipped — same as before.
let indiaOutlinePromise: Promise<GeoJSON.Feature | null> | null = null;

function loadIndiaOutline(): Promise<GeoJSON.Feature | null> {
  if (!indiaOutlinePromise) {
    indiaOutlinePromise = fetch(INDIA_OUTLINE_URL)
      .then((res) => (res.ok ? (res.json() as Promise<GeoJSON.Feature>) : null))
      .catch((err) => {
        console.error('[power-grid] india outline fetch failed', err);
        return null;
      });
  }
  return indiaOutlinePromise;
}

/** `["within", outline]` — true for point/line features fully inside India. */
function withinIndiaExpr(outline: GeoJSON.Feature): ExpressionSpecification {
  return ['within', outline] as unknown as ExpressionSpecification;
}

// ── Voltage-band isolation ───────────────────────────────────────────────
// null = all bands (no restriction — identical to the legacy behaviour,
// including unknown-voltage lines). Otherwise the set of selected band-min kV
// from VOLTAGE_BANDS; a strict subset isolates the LINES to those bands.
// Module-level so addPowerGrid / applyIndiaClip rebuild filters with the
// current selection, and a selection set before the layers exist is honoured.
let selectedBandKvs: Set<number> | null = null;

function normalizeBandSelection(selected: Set<number> | null): Set<number> | null {
  if (selected === null) return null;
  if (selected.size >= VOLTAGE_COLORS.length) return null; // all → no restriction
  return new Set(selected);
}

/** Filter for the selected voltage bands: `true` (all → no restriction),
 *  `false` (none → hide every line), or `["any", …ranges]`. The bands
 *  partition (0, ∞) exactly as voltageColorExpr colours them — the lowest is
 *  the ">0" catch-all (the blue bucket), each higher band is [min, nextMin). */
function voltageBandFilterExpr(): unknown {
  if (selectedBandKvs === null) return true;
  if (selectedBandKvs.size === 0) return false;
  const ranges: unknown[] = ['any'];
  for (let i = 0; i < VOLTAGE_COLORS.length; i++) {
    const min = VOLTAGE_COLORS[i][0];
    if (!selectedBandKvs.has(min)) continue;
    const isLast = i === VOLTAGE_COLORS.length - 1;
    const lower = isLast ? ['>', voltageKv, 0] : ['>=', voltageKv, min];
    ranges.push(
      i === 0 ? lower : ['all', lower, ['<', voltageKv, VOLTAGE_COLORS[i - 1][0]]],
    );
  }
  return ranges;
}

/** ["all", …conds] dropping literal `true`s; one condition returns bare, an
 *  empty set collapses to `true`. A literal `false` is KEPT, so a branch with a
 *  false condition evaluates false (the "no bands selected" case). */
function allOf(...conds: unknown[]): unknown {
  const real = conds.filter((c) => c !== true);
  if (real.length === 0) return true;
  if (real.length === 1) return real[0];
  return ['all', ...real];
}

// Below LOW_VOLTAGE_VISIBLE_ZOOM only EHV (≥220 kV) lines render; from there
// everything does. ["zoom"] in a filter is only allowed as input to a
// top-level "step", so the India clip AND the voltage-band filter live INSIDE
// the step's branches rather than wrapped in an outer ["all", …] (which would
// demote the zoom step and fail validation).
function lineFilter(
  outline: GeoJSON.Feature | null,
  bandExpr: unknown = voltageBandFilterExpr(),
): FilterSpecification {
  const within: unknown = outline ? withinIndiaExpr(outline) : true;
  const lowZoom = allOf(['>=', voltageKv, EHV_MIN_VOLTAGE], within, bandExpr);
  const highZoom = allOf(within, bandExpr);
  return [
    'step', ['zoom'],
    lowZoom,
    LOW_VOLTAGE_VISIBLE_ZOOM, highZoom,
  ] as unknown as FilterSpecification;
}

/** Wind/solar-only plants filter, optionally also clipped to India. */
function plantFilter(outline: GeoJSON.Feature | null): FilterSpecification {
  const bySource: unknown = [
    'in',
    ['get', PLANT_SOURCE_PROP],
    ['literal', [...PLANT_SOURCES]],
  ];
  if (!outline) return bySource as FilterSpecification;
  return ['all', bySource, withinIndiaExpr(outline)] as ExpressionSpecification;
}

/** Re-filters all grid layers to India once the outline arrives. */
async function applyIndiaClip(map: MlMap): Promise<void> {
  const outline = await loadIndiaOutline();
  if (!outline) return; // unclipped fallback, already logged
  try {
    if (!map.getCanvas()) return; // map was destroyed while fetching
    const clippedLine = lineFilter(outline);
    if (map.getLayer(LAYER_CASING)) map.setFilter(LAYER_CASING, clippedLine);
    if (map.getLayer(LAYER_LINES)) map.setFilter(LAYER_LINES, clippedLine);
    if (map.getLayer(LAYER_SUBSTATIONS)) {
      map.setFilter(LAYER_SUBSTATIONS, withinIndiaExpr(outline) as FilterSpecification);
    }
    if (map.getLayer(LAYER_PLANTS)) map.setFilter(LAYER_PLANTS, plantFilter(outline));
  } catch (err) {
    console.error('[power-grid] could not apply india clip', err);
  }
}

// ── Per-map listener registry (for clean removal) ────────────────────────
interface GridHandlers {
  onClick: (e: MapMouseEvent) => void;
  cursorLayers: string[];
  onEnter: () => void;
  onLeave: () => void;
  popup: maplibregl.Popup | null;
}
const registry = new WeakMap<MlMap, GridHandlers>();

// ── Public API ───────────────────────────────────────────────────────────

// The caller's latest intent per map — lets a toggle-off that lands while
// addPowerGrid is still awaiting the outline win over the deferred layer add.
const desiredVisible = new WeakMap<MlMap, boolean>();
// Maps with an addPowerGrid layer-add already in flight or done (idempotency
// across the await; the getSource check alone can't see an in-flight add).
const addStarted = new WeakSet<MlMap>();

export interface PowerGridOptions {
  /** Synchronous veto for the popup click handler — true while another tool
   *  (AOI draw, measure) is armed and owns map clicks. */
  isInteractionBlocked?: () => boolean;
}

/**
 * Adds the power-grid source + layers (idempotent) and wires interactivity.
 * Layers are inserted below the mast pins (`windmills-pts`) so existing mast
 * interactions always win.
 *
 * Async inside: waits up to OUTLINE_WAIT_MS for the India outline so the
 * layers are born with their final clip filters (single tile layout pass).
 * Public signature stays sync — callers fire-and-forget, and visibility set
 * via setPowerGridVisibility in the meantime is applied after the add.
 */
export function addPowerGrid(map: MlMap, opts: PowerGridOptions = {}): void {
  if (addStarted.has(map)) return;
  addStarted.add(map);
  void addPowerGridImpl(map, opts).catch((err) => {
    addStarted.delete(map); // allow a retry on the next toggle
    console.error('[power-grid] could not add power grid layers', err);
  });
}

async function addPowerGridImpl(map: MlMap, opts: PowerGridOptions): Promise<void> {
  const outline = await Promise.race([
    loadIndiaOutline(),
    new Promise<null>((r) => setTimeout(() => r(null), OUTLINE_WAIT_MS)),
  ]);
  if (!map.getCanvas()) return;

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'vector',
      tiles: [
        `${API_URL}/api/tiles/power/{z}/{x}/{y}.pbf?v=${POWER_TILES_VERSION}`,
      ],
      maxzoom: VERIFIED_MAX_ZOOM,
      bounds: INDIA_BOUNDS,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · ' +
        '<a href="https://openinframap.org" target="_blank" rel="noopener">OpenInfraMap</a>',
    });
  }

  // Insert below the mast pins when they exist so pins always render (and
  // click) above the grid.
  const before = map.getLayer('windmills-pts') ? 'windmills-pts' : undefined;

  if (!map.getLayer(LAYER_CASING)) {
    map.addLayer(
      {
        id: LAYER_CASING,
        type: 'line',
        source: SOURCE_ID,
        'source-layer': SRC_LAYER_LINES,
        filter: lineFilter(outline),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': CASING_COLOR,
          'line-opacity': CASING_OPACITY,
          'line-width': lineWidthExpr(CASING_EXTRA_WIDTH),
        },
      },
      before,
    );
  }

  if (!map.getLayer(LAYER_LINES)) {
    map.addLayer(
      {
        id: LAYER_LINES,
        type: 'line',
        source: SOURCE_ID,
        'source-layer': SRC_LAYER_LINES,
        filter: lineFilter(outline),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': voltageColorExpr(),
          'line-width': lineWidthExpr(),
        },
      },
      before,
    );
  }

  if (!map.getLayer(LAYER_SUBSTATIONS)) {
    // Bolt-badge icon (canvas-drawn, one per voltage colour — see
    // ensureSubstationIcons). Same voltage cascade as the lines.
    ensureSubstationIcons(map);
    map.addLayer(
      {
        id: LAYER_SUBSTATIONS,
        type: 'symbol',
        source: SOURCE_ID,
        'source-layer': SRC_LAYER_SUBSTATIONS,
        minzoom: SUBSTATION_MIN_ZOOM,
        ...(outline ? { filter: withinIndiaExpr(outline) as FilterSpecification } : {}),
        layout: {
          'icon-image': substationIconExpr(),
          // Icons are drawn 40 px @2x (20 px base): ~11 px at z8 growing
          // to ~22 px at z14.
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            SUBSTATION_MIN_ZOOM, 0.55,
            14, 1.1,
          ],
          // Substations must always render, like the dots did — never
          // drop them to symbol collision.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      },
      before,
    );
  }

  if (!map.getLayer(LAYER_PLANTS)) {
    // Factory-badge icon in the source colour (see ensurePlantIcons).
    ensurePlantIcons(map);
    map.addLayer(
      {
        id: LAYER_PLANTS,
        type: 'symbol',
        source: SOURCE_ID,
        'source-layer': SRC_LAYER_PLANTS,
        minzoom: PLANT_MIN_ZOOM,
        // Wind and solar only — coal/hydro/gas/nuclear excluded.
        filter: plantFilter(outline),
        layout: {
          // The filter guarantees wind|solar; match still needs a default.
          'icon-image': [
            'match', ['get', PLANT_SOURCE_PROP],
            'wind', plantIconId('wind'),
            plantIconId('solar'),
          ],
          // Slightly larger than substations so the two read differently.
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            PLANT_MIN_ZOOM, 0.6,
            14, 1.15,
          ],
          // Plants must always render — never drop to symbol collision.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      },
      before,
    );
  }

  installInteractivity(map, opts);

  // Outline missed the deadline → layers went up unclipped; patch the
  // filters in place when the fetch lands (one extra layout pass, but only
  // on this slow path).
  if (!outline) void applyIndiaClip(map);

  // Honor a toggle that flipped while we awaited the outline — the
  // caller's setPowerGridVisibility was a no-op before the layers existed.
  const visible = desiredVisible.get(map);
  if (visible !== undefined) setPowerGridVisibility(map, visible);
}

/** Removes layers, source, listeners, and any open popup. */
export function removePowerGrid(map: MlMap): void {
  try {
    uninstallInteractivity(map);
    for (const id of ALL_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    for (const [suffix] of substationIconEntries()) {
      const iconId = substationIconId(suffix);
      if (map.hasImage(iconId)) map.removeImage(iconId);
    }
    for (const source of PLANT_SOURCES) {
      const iconId = plantIconId(source);
      if (map.hasImage(iconId)) map.removeImage(iconId);
    }
  } catch (err) {
    console.error('[power-grid] could not remove power grid layers', err);
  }
}

/** Show/hide all grid layers (used by the Layers-card toggle after the
 *  first lazy add). Closes any open grid popup when hiding. */
export function setPowerGridVisibility(map: MlMap, visible: boolean): void {
  try {
    for (const id of ALL_LAYER_IDS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
    if (!visible) registry.get(map)?.popup?.remove();
  } catch (err) {
    console.error('[power-grid] could not set power grid visibility', err);
  }
}

/** Re-applies the current voltage-band selection to the line + casing layers,
 *  preserving the India clip (the cached outline). No-op if the layers aren't
 *  added yet — addPowerGrid reads `selectedBandKvs` when it builds them. */
async function applyLineFilter(map: MlMap): Promise<void> {
  const outline = await loadIndiaOutline();
  try {
    if (!map.getCanvas()) return; // map destroyed while awaiting
    const f = lineFilter(outline);
    if (map.getLayer(LAYER_CASING)) map.setFilter(LAYER_CASING, f);
    if (map.getLayer(LAYER_LINES)) map.setFilter(LAYER_LINES, f);
  } catch (err) {
    console.error('[power-grid] could not apply voltage filter', err);
  }
}

/**
 * Isolate the grid LINES to a set of voltage bands (band-min kV values from
 * VOLTAGE_BANDS). `null` or a full set = no restriction (show all). Only the
 * line + casing layers are filtered — substations and plants are unaffected.
 */
export function setPowerGridVoltageFilter(
  map: MlMap,
  selected: Set<number> | null,
): void {
  selectedBandKvs = normalizeBandSelection(selected);
  void applyLineFilter(map);
}

// ── Interactivity ────────────────────────────────────────────────────────

function installInteractivity(map: MlMap, opts: PowerGridOptions): void {
  if (registry.has(map)) return;

  const onClick = (e: MapMouseEvent) => {
    // 0. An armed tool (AOI draw / measure) owns every map click — no popups.
    if (opts.isInteractionBlocked?.()) return;
    // Priority chain via explicit layer ids — never iterate all features.
    // 1. Masts (existing proprietary pins): if present at the point, bail
    //    entirely; their own layer-scoped handler owns the click.
    if (queryLayer(map, e.point, 'windmills-hit').length > 0) return;

    // 2. Power plants → 3. substations → 4. lines.
    const plant = queryLayer(map, e.point, LAYER_PLANTS)[0];
    if (plant) { openPopup(map, e, plantPopupHtml(plant.properties)); return; }

    const substation = queryLayer(map, e.point, LAYER_SUBSTATIONS)[0];
    if (substation) { openPopup(map, e, substationPopupHtml(substation.properties)); return; }

    const line = queryLayer(map, e.point, LAYER_LINES)[0];
    if (line) openPopup(map, e, linePopupHtml(line.properties));
  };

  const cursorLayers = [LAYER_PLANTS, LAYER_SUBSTATIONS, LAYER_LINES];
  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', onClick);
  for (const id of cursorLayers) {
    map.on('mouseenter', id, onEnter);
    map.on('mouseleave', id, onLeave);
  }

  registry.set(map, { onClick, cursorLayers, onEnter, onLeave, popup: null });
}

function uninstallInteractivity(map: MlMap): void {
  const h = registry.get(map);
  if (!h) return;
  map.off('click', h.onClick);
  for (const id of h.cursorLayers) {
    map.off('mouseenter', id, h.onEnter);
    map.off('mouseleave', id, h.onLeave);
  }
  h.popup?.remove();
  registry.delete(map);
}

function queryLayer(
  map: MlMap,
  point: { x: number; y: number },
  layerId: string,
): maplibregl.MapGeoJSONFeature[] {
  // queryRenderedFeatures throws on unknown layer ids — guard existence.
  if (!map.getLayer(layerId)) return [];
  return map.queryRenderedFeatures(
    [point.x, point.y] as [number, number],
    { layers: [layerId] },
  );
}

function openPopup(map: MlMap, e: MapMouseEvent, html: string): void {
  const h = registry.get(map);
  h?.popup?.remove();
  const popup = new maplibregl.Popup({
    className: 'power-grid-popup',
    closeButton: true,
    maxWidth: '280px',
  })
    .setLngLat(e.lngLat)
    .setHTML(html)
    .addTo(map);
  if (h) h.popup = popup;
}

// ── Popup content (only fields actually present — many OSM features are
//    unnamed) ─────────────────────────────────────────────────────────────

type Props = Record<string, unknown>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "220.0000000000000000" | 220 → "220" (trims float noise). */
function formatKv(v: unknown): string | null {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 10) / 10);
}

function formatMw(v: unknown): string | null {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n * 10) / 10} MW`;
}

function popupHtml(title: string, rows: Array<[string, string | null]>): string {
  const body = rows
    .filter((r): r is [string, string] => r[1] != null)
    .map(
      ([label, value]) =>
        `<div class="pgp-row"><span class="pgp-label">${escapeHtml(label)}</span>` +
        `<span class="pgp-value">${escapeHtml(value)}</span></div>`,
    )
    .join('');
  return `<div class="pgp"><div class="pgp-title">${escapeHtml(title)}</div>${body}</div>`;
}

function plantPopupHtml(p: Props): string {
  const source = String(p[PLANT_SOURCE_PROP] ?? '');
  const label = source === 'wind' ? 'Wind' : source === 'solar' ? 'Solar' : source;
  return popupHtml(typeof p.name === 'string' && p.name ? p.name : 'Power plant', [
    ['Type', label || null],
    ['Capacity', formatMw(p.output)],
    ['Operator', typeof p.operator === 'string' && p.operator ? p.operator : null],
  ]);
}

function substationPopupHtml(p: Props): string {
  // Show the full voltage ladder when tagged (e.g. "765 / 400 / 220 kV").
  const kvs = [p[VOLTAGE_PROP], p.voltage_2, p.voltage_3]
    .map(formatKv)
    .filter((v): v is string => v != null);
  return popupHtml(typeof p.name === 'string' && p.name ? p.name : 'Substation', [
    ['Voltage', kvs.length ? `${kvs.join(' / ')} kV` : null],
    ['Operator', typeof p.operator === 'string' && p.operator ? p.operator : null],
  ]);
}

function linePopupHtml(p: Props): string {
  const kv = formatKv(p[VOLTAGE_PROP]);
  return popupHtml(
    typeof p.name === 'string' && p.name ? p.name : 'Power line',
    [
      ['Voltage', kv ? `${kv} kV` : null],
      ['Circuits', p.circuits != null ? String(p.circuits) : null],
    ],
  );
}
