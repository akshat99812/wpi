/**
 * Synchronous India elevation lookup.
 *
 * Reads from `india-grid.json` (pre-baked at build time from NASA SRTM via
 * Open-Meteo) and returns the bilinearly-interpolated elevation in metres
 * for any lat/lng inside the grid's bbox.
 *
 * Returns `null` if the point lies outside the bbox (we don't extrapolate),
 * or if the grid hasn't been generated yet.
 *
 * Lookup is O(1) with four index reads + simple linear interpolation —
 * essentially free compared to a network round-trip.
 */
import grid from './india-grid.json';

interface GridShape {
  version: number;
  bbox:    [number, number, number, number]; // [latMin, lngMin, latMax, lngMax]
  step:    number;
  shape:   [number, number];                  // [rows, cols]
  data:    number[];                          // flat: data[r * cols + c]
}

const G = grid as unknown as GridShape;
const [LAT_MIN, LNG_MIN, LAT_MAX, LNG_MAX] = G.bbox;
const STEP        = G.step;
const [ROWS, COLS] = G.shape;
const DATA        = G.data;

function cell(r: number, c: number): number {
  return DATA[r * COLS + c] ?? 0;
}

export function lookupElevation(lat: number, lng: number): number | null {
  if (lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) return null;
  if (!DATA || DATA.length === 0) return null;

  const fr = (lat - LAT_MIN) / STEP;
  const fc = (lng - LNG_MIN) / STEP;

  const r0 = Math.floor(fr);
  const c0 = Math.floor(fc);
  const r1 = Math.min(r0 + 1, ROWS - 1);
  const c1 = Math.min(c0 + 1, COLS - 1);
  const dr = fr - r0;
  const dc = fc - c0;

  // Bilinear interpolation over the 4 enclosing cells. Smooths the
  // appearance of elevation transitions as the cursor crosses cell edges.
  const v00 = cell(r0, c0);
  const v01 = cell(r0, c1);
  const v10 = cell(r1, c0);
  const v11 = cell(r1, c1);

  const v0 = v00 * (1 - dc) + v01 * dc;
  const v1 = v10 * (1 - dc) + v11 * dc;
  return v0 * (1 - dr) + v1 * dr;
}

export const GRID_BBOX  = G.bbox;
export const GRID_READY = DATA && DATA.length > 0;
