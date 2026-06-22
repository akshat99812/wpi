/**
 * Wind speed → capacity factor (CUF) — the single intermediate shared by the
 * suitability score (windScoring.ts, Part A) and the financial screening
 * (windFinance.ts, Part B). Methodology §2.
 *
 * Piecewise-linear lookup over a modern-hub (120–140 m) curve, calibrated so a
 * GWA mean speed @100 m maps directly to CUF (e.g. ~5.5 m/s → 0.38). The two
 * outputs share EXACTLY this one value and otherwise never read each other.
 *
 * ⚠️ Feed @100 m speed only. The curve is calibrated to 100 m GWA speed; a
 * different hub height biases everything downstream (methodology §1).
 */

/** cuf curve: ws (m/s @100 m) → capacity factor (fraction 0–1). */
export const WIND_CUF_CURVE: ReadonlyArray<readonly [number, number]> = [
  [4, 0.25],
  [4.5, 0.3],
  [5, 0.34],
  [5.5, 0.38],
  [6, 0.4],
  [6.5, 0.42],
  [7, 0.43],
  [8, 0.45],
  [9, 0.46],
];

/**
 * Interpolated CUF for a mean wind speed @100 m. Clamps to the curve endpoints
 * (≤4 m/s → 0.25, ≥9 m/s → 0.46). A null/non-finite speed returns null — there
 * is then no CUF, so neither the score nor the financials downstream compute.
 */
export function windCuf(ws: number | null): number | null {
  if (ws === null || !Number.isFinite(ws)) return null;
  const c = WIND_CUF_CURVE;
  const first = c[0]!;
  const last = c[c.length - 1]!;
  if (ws <= first[0]) return first[1];
  if (ws >= last[0]) return last[1];
  for (let i = 0; i < c.length - 1; i++) {
    const lo = c[i]!;
    const hi = c[i + 1]!;
    if (lo[0] <= ws && ws <= hi[0]) {
      return lo[1] + (hi[1] - lo[1]) * ((ws - lo[0]) / (hi[0] - lo[0]));
    }
  }
  return last[1];
}
