import { test, expect } from "bun:test";
import { formatCell, computeDiff, emptyCell, type ValueRow, type Cell } from "./compute";

function row(partial: Partial<ValueRow>): ValueRow {
  return {
    value_type: "numeric",
    value_numeric: null,
    value_bool: null,
    value_enum: null,
    value_text: null,
    raw_excerpt: "x",
    source_name: "src",
    source_url: "http://e",
    policy_year: 2024,
    confidence: "extracted",
    ...partial,
  };
}

// ── formatCell ────────────────────────────────────────────────────────────────
test("formats numeric ₹/kWh with two decimals", () => {
  const c = formatCell(row({ value_type: "numeric", value_numeric: "0.4" }), "₹/kWh");
  expect(c.value).toBe(0.4);
  expect(c.display).toBe("₹0.40/kWh");
});

test("formats percent with two decimals", () => {
  expect(formatCell(row({ value_numeric: "2.1" }), "%").display).toBe("2.10%");
});

test("formats kW without decimals", () => {
  expect(formatCell(row({ value_numeric: "100" }), "kW").display).toBe("100 kW");
});

test("boolean renders Yes/No", () => {
  expect(formatCell(row({ value_type: "boolean", value_bool: true }), null).display).toBe("Yes");
  expect(formatCell(row({ value_type: "boolean", value_bool: false }), null).display).toBe("No");
});

test("rule-based numeric dimension carries text + basis:rule", () => {
  const c = formatCell(
    row({ value_type: "numeric", value_text: "50% of conventional charge" }),
    "₹/kWh",
  );
  expect(c.basis).toBe("rule");
  expect(c.value).toBeNull();
  expect(c.display).toBe("50% of conventional charge");
});

test("absent value renders em dash", () => {
  expect(formatCell(undefined, "%").display).toBe("—");
  expect(emptyCell().display).toBe("—");
});

// ── computeDiff ───────────────────────────────────────────────────────────────
const num = (v: number | null): Cell =>
  v === null
    ? emptyCell()
    : { ...emptyCell(), value: v, display: `${v}` };
const ruleCell: Cell = { ...emptyCell(), value: null, display: "rule", basis: "rule" };

test("numeric diff computes delta target - base", () => {
  const d = computeDiff("numeric", num(2.1), num(1.5));
  expect(d).toEqual({ kind: "numeric", delta: -0.6 });
});

test("numeric diff with absent base → no national baseline note", () => {
  const d = computeDiff("numeric", num(null), num(0.5));
  expect(d?.kind).toBe("numeric");
  expect(d?.note).toBe("no national baseline");
});

test("numeric diff with rule-based target is not numerically comparable", () => {
  const d = computeDiff("numeric", num(0.4), ruleCell);
  expect(d?.note).toContain("rule-based");
});

test("silent numeric target yields no diff badge", () => {
  expect(computeDiff("numeric", num(0.4), num(null))).toBeUndefined();
});

const bool = (v: boolean | null): Cell =>
  v === null ? emptyCell() : { ...emptyCell(), value: v, display: v ? "Yes" : "No" };

test("boolean aligned / differs / silent / no_baseline", () => {
  expect(computeDiff("boolean", bool(true), bool(true))).toEqual({ kind: "aligned" });
  expect(computeDiff("boolean", bool(true), bool(false))).toEqual({ kind: "differs" });
  expect(computeDiff("boolean", bool(true), bool(null))).toEqual({ kind: "state_silent" });
  expect(computeDiff("boolean", bool(null), bool(true))).toEqual({ kind: "no_baseline" });
});

test("enum differs when values differ", () => {
  const a: Cell = { ...emptyCell(), value: "annual", display: "annual" };
  const b: Cell = { ...emptyCell(), value: "monthly", display: "monthly" };
  expect(computeDiff("enum", a, b)).toEqual({ kind: "differs" });
});

test("text dimension is never auto-diffed", () => {
  const a: Cell = { ...emptyCell(), value: "x", display: "x" };
  expect(computeDiff("text", a, a)).toEqual({ kind: "text" });
});
