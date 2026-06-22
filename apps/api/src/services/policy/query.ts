// DB queries for the policy comparison. All reads; parameterized throughout.

import { pool } from "../../lib/db";
import { type Cell, type ValueRow, type ValueType, formatCell, computeDiff } from "./compute";
import { computeScores, type ScoreRow } from "./scoring";

// Category render order (feature spec §4) — drives dimension row ordering.
const CATEGORY_ORDER = [
  "pricing", "open_access", "charges", "banking", "rpo",
  "dispatch", "repowering", "land", "incentives", "clearances",
];

export interface MetaJurisdiction {
  code: string; // state_code or 'national'
  name: string;
  kind: "national" | "state";
}

export interface MetaDimension {
  key: string;
  label: string;
  category: string;
  value_type: ValueType;
  unit: string | null;
  description: string | null;
}

export interface Meta {
  jurisdictions: MetaJurisdiction[];
  dimensions: MetaDimension[];
}

export async function getMeta(): Promise<Meta> {
  const [jur, dim] = await Promise.all([
    pool.query(
      `SELECT COALESCE(state_code,'national') AS code, name, kind
       FROM wce.jurisdiction
       ORDER BY (kind='national') DESC, name`,
    ),
    pool.query(
      `SELECT key, label, category, value_type, unit, description
       FROM wce.policy_dimension
       ORDER BY array_position($1::text[], category), sort_order`,
      [CATEGORY_ORDER],
    ),
  ]);
  return {
    jurisdictions: jur.rows as MetaJurisdiction[],
    dimensions: dim.rows as MetaDimension[],
  };
}

export interface CompareResult {
  mode: "plain" | "diff";
  base?: string;
  year: number | null;
  jurisdictions: string[];
  dimensions: MetaDimension[];
  matrix: Record<string, Record<string, Cell>>;
}

