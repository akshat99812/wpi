import { test, expect } from "bun:test";
import { computeScores, type ScoreRow } from "./scoring";

function r(code: string, dim: string, v: Partial<ScoreRow>): ScoreRow {
  return {
    code,
    dim,
    value_type: "numeric",
    value_numeric: null,
    value_bool: null,
    value_enum: null,
    value_text: null,
    ...v,
  };
}

test("higher wheeling_concession ranks a state better", () => {
  const rows = [
    r("AA", "wheeling_concession", { value_type: "numeric", value_numeric: 50 }),
    r("BB", "wheeling_concession", { value_type: "numeric", value_numeric: 0 }),
  ];
  const scored = computeScores(rows);
  expect(scored[0]!.code).toBe("AA");
  expect(scored[0]!.rank).toBe(1);
  expect(scored.find((s) => s.code === "BB")!.rank).toBe(2);
});

test("lower banking_charge ranks better (lower-is-better direction)", () => {
  const rows = [
    r("AA", "banking_charge", { value_type: "numeric", value_numeric: 2 }),
    r("BB", "banking_charge", { value_type: "numeric", value_numeric: 12 }),
  ];
  const scored = computeScores(rows);
  expect(scored[0]!.code).toBe("AA");
});

test("unfavourable boolean (css_applicable) lowers the score", () => {
  const rows = [
    r("AA", "css_applicable", { value_type: "boolean", value_bool: false }),
    r("BB", "css_applicable", { value_type: "boolean", value_bool: true }),
  ];
  const scored = computeScores(rows);
  expect(scored.find((s) => s.code === "AA")!.score).toBeGreaterThan(
    scored.find((s) => s.code === "BB")!.score,
  );
});

test("enum banking_period: annual beats monthly", () => {
  const rows = [
    r("AA", "banking_period", { value_type: "enum", value_enum: "annual" }),
    r("BB", "banking_period", { value_type: "enum", value_enum: "monthly" }),
  ];
  const scored = computeScores(rows);
  expect(scored[0]!.code).toBe("AA");
});

test("coverage reflects how much rubric weight had data; rule-based numeric counts as no data", () => {
  const rows = [
    // numeric dim carrying only text (rule-based) → not counted
    r("AA", "wheeling_charge", { value_type: "numeric", value_text: "50% of conventional" }),
    r("AA", "must_run", { value_type: "boolean", value_bool: true }),
  ];
  const scored = computeScores(rows);
  expect(scored[0]!.coverage).toBeGreaterThan(0);
  expect(scored[0]!.coverage).toBeLessThan(1);
});
