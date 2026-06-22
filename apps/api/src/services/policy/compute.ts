// Display formatting + server-side diff for the policy comparison (spec §5.3).
// The UI renders `display` verbatim and consumes `diff` as-is — no client math.

export type ValueType = "numeric" | "boolean" | "enum" | "text";

export type DiffKind = "numeric" | "aligned" | "differs" | "state_silent" | "no_baseline" | "text";

export interface Diff {
  kind: DiffKind;
  delta?: number | null;
  note?: string;
}

export interface Cell {
  value: number | boolean | string | null;
  display: string;
  raw: string | null;
  source: string | null;
  source_url: string | null;
  policy_year: number | null;
  confidence: string | null;
  basis?: "rule";
  diff?: Diff;
}

// A row as returned by the compare query (pg returns NUMERIC as string).
export interface ValueRow {
  value_type: ValueType;
  value_numeric: string | number | null;
  value_bool: boolean | null;
  value_enum: string | null;
  value_text: string | null;
  raw_excerpt: string | null;
  source_name: string | null;
  source_url: string | null;
  policy_year: number | null;
  confidence: string | null;
}

const EM_DASH = "—";

export function emptyCell(): Cell {
  return {
    value: null,
    display: EM_DASH,
    raw: null,
    source: null,
    source_url: null,
    policy_year: null,
    confidence: null,
  };
}

function formatNumeric(n: number, unit: string | null): string {
  if (unit === "₹/kWh") return `₹${n.toFixed(2)}/kWh`;
  if (unit === "%") return `${n.toFixed(2)}%`;
  if (unit === "kW") return `${n} kW`;
  return unit ? `${n} ${unit}` : `${n}`;
}

// Build a rendered cell from a DB row + the dimension's unit. `unit` only used
// for numeric dimensions.
export function formatCell(row: ValueRow | undefined, unit: string | null): Cell {
  if (!row) return emptyCell();
  const base: Cell = {
    value: null,
    display: EM_DASH,
    raw: row.raw_excerpt ?? null,
    source: row.source_name ?? null,
    source_url: row.source_url ?? null,
    policy_year: row.policy_year ?? null,
    confidence: row.confidence ?? null,
  };

  // Approved deviation: numeric dimension expressing a RULE carries value_text.
  if (row.value_type === "numeric" && row.value_text != null && row.value_numeric == null) {
    return { ...base, value: null, display: row.value_text, basis: "rule" };
  }

  switch (row.value_type) {
    case "numeric": {
      if (row.value_numeric == null) return base; // silent → em dash
      const n = typeof row.value_numeric === "string" ? parseFloat(row.value_numeric) : row.value_numeric;
      return { ...base, value: n, display: formatNumeric(n, unit) };
    }
    case "boolean":
      if (row.value_bool == null) return base;
      return { ...base, value: row.value_bool, display: row.value_bool ? "Yes" : "No" };
    case "enum":
      if (row.value_enum == null) return base;
      return { ...base, value: row.value_enum, display: row.value_enum };
    case "text":
      if (row.value_text == null) return base;
      return { ...base, value: row.value_text, display: row.value_text };
    default:
      return base;
  }
}

const isAbsent = (c: Cell) => c.value === null && c.basis !== "rule" && c.display === EM_DASH;
const isRule = (c: Cell) => c.basis === "rule";

// Diff a target cell against the base cell for a dimension of `valueType`.
// Returns undefined when no diff badge should render (e.g. silent numeric target).
export function computeDiff(valueType: ValueType, base: Cell, target: Cell): Diff | undefined {
  if (valueType === "text") return { kind: "text" };

  if (valueType === "numeric") {
    if (isAbsent(target)) return undefined; // grey, no badge
    if (isRule(target)) return { kind: "numeric", note: "rule-based, not numerically comparable" };
    if (isAbsent(base) || isRule(base)) return { kind: "numeric", delta: null, note: "no national baseline" };
    const delta = Number(((target.value as number) - (base.value as number)).toFixed(4));
    return { kind: "numeric", delta };
  }

  // boolean | enum
  if (isAbsent(base)) return { kind: "no_baseline" };
  if (isAbsent(target)) return { kind: "state_silent" };
  return target.value === base.value ? { kind: "aligned" } : { kind: "differs" };
}
