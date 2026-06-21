import { describe, expect, test } from "bun:test";
import { DEFAULT_SIGMA, combineSigma, computeExceedance } from "./uncertainty";

describe("combineSigma", () => {
  test("root-sum-square of the components", () => {
    expect(combineSigma({ iav: 0.3, model: 0.4, powerCurve: 0, loss: 0 })).toBeCloseTo(0.5, 6);
  });

  test("default budget is ~10%", () => {
    const s = combineSigma(DEFAULT_SIGMA);
    expect(s).toBeGreaterThan(0.08);
    expect(s).toBeLessThan(0.13);
  });
});

describe("computeExceedance", () => {
  test("P50 ≥ P75 ≥ P90, all below P50 for positive σ", () => {
    const e = computeExceedance(0.35);
    expect(e.p50).toBeCloseTo(0.35, 6);
    expect(e.p75).toBeLessThan(e.p50);
    expect(e.p90).toBeLessThan(e.p75);
  });

  test("matches P_ε = P50·(1 − z·σ)", () => {
    const e = computeExceedance(0.4);
    expect(e.p75).toBeCloseTo(0.4 * (1 - 0.674 * e.sigmaTotal), 6);
    expect(e.p90).toBeCloseTo(0.4 * (1 - 1.282 * e.sigmaTotal), 6);
  });

  test("zero σ collapses the bands onto P50", () => {
    const e = computeExceedance(0.3, { iav: 0, model: 0, powerCurve: 0, loss: 0 });
    expect(e.p75).toBeCloseTo(0.3, 6);
    expect(e.p90).toBeCloseTo(0.3, 6);
  });

  test("clamps into [0,1]", () => {
    const e = computeExceedance(1.2);
    expect(e.p50).toBe(1);
    expect(computeExceedance(0).p90).toBe(0);
  });
});
