/**
 * uncertainty.ts — CF-engine Phase D (request-path): P50/P75/P90 exceedance of
 * the net CF from an engineering uncertainty budget.
 *
 *   P_ε = P50 · (1 − z_ε · σ_total),   σ_total = RSS of the component σ's
 *
 * Components are RELATIVE σ (fraction of P50): interannual variability (IAV),
 * model/spatial, power-curve, and loss uncertainty. Per locked decision #5
 * (engineering-grade), IAV is a representative fixed default here; the
 * ERA5-derived per-site IAV raster (wind-cf-engine-plan.md §5.5) is a later
 * precision upgrade. Shadow like B/C — shipped + logged, not the headline.
 */

/** Relative standard deviations (fraction of P50). */
export interface SigmaComponents {
  iav: number;
  model: number;
  powerCurve: number;
  loss: number;
}

/** Defensible defaults: ~10% combined, typical for screening wind estimates. */
export const DEFAULT_SIGMA: SigmaComponents = {
  iav: 0.06, // interannual variability (fixed default; ERA5 per-site later)
  model: 0.06, // reanalysis/GWA spatial-model uncertainty
  powerCurve: 0.03, // generic curve vs real machine
  loss: 0.05, // wake + loss-bucket uncertainty
};

/** One-sided lower-exceedance z-scores (standard normal). */
const Z_P75 = 0.674;
const Z_P90 = 1.282;

/** Total relative σ as the root-sum-square of the components. */
export function combineSigma(c: SigmaComponents): number {
  return Math.sqrt(c.iav ** 2 + c.model ** 2 + c.powerCurve ** 2 + c.loss ** 2);
}

export interface Exceedance {
  p50: number;
  p75: number;
  p90: number;
  /** Combined relative σ used for the bands. */
  sigmaTotal: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * P50/P75/P90 exceedance levels for a P50 (the net CF) and uncertainty budget.
 * P75/P90 are lower exceedances (the value met-or-exceeded 75%/90% of years).
 */
export function computeExceedance(
  p50: number,
  sigma: SigmaComponents = DEFAULT_SIGMA,
): Exceedance {
  const s = combineSigma(sigma);
  return {
    p50: clamp01(p50),
    p75: clamp01(p50 * (1 - Z_P75 * s)),
    p90: clamp01(p50 * (1 - Z_P90 * s)),
    sigmaTotal: s,
  };
}
