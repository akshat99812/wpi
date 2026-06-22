/**
 * Single entry point for the per-point wind screen (methodology §4/§6 task 2).
 *
 * Returns the two INDEPENDENT outputs side by side — the 0–100 suitability
 * score (Part A) and the ₹ pro-forma financials + Monte-Carlo IRR band
 * (Part B) — plus nothing derived from one another (rule §5).
 *
 * Inputs come from our samplers: `ws` = GWA mean speed @100 m, `lineKm`/`subKm`
 * = PostGIS distances to the nearest line / substation. The financial half adds
 * NO new inputs.
 *
 * Use this for the click-to-inspect popup. For WCE batch siting, call
 * `windScore` + `windFinancials` per cell and SKIP `windIrrRange` — the 4,000-
 * run Monte Carlo is the only expensive part (§6 task 4).
 */

import {
  mulberry32,
  windFinancials,
  windIrrRange,
  type IrrBand,
  type WindFinancials,
} from "./windFinance";
import { windScore, type WindScore } from "./windScoring";

/** Fixed Monte-Carlo seed → reproducible IRR bands across runs and tests. */
const MC_SEED = 42;

export interface WindScreening {
  score: WindScore | null; // Part A: { score, res, grid, cuf, rating } | null
  financials: WindFinancials | null; // Part B: IRR / LCOE / payback / NPV | null
  irrBand: IrrBand | null; // Part B: P10..P90 | null
}

export function screenWind(
  ws: number | null,
  lineKm: number | null,
  subKm: number | null,
): WindScreening {
  return {
    score: windScore(ws, lineKm, subKm),
    financials: windFinancials(ws),
    irrBand: windIrrRange(ws, mulberry32(MC_SEED)),
  };
}
