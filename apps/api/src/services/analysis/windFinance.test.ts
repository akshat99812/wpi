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
  buildIrrHistogram,
  irr,
  mulberry32,
  npv,
  WIND_CONFIG,
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

// ── PR1: Monte-Carlo IRR distribution / histogram (figure F16) ───────────────

describe("MC IRR histogram is opt-in and percentile-preserving (PR1)", () => {
  test("opts.histogram leaves the percentiles byte-identical to the plain band", () => {
    // Arrange / Act
    const plain = windIrrRange(7.2, mulberry32(42))!;
    const withHist = windIrrRange(7.2, mulberry32(42), WIND_CONFIG, {
      histogram: true,
    })!;
    // Assert — the RNG sequence must be untouched; same draws → same band.
    expect(withHist.p10).toBe(plain.p10);
    expect(withHist.p25).toBe(plain.p25);
    expect(withHist.p50).toBe(plain.p50);
    expect(withHist.p75).toBe(plain.p75);
    expect(withHist.p90).toBe(plain.p90);
    expect(withHist.n).toBe(plain.n);
  });

  test("the plain band carries no histogram/draws (analyze response stays lean)", () => {
    const band = windIrrRange(7.2, mulberry32(42))!;
    expect(band.histogram).toBeUndefined();
    expect(band.draws).toBeUndefined();
  });

  test("histogram: ≤24 buckets, edges = counts+1, counts sum to n, p50 in range", () => {
    const band = windIrrRange(7.2, mulberry32(42), WIND_CONFIG, {
      histogram: true,
    })!;
    const h = band.histogram!;
    expect(h.counts.length).toBeLessThanOrEqual(24);
    expect(h.binEdges.length).toBe(h.counts.length + 1);
    expect(h.counts.reduce((s, c) => s + c, 0)).toBe(band.n);
    for (let i = 1; i < h.binEdges.length; i++) {
      expect(h.binEdges[i]!).toBeGreaterThan(h.binEdges[i - 1]!);
    }
    expect(band.p50).toBeGreaterThanOrEqual(h.binEdges[0]!);
    expect(band.p50).toBeLessThanOrEqual(h.binEdges[h.binEdges.length - 1]!);
  });

  test("histogram is reproducible under a fixed seed", () => {
    const a = windIrrRange(7.2, mulberry32(42), WIND_CONFIG, { histogram: true })!;
    const b = windIrrRange(7.2, mulberry32(42), WIND_CONFIG, { histogram: true })!;
    expect(b.histogram).toEqual(a.histogram!);
  });

  test("opts.bins overrides the bucket count", () => {
    const band = windIrrRange(7.2, mulberry32(42), WIND_CONFIG, {
      histogram: true,
      bins: 12,
    })!;
    expect(band.histogram!.counts.length).toBe(12);
  });

  test("opts.includeDraws returns exactly n raw draws", () => {
    const band = windIrrRange(7.2, mulberry32(42), WIND_CONFIG, {
      includeDraws: true,
    })!;
    expect(band.draws!.length).toBe(band.n);
  });

  test("null ws → null band even with opts", () => {
    expect(windIrrRange(null, mulberry32(42), WIND_CONFIG, { histogram: true })).toBeNull();
  });
});

describe("buildIrrHistogram (pure helper)", () => {
  test("uniform values bucket and counts sum to length", () => {
    const vals = Array.from({ length: 100 }, (_, i) => i / 100); // 0..0.99
    const h = buildIrrHistogram(vals, 10);
    expect(h.counts.length).toBe(10);
    expect(h.binEdges.length).toBe(11);
    expect(h.counts.reduce((s, c) => s + c, 0)).toBe(100);
  });

  test("the max value lands in the last bucket (inclusive top edge)", () => {
    const h = buildIrrHistogram([0, 0.5, 1], 4);
    expect(h.counts.reduce((s, c) => s + c, 0)).toBe(3);
    expect(h.counts[h.counts.length - 1]!).toBeGreaterThanOrEqual(1);
  });

  test("degenerate all-equal values → single bucket, no NaN edges", () => {
    const h = buildIrrHistogram([0.2, 0.2, 0.2], 24);
    expect(h.counts).toEqual([3]);
    expect(h.binEdges).toEqual([0.2, 0.2]);
  });

  test("is deterministic — same input, same output", () => {
    const vals = [0.1, 0.3, 0.2, 0.25, 0.18, 0.31, 0.27];
    expect(buildIrrHistogram(vals, 5)).toEqual(buildIrrHistogram(vals, 5));
  });

  test("excludes non-finite values; counts sum to the finite count", () => {
    const h = buildIrrHistogram([0.1, NaN, 0.3, Infinity, -Infinity, 0.5], 4);
    expect(h.counts.reduce((s, c) => s + c, 0)).toBe(3);
    expect(h.binEdges.every((e) => Number.isFinite(e))).toBe(true);
  });

  test("non-positive or non-integer bins fall back to the default (no crash/NaN)", () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      const h = buildIrrHistogram([0.1, 0.2, 0.3, 0.4], bad);
      expect(h.binEdges.length).toBe(h.counts.length + 1);
      expect(h.counts.every((c) => Number.isFinite(c))).toBe(true);
      expect(h.counts.reduce((s, c) => s + c, 0)).toBe(4);
    }
  });

  test("empty / all-non-finite input → empty histogram, never throws", () => {
    expect(buildIrrHistogram([], 4)).toEqual({ binEdges: [], counts: [] });
    expect(buildIrrHistogram([NaN, Infinity], 4)).toEqual({ binEdges: [], counts: [] });
  });
});
