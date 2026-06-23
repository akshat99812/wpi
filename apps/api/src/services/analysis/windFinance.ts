/**
 * Wind Financial Screening — Methodology PART B (per 1 MW).
 *
 * Real pro-forma: equity IRR (headline), project IRR, LCOE, payback, NPV, and
 * a 4,000-run Monte-Carlo equity-IRR band. CERC RE Tariff Regulations 2024
 * normative parameters, all held in WIND_CONFIG so they stay tunable.
 *
 * ⚠️ The effective-tariff STACK drives the IRR (§B2). PPA ₹3.50 is a floor;
 * REC/TOD/carbon adders lift it to ₹4.50 and that is what pushes the IRR into
 * the 20s. These are PLACEHOLDER CERC-2024 values — ground them in our real
 * PPA / offtake terms before quoting any IRR as meaningful (methodology rule §5).
 *
 * Independent of the suitability score (windScoring.ts): the two share only the
 * CUF (windCuf.ts) and never read each other.
 *
 * Worked example: ws 7.2 → cuf 0.434 → equity IRR 23.0%, project IRR 13.7%,
 * LCOE ₹3.26/kWh, payback 5 yr, NPV ₹3.01 Cr/MW; band ≈ P10 19.5 / P50 22.8 /
 * P90 26.2%.
 */

import { windCuf } from "./windCuf";

export interface WindConfig {
  capexCr: number;
  ppa: number;
  omCr: number;
  life: number;
  degr: number;
  recWind: number;
  todMerchantWind: number;
  carbon: number;
  debtFrac: number;
  loanTenure: number;
  interestRate: number;
  deprRate: number;
  deprYears: number;
  maxDeprFrac: number;
  matRate: number;
  corpRate: number;
  matYears: number;
  hoursYr: number;
  discount: number;
  mcRuns: number;
}

/** PLACEHOLDER CERC-2024 normative params — see the ⚠️ note above. */
export const WIND_CONFIG: WindConfig = {
  capexCr: 9.0,
  ppa: 3.5,
  omCr: 0.13,
  life: 20,
  degr: 0,
  recWind: 0.35,
  todMerchantWind: 0.4,
  carbon: 0.25,
  debtFrac: 0.75,
  loanTenure: 15,
  interestRate: 0.095,
  deprRate: 0.0467,
  deprYears: 15,
  maxDeprFrac: 0.9,
  matRate: 0.1747,
  corpRate: 0.3494,
  matYears: 20,
  hoursYr: 8766,
  discount: 0.1,
  mcRuns: 4000,
};

export type Rng = () => number;

/** Seedable PRNG for reproducible Monte-Carlo bands (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function npv(rate: number, cf: number[]): number {
  let v = 0;
  for (let t = 0; t < cf.length; t++) v += cf[t]! / (1 + rate) ** t;
  return v;
}

/** Equity/project IRR by bisection; null when there is no sign change (rule §5
 *  — never coerce to 0/NaN). */
export function irr(cf: number[]): number | null {
  let lo = -0.95;
  let hi = 3.0;
  let fLo = npv(lo, cf);
  if (fLo * npv(hi, cf) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fM = npv(mid, cf);
    if (Math.abs(fM) < 1e-7) return mid;
    if (fLo * fM < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fM;
    }
  }
  return (lo + hi) / 2;
}

export interface CashflowResult {
  eqIrr: number | null;
  projIrr: number | null;
  payback: number | null;
  npvCr: number;
  lcoe: number | null;
  annualMwh: number;
}

/** Project-finance waterfall (§B3) over `life` years, per 1 MW. */
function cashflowModel(
  cfg: WindConfig,
  capexCr: number,
  tariff: number,
  annualMwh: number,
  omCr: number,
  degr: number,
  life: number,
  interestRate: number,
): CashflowResult | null {
  if (annualMwh <= 0) return null;
  const capex = capexCr * 1e7;
  const debt = capex * cfg.debtFrac;
  const equity = capex * (1 - cfg.debtFrac);
  const annualPrincipal = debt / cfg.loanTenure;
  const annualDepr = capex * cfg.deprRate;
  const maxDepr = capex * cfg.maxDeprFrac;
  let loanBal = debt;
  let cumDepr = 0;
  let cumEq = -equity;
  let eqPb: number | null = null;
  let discE = 0;
  let discCost = capex;
  const eqCF = [-equity];
  const projCF = [-capex];
  for (let y = 1; y <= life; y++) {
    const mwh = annualMwh * (1 - degr) ** (y - 1);
    const revenue = mwh * 1000 * tariff;
    const om = omCr * 1e7 * 1.05 ** (y - 1);
    const interest = loanBal * interestRate;
    const principal = y <= cfg.loanTenure ? annualPrincipal : 0;
    let depr = 0;
    if (y <= cfg.deprYears && cumDepr < maxDepr) {
      depr = Math.min(annualDepr, maxDepr - cumDepr);
      cumDepr += depr;
    }
    const ebt = revenue - om - interest - depr;
    const taxRate = y <= cfg.matYears ? cfg.matRate : cfg.corpRate;
    const tax = ebt > 0 ? ebt * taxRate : 0;
    const equityCF = revenue - om - interest - principal - tax;
    eqCF.push(equityCF);
    cumEq += equityCF;
    if (cumEq >= 0 && eqPb === null) eqPb = y;
    const projTaxable = revenue - om - depr;
    projCF.push(revenue - om - (projTaxable > 0 ? projTaxable * taxRate : 0));
    discE += (mwh * 1000) / (1 + cfg.discount) ** y;
    discCost += om / (1 + cfg.discount) ** y;
    loanBal -= principal;
  }
  return {
    eqIrr: irr(eqCF),
    projIrr: irr(projCF),
    payback: eqPb,
    npvCr: npv(cfg.discount, eqCF) / 1e7,
    lcoe: discE > 0 ? discCost / discE : null,
    annualMwh,
  };
}

