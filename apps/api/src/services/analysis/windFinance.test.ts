/**
 * Unit tests for the financial screening — Methodology PART B (windFinance.ts).
 *
 * Golden-files the worked example (ws 7.2 → equity IRR 23.0%, project IRR
 * 13.7%, LCOE ₹3.26, payback 5, NPV ₹3.01 Cr/MW). Asserts the Monte-Carlo band
 * is monotonic and reproducible under a fixed seed, plus null propagation and
 * the npv/irr/tariff primitives.
 */

import { describe, expect, test } from "bun:test";

import {
  irr,
  mulberry32,
  npv,
  windEffectiveTariff,
  windFinancials,
  windIrrRange,
} from "./windFinance";

describe("windFinancials worked example (methodology §B)", () => {
  const fin = windFinancials(7.2)!;

  test("equity IRR ≈ 23.0% (±0.001)", () => {
    expect(fin.irr!).toBeCloseTo(0.23, 3);
    expect(Math.round(fin.irr! * 1000) / 10).toBe(23.0);
  });

  test("project IRR ≈ 13.7%", () => {
    expect(fin.projIrr!).toBeCloseTo(0.137, 3);
  });

  test("LCOE ≈ ₹3.26/kWh", () => {
    expect(fin.lcoe!).toBeCloseTo(3.2648, 3);
    expect(Number(fin.lcoe!.toFixed(2))).toBe(3.26);
  });

  test("payback = 5 yr", () => {
    expect(fin.payback).toBe(5);
  });

  test("NPV ≈ ₹3.01 Cr/MW", () => {
    expect(fin.npvCr).toBeCloseTo(3.0065, 3);
    expect(Number(fin.npvCr.toFixed(2))).toBe(3.01);
  });

  test("annual energy = cuf · 8766 = 3,804 MWh/yr", () => {
    expect(fin.annualMwh).toBeCloseTo(3804.444, 3);
  });

  test("effective tariff = ₹4.50 (PPA 3.50 + REC + TOD + carbon)", () => {
    expect(fin.effTariff).toBe(4.5);
  });
});

describe("Monte-Carlo IRR band (§B5)", () => {
  test("4,000 runs, monotonic P10≤P25≤P50≤P75≤P90", () => {
    const band = windIrrRange(7.2, mulberry32(42))!;
    expect(band.n).toBe(4000);
    expect(band.p10).toBeLessThanOrEqual(band.p25);
    expect(band.p25).toBeLessThanOrEqual(band.p50);
    expect(band.p50).toBeLessThanOrEqual(band.p75);
    expect(band.p75).toBeLessThanOrEqual(band.p90);
  });

  test("matches the documented band under seed 42", () => {
    const band = windIrrRange(7.2, mulberry32(42))!;
    expect(band.p10).toBeCloseTo(0.1957, 3); // ~19.5%
    expect(band.p50).toBeCloseTo(0.2277, 3); // ~22.8%
    expect(band.p90).toBeCloseTo(0.2611, 3); // ~26.2%
  });

  test("is reproducible for the same seed", () => {
    const a = windIrrRange(7.2, mulberry32(42));
    const b = windIrrRange(7.2, mulberry32(42));
    expect(b).toEqual(a);
  });

  test("a different seed gives a different but plausible band", () => {
    const a = windIrrRange(7.2, mulberry32(42))!;
    const c = windIrrRange(7.2, mulberry32(7))!;
    expect(c.p50).not.toBe(a.p50);
    expect(c.p50).toBeGreaterThan(0.15);
    expect(c.p50).toBeLessThan(0.3);
  });
});

describe("null propagation (rule §5)", () => {
  test("null ws → null financials", () => {
    expect(windFinancials(null)).toBeNull();
  });
  test("null ws → null IRR band", () => {
    expect(windIrrRange(null, mulberry32(42))).toBeNull();
  });
});

describe("npv / irr primitives", () => {
  test("npv at rate 0 is the plain sum", () => {
    expect(npv(0, [-100, 50, 70])).toBeCloseTo(20, 10);
  });
  test("irr of [-100, 110] is 10%", () => {
    expect(irr([-100, 110])!).toBeCloseTo(0.1, 6);
  });
  test("irr returns null with no sign change (all positive / all negative)", () => {
    expect(irr([100, 50, 20])).toBeNull();
    expect(irr([-100, -50, -20])).toBeNull();
  });
  test("windEffectiveTariff defaults to ₹4.50", () => {
    expect(windEffectiveTariff()).toBe(4.5);
  });
});
