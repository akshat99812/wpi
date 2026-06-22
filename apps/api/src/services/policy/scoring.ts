// Composite "wind-investment attractiveness" score per state, derived ONLY from
// the sourced policy_value data. This is a TRANSPARENT, DETERMINISTIC index —
// not a legal fact. Every input is a sourced cell; the rubric below (weight +
// direction per dimension) is the whole methodology, tune it in one place.
//
// Scoring is RELATIVE across the compared states (min-max normalised), so the
// output is a best→worst ranking, which is exactly what the map legend shows.
// A state is scored only on dimensions it actually has data for (rule-based or
// silent cells don't count for or against it); `coverage` reports how much of
// the rubric weight was available.

export interface ScoreRow {
  code: string; // state_code
  dim: string;
  value_type: "numeric" | "boolean" | "enum" | "text";
  value_numeric: string | number | null;
  value_bool: boolean | null;
  value_enum: string | null;
  value_text: string | null;
}

type RubricEntry =
  | { dimension: string; weight: number; kind: "bool"; favorable: boolean }
  | { dimension: string; weight: number; kind: "numeric"; direction: "higher" | "lower" }
  | { dimension: string; weight: number; kind: "enum"; order: string[] }
  | { dimension: string; weight: number; kind: "text_present" };

// THE RUBRIC — favourability for a wind developer. Edit weights/direction here.
export const RUBRIC: RubricEntry[] = [
  // open access & dispatch
  { dimension: "third_party_sale", weight: 1.0, kind: "bool", favorable: true },
  { dimension: "captive_use", weight: 1.0, kind: "bool", favorable: true },
  { dimension: "must_run", weight: 0.5, kind: "bool", favorable: true },
  { dimension: "geoa_threshold_kw", weight: 0.5, kind: "numeric", direction: "lower" },
  // charges (lower / more concession = better)
  { dimension: "wheeling_concession", weight: 1.0, kind: "numeric", direction: "higher" },
  { dimension: "css_applicable", weight: 1.0, kind: "bool", favorable: false },
  { dimension: "css_concession", weight: 1.0, kind: "numeric", direction: "higher" },
  { dimension: "additional_surcharge", weight: 0.5, kind: "bool", favorable: false },
  { dimension: "transmission_loss", weight: 0.5, kind: "numeric", direction: "lower" },
  // banking
  { dimension: "banking_allowed", weight: 1.0, kind: "bool", favorable: true },
  { dimension: "banking_period", weight: 1.0, kind: "enum", order: ["none", "monthly", "seasonal", "annual"] },
  { dimension: "banking_charge", weight: 1.0, kind: "numeric", direction: "lower" },
  { dimension: "banking_third_party", weight: 0.5, kind: "bool", favorable: true },
  // incentives & clearances
  { dimension: "electricity_duty_exemption", weight: 0.5, kind: "text_present" },
  { dimension: "green_energy_cess", weight: 0.5, kind: "numeric", direction: "lower" },
  { dimension: "single_window", weight: 0.5, kind: "bool", favorable: true },
  { dimension: "gram_panchayat_noc", weight: 0.25, kind: "bool", favorable: false },
];

export interface DimContribution {
  dimension: string;
  subscore: number; // 0..1
  weight: number;
}

export interface ScoredState {
  code: string;
  score: number; // 0..100 (relative)
  rank: number; // 1 = best
  grade: "A" | "B" | "C" | "D" | "F";
  coverage: number; // 0..1 share of rubric weight with data
  contributions: DimContribution[];
}

function numFor(rows: ScoreRow[], code: string, dim: string): number | null {
  const r = rows.find((x) => x.code === code && x.dim === dim);
  if (!r || r.value_numeric == null) return null; // rule-based/silent → no number
  return typeof r.value_numeric === "string" ? parseFloat(r.value_numeric) : r.value_numeric;
}

function grade(score: number): ScoredState["grade"] {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

// Compute relative scores for every state present in `rows`.
export function computeScores(rows: ScoreRow[]): ScoredState[] {
  const codes = Array.from(new Set(rows.map((r) => r.code)));

  // Pre-compute min/max per numeric dimension across states (for normalisation).
  const ranges = new Map<string, { min: number; max: number }>();
  for (const e of RUBRIC) {
    if (e.kind !== "numeric") continue;
    const vals = codes.map((c) => numFor(rows, c, e.dimension)).filter((v): v is number => v != null);
    if (vals.length) ranges.set(e.dimension, { min: Math.min(...vals), max: Math.max(...vals) });
  }

  const scored: ScoredState[] = codes.map((code) => {
    let weighted = 0;
    let covered = 0;
    const contributions: DimContribution[] = [];

    for (const e of RUBRIC) {
      const row = rows.find((x) => x.code === code && x.dim === e.dimension);
      let sub: number | null = null;

      if (e.kind === "bool") {
        if (row?.value_bool != null) sub = row.value_bool === e.favorable ? 1 : 0;
      } else if (e.kind === "enum") {
        if (row?.value_enum != null) {
          const idx = e.order.indexOf(row.value_enum);
          if (idx >= 0) sub = e.order.length > 1 ? idx / (e.order.length - 1) : 0.5;
        }
      } else if (e.kind === "text_present") {
        if (row?.value_text != null && row.value_text.trim()) sub = 1;
      } else {
        // numeric
        const v = numFor(rows, code, e.dimension);
        const rg = ranges.get(e.dimension);
        if (v != null && rg) {
          if (rg.max === rg.min) sub = 0.5;
          else {
            const norm = (v - rg.min) / (rg.max - rg.min);
            sub = e.direction === "higher" ? norm : 1 - norm;
          }
        }
      }

      if (sub != null) {
        weighted += sub * e.weight;
        covered += e.weight;
        contributions.push({ dimension: e.dimension, subscore: Number(sub.toFixed(3)), weight: e.weight });
      }
    }

    const score = covered > 0 ? Number(((weighted / covered) * 100).toFixed(1)) : 0;
    const totalWeight = RUBRIC.reduce((s, e) => s + e.weight, 0);
    return {
      code,
      score,
      rank: 0, // filled after sort
      grade: grade(score),
      coverage: Number((covered / totalWeight).toFixed(2)),
      contributions,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}