/** Effective realised tariff = PPA floor + REC + TOD/merchant + carbon (§B2). */
export function windEffectiveTariff(cfg: WindConfig = WIND_CONFIG): number {
  return cfg.ppa + cfg.recWind + cfg.todMerchantWind + cfg.carbon;
}

export interface WindFinancials {
  irr: number | null; // equity IRR (headline)
  projIrr: number | null;
  payback: number | null;
  npvCr: number;
  lcoe: number | null;
  annualMwh: number;
  effTariff: number;
}

/** Opt-in perturbation for sensitivity analysis (tornado CUF arm, PR2). */
export interface WindFinancialsOptions {
  /** Multiply the curve CUF before energy (matches the MC's cuf factor). */
  cufScale?: number;
}

/** Single deterministic pro-forma (§B1–B4). null when ws → no CUF. */
export function windFinancials(
  ws: number | null,
  cfg: WindConfig = WIND_CONFIG,
  opts?: WindFinancialsOptions,
): WindFinancials | null {
  const cufBase = windCuf(ws);
  if (cufBase === null) return null;
  const cuf =
    opts?.cufScale != null ? Math.max(0, cufBase * opts.cufScale) : cufBase;
  const eff = windEffectiveTariff(cfg);
  const m = cashflowModel(
    cfg,
    cfg.capexCr,
    eff,
    cuf * cfg.hoursYr,
    cfg.omCr,
    cfg.degr,
    cfg.life,
    cfg.interestRate,
  );
  if (!m) return null;
  return {
    irr: m.eqIrr,
    projIrr: m.projIrr,
    payback: m.payback,
    npvCr: m.npvCr,
    lcoe: m.lcoe,
    annualMwh: m.annualMwh,
    effTariff: eff,
  };
}

// ── Monte-Carlo IRR band (§B5) ───────────────────────────────────────────────

const tri = (rng: Rng, a: number, m: number, b: number): number => {
  const u = rng();
  const c = (m - a) / (b - a);
  return u < c
    ? a + Math.sqrt(u * (b - a) * (m - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - m));
};

const pctile = (s: number[], p: number): number => {
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};

/** Equal-width histogram of the equity-IRR draws (figure F16). */
export interface IrrHistogram {
  /** `bins + 1` edges, ascending; the top edge is the observed max. */
  binEdges: number[];
  /** One count per bucket; sums to the number of draws. */
  counts: number[];
}

/**
 * Equal-width histogram over the observed range of `values`. Pure and
 * deterministic (same input → same output), so it is snapshot-safe. The max
 * value falls in the last bucket (inclusive top edge). Degenerate all-equal
 * input collapses to a single bucket — never produces NaN edges.
 *
 * Robustness contract: non-finite entries (NaN / ±Infinity) are EXCLUDED, so
 * `counts` always sums to the number of FINITE values; `bins` is coerced to a
 * positive integer (default 24). Empty / all-non-finite input → empty histogram.
 */
export function buildIrrHistogram(values: number[], bins = 24): IrrHistogram {
  const b = Number.isInteger(bins) && bins > 0 ? bins : 24;
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { binEdges: [], counts: [] };
  let min = Infinity;
  let max = -Infinity;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) {
    return { binEdges: [min, max], counts: [finite.length] };
  }
  const width = (max - min) / b;
  const binEdges: number[] = new Array(b + 1);
  for (let i = 0; i <= b; i++) binEdges[i] = min + width * i;
  binEdges[b] = max; // pin the top edge against floating-point drift
  const counts: number[] = new Array(b).fill(0);
  for (const v of finite) {
    let idx = Math.floor((v - min) / width);
    if (idx >= b) idx = b - 1; // the max lands in the last bucket
    if (idx < 0) idx = 0;
    counts[idx]!++;
  }
  return { binEdges, counts };
}

