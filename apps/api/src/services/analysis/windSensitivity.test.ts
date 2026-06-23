/**
 * Unit tests for one-at-a-time tornado sensitivity (windSensitivity.ts, PR2).
 *
 * The headline guarantee: `baseIrr` (all inputs at their mode) equals the
 * deterministic equity IRR from windFinancials EXACTLY — the tornado must reuse
 * the same waterfall so the figure never disagrees with the headline number.
 * Then sign sanity (lower CAPEX → higher IRR, etc.) and influence ordering.
 */

import { describe, expect, test } from "bun:test";

import { windFinancials } from "./windFinance";
import { windSensitivity, type TornadoVariable } from "./windSensitivity";

const WS = 7.2; // the golden site (equity IRR 23.0%)

describe("windSensitivity baseline reuses the headline waterfall", () => {
  test("baseIrr === windFinancials(ws).irr (within 1e-9)", () => {
    const headline = windFinancials(WS)!.irr!;
    const s = windSensitivity(WS)!;
    expect(s.baseIrr).toBeCloseTo(headline, 9);
  });

  test("null ws → null (no CUF, rule §5)", () => {
    expect(windSensitivity(null)).toBeNull();
  });

  test("emits exactly the 8 tornado arms", () => {
    const s = windSensitivity(WS)!;
    const vars = new Set(s.rows.map((r) => r.variable));
    const expected: TornadoVariable[] = [
      "PPA",
      "CUF",
      "CAPEX",
      "interest",
      "REC",
      "TOD",
      "OM",
      "carbon",
    ];
    expect(s.rows).toHaveLength(8);
    for (const v of expected) expect(vars.has(v)).toBe(true);
  });
});

describe("windSensitivity sign sanity", () => {
  const s = windSensitivity(WS)!;
  const row = (v: TornadoVariable) => s.rows.find((r) => r.variable === v)!;

  test("lower CAPEX → higher IRR (deltaLow > 0, deltaHigh < 0)", () => {
    const r = row("CAPEX");
    expect(r.deltaLow!).toBeGreaterThan(0);
    expect(r.deltaHigh!).toBeLessThan(0);
  });

  test("higher PPA → higher IRR (deltaLow < 0, deltaHigh > 0)", () => {
    const r = row("PPA");
    expect(r.deltaLow!).toBeLessThan(0);
    expect(r.deltaHigh!).toBeGreaterThan(0);
  });

  test("higher CUF → higher IRR", () => {
    const r = row("CUF");
    expect(r.highIrr!).toBeGreaterThan(s.baseIrr);
    expect(r.lowIrr!).toBeLessThan(s.baseIrr);
  });

  test("higher interest → lower IRR", () => {
    const r = row("interest");
    expect(r.deltaHigh!).toBeLessThan(0);
    expect(r.deltaLow!).toBeGreaterThan(0);
  });
});

describe("windSensitivity ordering & determinism", () => {
  test("rows are sorted by influence (descending)", () => {
    const s = windSensitivity(WS)!;
    const infl = (i: number) =>
      Math.max(
        Math.abs(s.rows[i]!.deltaLow ?? 0),
        Math.abs(s.rows[i]!.deltaHigh ?? 0),
      );
    for (let i = 1; i < s.rows.length; i++) {
      expect(infl(i - 1)).toBeGreaterThanOrEqual(infl(i));
    }
  });

  test("the dominant arms are CUF, CAPEX, PPA (the plan's expectation)", () => {
    const s = windSensitivity(WS)!;
    const top3 = new Set(s.rows.slice(0, 3).map((r) => r.variable));
    expect(top3).toEqual(new Set<TornadoVariable>(["CUF", "CAPEX", "PPA"]));
  });

  test("is deterministic — same input, same output", () => {
    expect(windSensitivity(WS)).toEqual(windSensitivity(WS));
  });
});
