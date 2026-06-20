/**
 * energy.ts — CF-engine Phase B (request-path): turbine power-curve capacity
 * factor from the AOI's Weibull distribution.
 *
 * The legacy CF is read straight from GWA's `cf_iec3` raster (one fixed
 * synthetic turbine). This module instead computes the bin-method CF
 *   CF = Σ f(v)·p_norm(v) · dv         (windpowerlib's method, normalised power)
 * over the AOI's area-mean Weibull (A,k) — which resource.ts already derives
 * from the local GWA Weibull COGs — for representative IEC class turbines,
 * with an IEC-61400-12 air-density correction.
 *
 * It runs in SHADOW next to `cf_iec3` (the locked rollout decision): resource.ts
 * logs both and ships the value, but the headline CF stays `cf_iec3` until the
 * comparison is validated against the §11 India benchmarks.
 *
 * Scope note (vs wind-cf-engine-plan.md §5.1): this convolves the AOI's
 * *area-mean* Weibull once per request — no Python, no COG bake, no large
 * artifact. Per-cell CF COGs (convolution per pixel, then area-weight) remain a
 * documented precision upgrade; for a screening AOI the area-mean approximation
 * is close and already far better than a fixed synthetic turbine.
 */

const SEA_LEVEL_AIR_DENSITY_KG_M3 = 1.225;

/** Class labels for the representative IEC turbine power curves. */
export type IecClass = "iec1" | "iec2" | "iec3";

/** Per-class CF triple returned to the resource section. */
export interface PowerCurveCfs {
  iec1: number;
  iec2: number;
  iec3: number;
}

/**
 * Representative NORMALISED power curves (windSpeed m/s → fraction of rated
 * power, 0..1) for the three onshore IEC wind classes. Generic screening
 * curves, not a specific OEM machine: IEC-III (low-wind, large rotor) reaches
 * rated soonest and harvests most at low speed; IEC-I (high-wind, smaller rotor
 * per generator) ramps later. Cut-in 3 m/s, cut-out 25 m/s. Values between
 * tabulated speeds are linearly interpolated; below the first point or above
 * cut-out the output is 0.
 */
export const IEC_POWER_CURVES: Record<
  IecClass,
  ReadonlyArray<readonly [number, number]>
> = {
  iec1: [
    [3, 0.02], [4, 0.05], [5, 0.11], [6, 0.19], [7, 0.31], [8, 0.45],
    [9, 0.6], [10, 0.74], [11, 0.85], [12, 0.93], [13, 0.98], [14, 1.0],
    [25, 1.0],
  ],
  iec2: [
    [3, 0.03], [4, 0.08], [5, 0.16], [6, 0.27], [7, 0.42], [8, 0.59],
    [9, 0.75], [10, 0.88], [11, 0.96], [12, 0.99], [13, 1.0], [25, 1.0],
  ],
  iec3: [
    [3, 0.04], [4, 0.1], [5, 0.2], [6, 0.34], [7, 0.52], [8, 0.7],
    [9, 0.85], [10, 0.95], [11, 0.99], [12, 1.0], [25, 1.0],
  ],
};

/** Cut-out wind speed; above this the turbine is shut down (power 0). */
const CUT_OUT_MS = 25;
/** Numerical-integration step and ceiling over the Weibull pdf (m/s). */
const INTEGRATION_STEP_MS = 0.25;
const INTEGRATION_MAX_MS = 30;

/**
 * Linearly-interpolated normalised power at wind speed `v` for a sorted curve.
 * Returns 0 below the first tabulated speed or above the cut-out speed.
 */
export function interpNormalizedPower(
  curve: ReadonlyArray<readonly [number, number]>,
  v: number,
): number {
  if (!Number.isFinite(v) || v <= 0 || v > CUT_OUT_MS) return 0;
  const first = curve[0];
  if (!first || v < first[0]) return 0;
  for (let i = 1; i < curve.length; i++) {
    const lo = curve[i - 1]!;
    const hi = curve[i]!;
    if (v <= hi[0]) {
      const span = hi[0] - lo[0];
      if (span <= 0) return lo[1];
      const t = (v - lo[0]) / span;
      return lo[1] + t * (hi[1] - lo[1]);
    }
  }
  // Between the last tabulated point and cut-out → hold rated.
  return curve[curve.length - 1]![1];
}

/** Weibull probability density at wind speed `v` for scale A, shape k. */
export function weibullPdf(v: number, A: number, k: number): number {
  if (v < 0 || A <= 0 || k <= 0) return 0;
  if (v === 0) return k === 1 ? 1 / A : 0;
  const ratio = v / A;
  return (k / A) * ratio ** (k - 1) * Math.exp(-(ratio ** k));
}

/**
 * Bin-method capacity factor: ∫ f(v)·p_norm(v_eff) dv over the Weibull pdf,
 * where v_eff = v·(ρ/ρ0)^(1/3) applies the IEC-61400-12 air-density correction
 * (lower density at altitude/heat → lower effective wind → less power).
 * Returns a fraction in [0, 1]. densityRatio defaults to 1 (sea level).
 */
export function grossCapacityFactor(
  A: number,
  k: number,
  curve: ReadonlyArray<readonly [number, number]>,
  densityRatio = 1,
): number {
  if (!(A > 0) || !(k > 0)) return 0;
  const densityShift = Math.cbrt(densityRatio > 0 ? densityRatio : 1);
  let cf = 0;
  for (let v = INTEGRATION_STEP_MS / 2; v < INTEGRATION_MAX_MS; v += INTEGRATION_STEP_MS) {
    const p = interpNormalizedPower(curve, v * densityShift);
    if (p === 0) continue;
    cf += weibullPdf(v, A, k) * p * INTEGRATION_STEP_MS;
  }
  return Math.min(1, Math.max(0, cf));
}

/**
 * CF for all three IEC classes from the AOI Weibull + air-density ratio.
 * Returns null when there is no Weibull distribution (degraded resource).
 */
export function computePowerCurveCfs(
  weibull: { A: number; k: number } | null,
  airDensity: number,
): PowerCurveCfs | null {
  if (!weibull) return null;
  const densityRatio = airDensity / SEA_LEVEL_AIR_DENSITY_KG_M3;
  return {
    iec1: grossCapacityFactor(weibull.A, weibull.k, IEC_POWER_CURVES.iec1, densityRatio),
    iec2: grossCapacityFactor(weibull.A, weibull.k, IEC_POWER_CURVES.iec2, densityRatio),
    iec3: grossCapacityFactor(weibull.A, weibull.k, IEC_POWER_CURVES.iec3, densityRatio),
  };
}