export interface IrrBand {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  n: number;
  /**
   * ≤`bins`-bucket histogram of the equity-IRR draws — opt-in via
   * `IrrRangeOptions.histogram`. Lets the PDF draw figure F16 without shipping
   * ~4,000 floats. Absent (undefined) on the default analyze path, so the
   * AnalysisResponse stays byte-for-byte unchanged.
   */
  histogram?: IrrHistogram;
  /** Raw insertion-order equity-IRR draws — debug only (`includeDraws`). */
  draws?: number[];
}

/** Opt-in extras for windIrrRange (default: none → lean analyze response). */
export interface IrrRangeOptions {
  /** Attach a histogram of the draws (for figure F16). */
  histogram?: boolean;
  /** Histogram bucket count. Default 24. */
  bins?: number;
  /** Attach raw insertion-order draws (debug). */
  includeDraws?: boolean;
}

/** Triangular [min, mode, max] for one Monte-Carlo input. */
export interface TriBound {
  min: number;
  mode: number;
  max: number;
}

/**
 * Triangular bounds for the MC sampler — the SINGLE source of truth shared by
 * `windIrrRange` (the band) and `windSensitivity` (the tornado), so the two
 * figures can never silently diverge if a bound is retuned. `cufScale` is a
 * multiplicative factor on the curve CUF; the rest are absolute WindConfig
 * field values.
 */
export const MC_BOUNDS = {
  ppa: { min: 3.3, mode: 3.5, max: 3.7 },
  recWind: { min: 0.25, mode: 0.35, max: 0.45 },
  todMerchantWind: { min: 0.3, mode: 0.4, max: 0.52 },
  carbon: { min: 0.15, mode: 0.25, max: 0.32 },
  omCr: { min: 0.12, mode: 0.13, max: 0.15 },
  interestRate: { min: 0.085, mode: 0.095, max: 0.105 },
  capexCr: { min: 8.5, mode: 9.0, max: 9.5 },
  cufScale: { min: 0.92, mode: 1.0, max: 1.08 },
} as const satisfies Record<string, TriBound>;

/**
 * 4,000-run equity-IRR band (§B5). Each draw samples inputs from triangular
 * distributions + a per-draw interest rate. Pass a seeded `rng` for
 * reproducibility. null when ws → no CUF, or when too few draws produced an IRR.
 */
export function windIrrRange(
  ws: number | null,
  rng: Rng,
  cfg: WindConfig = WIND_CONFIG,
  opts?: IrrRangeOptions,
): IrrBand | null {
  const cufBase = windCuf(ws);
  if (cufBase === null) return null;
  const rs: number[] = [];
  for (let i = 0; i < cfg.mcRuns; i++) {
    // Draw order is load-bearing — it pins the seeded RNG sequence and thus the
    // golden percentiles. Keep ppa→rec→tod→carbon→om→cuf→interest→capex.
    const eff =
      tri(rng, MC_BOUNDS.ppa.min, MC_BOUNDS.ppa.mode, MC_BOUNDS.ppa.max) +
      tri(rng, MC_BOUNDS.recWind.min, MC_BOUNDS.recWind.mode, MC_BOUNDS.recWind.max) +
      tri(rng, MC_BOUNDS.todMerchantWind.min, MC_BOUNDS.todMerchantWind.mode, MC_BOUNDS.todMerchantWind.max) +
      tri(rng, MC_BOUNDS.carbon.min, MC_BOUNDS.carbon.mode, MC_BOUNDS.carbon.max);
    const om = tri(rng, MC_BOUNDS.omCr.min, MC_BOUNDS.omCr.mode, MC_BOUNDS.omCr.max);
    const cuf = cufBase * tri(rng, MC_BOUNDS.cufScale.min, MC_BOUNDS.cufScale.mode, MC_BOUNDS.cufScale.max);
    const interest = tri(rng, MC_BOUNDS.interestRate.min, MC_BOUNDS.interestRate.mode, MC_BOUNDS.interestRate.max);
    const m = cashflowModel(cfg, tri(rng, MC_BOUNDS.capexCr.min, MC_BOUNDS.capexCr.mode, MC_BOUNDS.capexCr.max), eff, cuf * cfg.hoursYr, om, 0, 20, interest);
    if (m && m.eqIrr !== null) rs.push(m.eqIrr);
  }
  if (rs.length < 10) return null;
  // Capture raw (insertion-order) draws BEFORE the sort, for the debug option.
  const rawDraws = opts?.includeDraws ? rs.slice() : null;
  rs.sort((a, b) => a - b);
  const band: IrrBand = {
    p10: pctile(rs, 0.1),
    p25: pctile(rs, 0.25),
    p50: pctile(rs, 0.5),
    p75: pctile(rs, 0.75),
    p90: pctile(rs, 0.9),
    n: rs.length,
  };
  if (opts?.histogram) band.histogram = buildIrrHistogram(rs, opts.bins ?? 24);
  if (rawDraws) band.draws = rawDraws;
  return band;
}
