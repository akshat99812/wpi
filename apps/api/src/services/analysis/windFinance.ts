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

/** Single deterministic pro-forma (§B1–B4). null when ws → no CUF. */
export function windFinancials(
  ws: number | null,
  cfg: WindConfig = WIND_CONFIG,
): WindFinancials | null {
  const cuf = windCuf(ws);
  if (cuf === null) return null;
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

export interface IrrBand {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  n: number;
}

/**
 * 4,000-run equity-IRR band (§B5). Each draw samples inputs from triangular
 * distributions + a per-draw interest rate. Pass a seeded `rng` for
 * reproducibility. null when ws → no CUF, or when too few draws produced an IRR.
 */
export function windIrrRange(
  ws: number | null,
  rng: Rng,
  cfg: WindConfig = WIND_CONFIG,
): IrrBand | null {
  const cufBase = windCuf(ws);
  if (cufBase === null) return null;
  const rs: number[] = [];
  for (let i = 0; i < cfg.mcRuns; i++) {
    const eff =
      tri(rng, 3.3, 3.5, 3.7) +
      tri(rng, 0.25, 0.35, 0.45) +
      tri(rng, 0.3, 0.4, 0.52) +
      tri(rng, 0.15, 0.25, 0.32);
    const om = tri(rng, 0.12, 0.13, 0.15);
    const cuf = cufBase * tri(rng, 0.92, 1.0, 1.08);
    const interest = tri(rng, 0.085, 0.095, 0.105);
    const m = cashflowModel(cfg, tri(rng, 8.5, 9.0, 9.5), eff, cuf * cfg.hoursYr, om, 0, 20, interest);
    if (m && m.eqIrr !== null) rs.push(m.eqIrr);
  }
  if (rs.length < 10) return null;
  rs.sort((a, b) => a - b);
  return {
    p10: pctile(rs, 0.1),
    p25: pctile(rs, 0.25),
    p50: pctile(rs, 0.5),
    p75: pctile(rs, 0.75),
    p90: pctile(rs, 0.9),
    n: rs.length,
  };
}
