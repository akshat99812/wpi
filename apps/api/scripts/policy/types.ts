// Shared types for the wind-policy comparison seed (db model in migration 004).
// Kept tiny and dependency-free so both the seed loader and the API can import.

export type ValueType = "numeric" | "boolean" | "enum" | "text";

export interface DimensionDef {
  key: string; // stable machine key — an API contract, never rename
  label: string;
  category: string;
  value_type: ValueType;
  unit: string | null;
  enum_values: string[] | null;
  description: string;
  sort_order: number;
}

export interface JurisdictionDef {
  kind: "national" | "state";
  name: string; // 'India (National)', 'Tamil Nadu'
  state_code: string | null; // 'TN'... ; null for national. 'national' is the API code.
  // full state name as it appears in india_states.geojson ST_NM (null for national)
  geom_name: string | null;
}

// One sourced policy value (a cell). Mirrors wce.policy_value. Lives in the
// data file scripts/policy/data/policy_values.json (grouped by jurisdiction).
//
// Provenance gate (enforced by the loader): raw_excerpt AND source_url are
// MANDATORY — a cell with no citation is never written.
//
// Exactly one of numeric/bool/enum/text is set and matches the dimension's
// value_type — EXCEPT the approved deviation: a NUMERIC dimension may instead
// carry `text` + `basis:"rule"` when the policy is a rule, not a fixed number.
export interface PolicyValueRecord {
  dimension: string; // dimension key
  numeric?: number | null;
  bool?: boolean | null;
  enum?: string | null;
  text?: string | null;
  basis?: "rule"; // only valid on a numeric dimension carrying `text`
  raw_excerpt: string;
  source_name: string;
  source_url: string;
  policy_year: number;
  confidence: "verified" | "extracted" | "estimated";
  caveat?: string | null;
}

export interface JurisdictionData {
  jurisdiction: string; // state_code or 'national'
  values: PolicyValueRecord[];
}

// Category render order for the comparison table (feature spec §4).
export const CATEGORY_ORDER = [
  "pricing",
  "open_access",
  "charges",
  "banking",
  "rpo",
  "dispatch",
  "repowering",
  "land",
  "incentives",
  "clearances",
] as const;
