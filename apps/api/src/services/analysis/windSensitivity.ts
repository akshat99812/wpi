/**
 * Tornado sensitivity (one-at-a-time) for the site report's figure F-tornado.
 *
 * Holds every economic input at its triangular MODE, then swings each one to its
 * tri-min and tri-max and recomputes the DETERMINISTIC equity IRR. The deltas vs
 * the all-mode baseline rank the drivers of project return.
 *
 * Single source of truth: every IRR here goes through `windFinancials` — the SAME
 * waterfall as the headline number — so `baseIrr` equals the reported equity IRR
 * exactly and no arm can silently disagree with it (the cardinal rule, plan §1.2).
 *
 * Bounds match `windIrrRange`'s Monte-Carlo sampler so the tornado and the band
 * tell a consistent story. NOTE the MC sums PPA/REC/TOD/carbon into one effective
 * tariff; the tornado swings each independently (they are distinct WindConfig
 * fields), so the per-arm tariff deltas are finer-grained than the MC's combined
 * tariff draw — intentional, and documented here so the two are not "expected" to
 * match arm-for-arm.
 */

import {
  MC_BOUNDS,
  WIND_CONFIG,
  windFinancials,
  type WindConfig,
} from "./windFinance";

export type TornadoVariable =
  | "PPA"
  | "CUF"
  | "CAPEX"
  | "interest"
  | "REC"
  | "TOD"
  | "OM"
  | "carbon";

export interface TornadoRow {
  variable: TornadoVariable;
  /** Equity IRR with the variable at its tri-min (others at mode). */
  lowIrr: number | null;
  /** Equity IRR with the variable at its tri-max. */
  highIrr: number | null;
  /** lowIrr − baseIrr (null if that arm produced no IRR). */
  deltaLow: number | null;
  /** highIrr − baseIrr. */
  deltaHigh: number | null;
}

export interface WindSensitivity {
  /** All-mode deterministic equity IRR — equals the headline windFinancials IRR. */
  baseIrr: number;
  /** Rows sorted by max(|deltaLow|, |deltaHigh|), descending. */
  rows: TornadoRow[];
}

/** Absolute WindConfig field swings (tri-min, tri-max), matching the MC sampler. */
interface CfgArm {
  variable: TornadoVariable;
  field: keyof WindConfig;
  low: number;
  high: number;
}

// Bounds are sourced from the shared MC_BOUNDS (windFinance.ts) so the tornado
// and the Monte-Carlo band can never drift apart.
const CFG_ARMS: readonly CfgArm[] = [
  { variable: "PPA", field: "ppa", low: MC_BOUNDS.ppa.min, high: MC_BOUNDS.ppa.max },
  { variable: "REC", field: "recWind", low: MC_BOUNDS.recWind.min, high: MC_BOUNDS.recWind.max },
  { variable: "TOD", field: "todMerchantWind", low: MC_BOUNDS.todMerchantWind.min, high: MC_BOUNDS.todMerchantWind.max },
  { variable: "carbon", field: "carbon", low: MC_BOUNDS.carbon.min, high: MC_BOUNDS.carbon.max },
  { variable: "OM", field: "omCr", low: MC_BOUNDS.omCr.min, high: MC_BOUNDS.omCr.max },
  { variable: "interest", field: "interestRate", low: MC_BOUNDS.interestRate.min, high: MC_BOUNDS.interestRate.max },
  { variable: "CAPEX", field: "capexCr", low: MC_BOUNDS.capexCr.min, high: MC_BOUNDS.capexCr.max },
];

/** CUF is a multiplicative factor on the curve CUF — same bound as the MC sampler. */
const CUF_LOW = MC_BOUNDS.cufScale.min;
const CUF_HIGH = MC_BOUNDS.cufScale.max;

// A collapsed arm (null delta = the swing produced no IRR at all) is MAXIMALLY
// sensitive, not zero — rank it to the top of the tornado, never the bottom.
const influence = (r: TornadoRow): number =>
  r.deltaLow === null || r.deltaHigh === null
    ? Infinity
    : Math.max(Math.abs(r.deltaLow), Math.abs(r.deltaHigh));

/**
 * One-at-a-time tornado over the deterministic equity IRR. Returns null when the
 * site has no resource (ws → no CUF), mirroring windFinancials.
 */
export function windSensitivity(
  ws: number | null,
  cfg: WindConfig = WIND_CONFIG,
): WindSensitivity | null {
  const base = windFinancials(ws, cfg);
  if (!base || base.irr === null) return null;
  const baseIrr = base.irr;

  const delta = (irr: number | null): number | null =>
    irr === null ? null : irr - baseIrr;

  const rows: TornadoRow[] = CFG_ARMS.map((arm) => {
    const lowIrr = windFinancials(ws, { ...cfg, [arm.field]: arm.low })?.irr ?? null;
    const highIrr = windFinancials(ws, { ...cfg, [arm.field]: arm.high })?.irr ?? null;
    return {
      variable: arm.variable,
      lowIrr,
      highIrr,
      deltaLow: delta(lowIrr),
      deltaHigh: delta(highIrr),
    };
  });

  // CUF arm — scale the curve CUF rather than a WindConfig field.
  const cufLowIrr = windFinancials(ws, cfg, { cufScale: CUF_LOW })?.irr ?? null;
  const cufHighIrr = windFinancials(ws, cfg, { cufScale: CUF_HIGH })?.irr ?? null;
  rows.push({
    variable: "CUF",
    lowIrr: cufLowIrr,
    highIrr: cufHighIrr,
    deltaLow: delta(cufLowIrr),
    deltaHigh: delta(cufHighIrr),
  });

  // Guard the comparator: two collapsed arms both score Infinity, and
  // Infinity − Infinity is NaN (which would make the sort order undefined).
  rows.sort((a, b) => {
    const d = influence(b) - influence(a);
    return Number.isNaN(d) ? 0 : d;
  });
  return { baseIrr, rows };
}
