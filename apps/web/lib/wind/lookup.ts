/**
 * Synchronous, metric- and height-aware India wind-resource lookup.
 *
 * Each (metric, height) has its own pre-baked value grid under
 *   /wind-atlas/grids/ — speed: {height}m.json (legacy name), density:
 *   pd-{height}m.json — produced by scripts/build_wind_atlas.py from the GWA
 * v4 data, clipped to India land (incl. J&K + Ladakh). Grid URL templates
 * come from the bake-emitted metadata.json (single source of truth).
 *
 * Grids are fetched lazily the first time a (metric, height) is needed and
 * cached in-module with a small LRU (MAX_CACHED_GRIDS), so `lookupWind` stays
 * synchronous and free to call on every mousemove.
 *
 * `lookupWind` returns null when the grid hasn't loaded yet, or when the
 * point is outside the bbox / over no-data (ocean, outside coverage).
 *
 * Storage note: values are stored as `round(value * scale)` integers; `0` is
 * the no-data sentinel (neither wind speed nor power density is ever 0 over
 * land in this dataset).
 */

import metadata from '@/public/wind-atlas/metadata.json';
import type { WindMetric } from '@/components/Map/utils/windResource';

export type { WindMetric };

export const WIND_HEIGHTS = [50, 100, 150] as const;
export type WindHeight = (typeof WIND_HEIGHTS)[number];
export const DEFAULT_WIND_HEIGHT: WindHeight = 100;

/** Keep at most this many grids in memory (each ~250 KB parsed). */
const MAX_CACHED_GRIDS = 3;

interface Grid {
  bbox:  [number, number, number, number]; // [latMin, lngMin, latMax, lngMax]
  step:  number;
  scale: number;
  shape: [number, number];                  // [rows, cols]
  data:  number[];                          // flat: data[r * cols + c]
}

const grids = new Map<string, Grid>();      // key: `${metric}:${height}`
const loading = new Map<string, Promise<void>>();

function gridKey(metric: WindMetric, height: number): string {
  return `${metric}:${height}`;
}

function gridUrl(metric: WindMetric, height: number): string {
  const m = metadata.metrics[metric];
  return m.gridPath.replace('{height}', String(height));
}

/**
 * Fetch + cache the grid for a (metric, height). Idempotent; safe to call
 * repeatedly. Metric defaults to 'speed' so all pre-existing callers are
 * unchanged.
 */
export function loadWindGrid(
  height: number,
  metric: WindMetric = 'speed',
): Promise<void> {
  const key = gridKey(metric, height);
  if (grids.has(key)) return Promise.resolve();
  let p = loading.get(key);
  if (!p) {
    p = fetch(gridUrl(metric, height))
      .then(r => {
        if (!r.ok) throw new Error(`grid ${key}: HTTP ${r.status}`);
        return r.json();
      })
      .then((g: Grid) => {
        // LRU: Map preserves insertion order — evict the oldest entry.
        while (grids.size >= MAX_CACHED_GRIDS) {
          const oldest = grids.keys().next().value;
          if (oldest === undefined) break;
          grids.delete(oldest);
        }
        grids.set(key, g);
        loading.delete(key);
      })
      // Swallow (don't rethrow) so fire-and-forget callers can't trigger an
      // unhandled rejection; delete the entry so a later call retries cleanly.
      .catch((err: unknown) => {
        loading.delete(key);
        if (typeof console !== 'undefined') {
          console.warn(`[wind] grid ${key} failed to load; will retry on next request`, err);
        }
      });
    loading.set(key, p);
  }
  return p;
}

/** True once the grid is in memory (lookups will resolve). */
export function isWindGridReady(
  height: number,
  metric: WindMetric = 'speed',
): boolean {
  return grids.has(gridKey(metric, height));
}

export function lookupWind(
  lat: number,
  lng: number,
  height: number,
  metric: WindMetric = 'speed',
): number | null {
  const g = grids.get(gridKey(metric, height));
  if (!g) return null;

  const [LAT_MIN, LNG_MIN, LAT_MAX, LNG_MAX] = g.bbox;
  if (lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) return null;

  const STEP = g.step;
  const SCALE = g.scale || 1;
  const [ROWS, COLS] = g.shape;
  const D = g.data;
  const cell = (r: number, c: number) => D[r * COLS + c] ?? 0;

  const fr = (lat - LAT_MIN) / STEP;
  const fc = (lng - LNG_MIN) / STEP;
  const r0 = Math.floor(fr);
  const c0 = Math.floor(fc);
  const r1 = Math.min(r0 + 1, ROWS - 1);
  const c1 = Math.min(c0 + 1, COLS - 1);
  const dr = fr - r0;
  const dc = fc - c0;

  const v00 = cell(r0, c0), v01 = cell(r0, c1), v10 = cell(r1, c0), v11 = cell(r1, c1);

  // Nearest-cell no-data → treat as outside coverage (avoids coastline pull-down).
  const nearest = dr < 0.5 ? (dc < 0.5 ? v00 : v01) : (dc < 0.5 ? v10 : v11);
  if (nearest === 0) return null;

  let acc = 0, wsum = 0;
  for (const [v, w] of [
    [v00, (1 - dr) * (1 - dc)], [v01, (1 - dr) * dc],
    [v10, dr * (1 - dc)],       [v11, dr * dc],
  ] as Array<[number, number]>) {
    if (v === 0) continue;
    acc += v * w; wsum += w;
  }
  if (wsum === 0) return null;
  return acc / wsum / SCALE;
}
