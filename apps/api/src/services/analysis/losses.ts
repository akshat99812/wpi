/**
 * losses.ts — CF-engine Phase C (request-path): wake + IEC-61400-15 loss buckets
 * that turn the gross power-curve CF (energy.ts) into a NET, bankable CF, plus a
 * loss waterfall for the report.
 *
 *   net = gross · (1 − wake) · Π(1 − lossᵢ)
 *
 * Shadow like Phase B — computed beside the GWA cf_iec3 headline, not yet the
 * headline. The wake term is a screening SURROGATE, monotonic in capacity
 * density (tighter spacing → more array wake); the plan's PyWake-calibrated
 * surrogate (wind-cf-engine-plan.md §5.3) stays a later precision upgrade.
 */

/** Multiplicative loss fractions (0..1), IEC-61400-15 categories. */
export interface LossBuckets {
  availability: number;
  electrical: number;
  soiling: number;
  curtailment: number;
}

/** Defensible onshore defaults (research doc §8 ranges, mid-band). */
export const DEFAULT_LOSS_BUCKETS: LossBuckets = {
  availability: 0.04, // 3–5%
  electrical: 0.025, // 2–3% transmission/transformer
  soiling: 0.02, // blade soiling + degradation
  curtailment: 0.02, // grid/environmental; region-specific (calibrated in Phase E)
};

const WAKE_MIN = 0.03;
const WAKE_MAX = 0.25;
// Screening surrogate: ≈10% array loss at the engine's 5 MW/km² layout density,
// rising with density. Pending PyWake calibration.
const WAKE_BASE = 0.02;
const WAKE_PER_MW_KM2 = 0.016;

/** Array wake loss fraction as a function of layout capacity density (MW/km²). */
export function wakeLossFraction(capacityDensityMwKm2: number): number {
  const density = Number.isFinite(capacityDensityMwKm2) ? capacityDensityMwKm2 : 0;
  const raw = WAKE_BASE + WAKE_PER_MW_KM2 * density;
  return Math.min(WAKE_MAX, Math.max(WAKE_MIN, raw));
}

export interface NetCfResult {
  grossCf: number;
  wakeLossFraction: number;
  lossBuckets: LossBuckets;
  /** Combined non-wake loss fraction (1 − Π(1 − lossᵢ)). */
  otherLossFraction: number;
  netCf: number;
}

/**
 * Net CF from a gross CF, the layout density (drives wakes), and the loss
 * buckets. All factors are multiplicative; the result is clamped to [0, 1].
 */
export function computeNetCf(
  grossCf: number,
  capacityDensityMwKm2: number,
  buckets: LossBuckets = DEFAULT_LOSS_BUCKETS,
): NetCfResult {
  const wake = wakeLossFraction(capacityDensityMwKm2);
  const otherKept =
    (1 - buckets.availability) *
    (1 - buckets.electrical) *
    (1 - buckets.soiling) *
    (1 - buckets.curtailment);
  const net = grossCf * (1 - wake) * otherKept;
  return {
    grossCf,
    wakeLossFraction: wake,
    lossBuckets: buckets,
    otherLossFraction: 1 - otherKept,
    netCf: Math.min(1, Math.max(0, net)),
  };
}