// `codes` order is preserved as the column order. In diff mode, `base` must be
// one of `codes`; each non-base column gets a server-computed diff vs base.
export async function getCompare(
  codes: string[],
  year: number | null,
  base?: string,
): Promise<CompareResult> {
  const { dimensions } = await getMeta();

  // Latest row per (jurisdiction, dimension) at or before `year` (or latest overall).
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (pv.jurisdiction_id, pv.dimension_id)
       COALESCE(j.state_code,'national') AS code,
       d.key AS dim, d.value_type, d.unit,
       pv.value_numeric, pv.value_bool, pv.value_enum, pv.value_text,
       pv.raw_excerpt, pv.source_name, pv.source_url, pv.policy_year, pv.confidence
     FROM wce.policy_value pv
     JOIN wce.jurisdiction j ON j.id = pv.jurisdiction_id
     JOIN wce.policy_dimension d ON d.id = pv.dimension_id
     WHERE COALESCE(j.state_code,'national') = ANY($1::text[])
       AND ($2::int IS NULL OR pv.policy_year <= $2)
     ORDER BY pv.jurisdiction_id, pv.dimension_id, pv.policy_year DESC`,
    [codes, year],
  );

  // Index rows by dim → code.
  type Row = ValueRow & { code: string; dim: string; unit: string | null };
  const byDimCode = new Map<string, Map<string, Row>>();
  for (const r of rows as Row[]) {
    if (!byDimCode.has(r.dim)) byDimCode.set(r.dim, new Map());
    byDimCode.get(r.dim)!.set(r.code, r);
  }

  const matrix: Record<string, Record<string, Cell>> = {};
  for (const d of dimensions) {
    const perCode = byDimCode.get(d.key);
    const baseCell = base ? formatCell(perCode?.get(base), d.unit) : undefined;
    const rowCells: Record<string, Cell> = {};
    for (const code of codes) {
      const cell = formatCell(perCode?.get(code), d.unit);
      if (base && baseCell && code !== base) {
        const diff = computeDiff(d.value_type, baseCell, cell);
        if (diff) cell.diff = diff;
      }
      rowCells[code] = cell;
    }
    matrix[d.key] = rowCells;
  }

  return {
    mode: base ? "diff" : "plain",
    ...(base ? { base } : {}),
    year,
    jurisdictions: codes,
    dimensions,
    matrix,
  };
}

export interface ChoroplethFeature {
  type: "Feature";
  geometry: unknown;
  properties: { state_code: string; name: string; value: number; display: string };
}

// Returns null if the dimension is unknown or not numeric (caller → 400).
export async function getChoropleth(
  dimKey: string,
  year: number | null,
): Promise<{ type: "FeatureCollection"; features: ChoroplethFeature[] } | null> {
  const dimRes = await pool.query(
    `SELECT value_type, unit FROM wce.policy_dimension WHERE key = $1`,
    [dimKey],
  );
  if (dimRes.rowCount === 0) return null;
  if (dimRes.rows[0].value_type !== "numeric") return null;
  const unit: string | null = dimRes.rows[0].unit;

  const { rows } = await pool.query(
    `SELECT j.state_code AS code, j.name, ST_AsGeoJSON(j.geom) AS geojson,
            pv.value_numeric, pv.policy_year
     FROM wce.jurisdiction j
     JOIN LATERAL (
       SELECT pv2.value_numeric, pv2.policy_year
       FROM wce.policy_value pv2
       JOIN wce.policy_dimension d ON d.id = pv2.dimension_id
       WHERE pv2.jurisdiction_id = j.id AND d.key = $1
         AND pv2.value_numeric IS NOT NULL
         AND ($2::int IS NULL OR pv2.policy_year <= $2)
       ORDER BY pv2.policy_year DESC
       LIMIT 1
     ) pv ON true
     WHERE j.kind = 'state' AND j.geom IS NOT NULL`,
    [dimKey, year],
  );

  const features: ChoroplethFeature[] = rows.map((r) => {
    const n = parseFloat(r.value_numeric);
    const display =
      unit === "₹/kWh" ? `₹${n.toFixed(2)}/kWh` : unit === "%" ? `${n.toFixed(2)}%` : unit === "kW" ? `${n} kW` : `${n}`;
    return {
      type: "Feature",
      geometry: JSON.parse(r.geojson),
      properties: { state_code: r.code, name: r.name, value: n, display },
    };
  });

  return { type: "FeatureCollection", features };
}

export interface PolicyScoreFeature {
  type: "Feature";
  geometry: unknown;
  properties: {
    state_code: string;
    name: string;
    score: number;
    rank: number;
    grade: string;
    coverage: number;
  };
}

// GeoJSON of state polygons + a composite wind-attractiveness score/rank/grade
// per state (feature spec §1: numeric dimension drives a choropleth). The score
// is a relative best→worst index computed by scoring.ts from sourced cells.
export async function getPolicyScore(
  year: number | null,
): Promise<{ type: "FeatureCollection"; features: PolicyScoreFeature[] }> {
  // Latest typed value per (state, dimension).
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (j.state_code, d.key)
       j.state_code AS code, d.key AS dim, d.value_type,
       pv.value_numeric, pv.value_bool, pv.value_enum, pv.value_text
     FROM wce.policy_value pv
     JOIN wce.jurisdiction j ON j.id = pv.jurisdiction_id AND j.kind = 'state'
     JOIN wce.policy_dimension d ON d.id = pv.dimension_id
     WHERE ($1::int IS NULL OR pv.policy_year <= $1)
     ORDER BY j.state_code, d.key, pv.policy_year DESC`,
    [year],
  );
  const scored = computeScores(rows as ScoreRow[]);
  const byCode = new Map(scored.map((s) => [s.code, s]));

  const geomRes = await pool.query(
    `SELECT state_code AS code, name, ST_AsGeoJSON(geom) AS geojson
     FROM wce.jurisdiction WHERE kind = 'state' AND geom IS NOT NULL`,
  );

  const features: PolicyScoreFeature[] = [];
  for (const r of geomRes.rows) {
    const s = byCode.get(r.code);
    if (!s) continue;
    features.push({
      type: "Feature",
      geometry: JSON.parse(r.geojson),
      properties: {
        state_code: r.code,
        name: r.name,
        score: s.score,
        rank: s.rank,
        grade: s.grade,
        coverage: s.coverage,
      },
    });
  }

  return { type: "FeatureCollection", features };
}
