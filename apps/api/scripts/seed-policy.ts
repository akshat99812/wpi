// Seed loader for the wind-policy comparison (migration 004).
//
//   bun apps/api/scripts/seed-policy.ts structure   # dimensions + jurisdictions(+geom)
//   bun apps/api/scripts/seed-policy.ts data        # policy_value rows from the data file
//   bun apps/api/scripts/seed-policy.ts all         # both (default)
//
// Idempotent: upserts on natural keys, safe to re-run. Every policy_value is
// validated before ANY write — the loader fails fast and writes nothing if a
// record is missing its citation (raw_excerpt + source_url) or violates the
// one-value-column rule. This is the "no adhoc data" gate.

import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { pool, dbAvailable } from "../src/lib/db";
import { DIMENSIONS } from "./policy/dimensions";
import { JURISDICTIONS } from "./policy/jurisdictions";
import type { DimensionDef, JurisdictionData, PolicyValueRecord } from "./policy/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEOJSON_PATH = path.resolve(__dirname, "../data/cache/india_states.geojson");
const DATA_PATH = path.resolve(__dirname, "./policy/data/policy_values.json");

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function fail(msg: string): never {
  console.error(`[seed-policy] ${msg}`);
  process.exit(1);
}

// ── Dimensions ────────────────────────────────────────────────────────────────
async function seedDimensions(): Promise<void> {
  for (const d of DIMENSIONS) {
    await pool.query(
      `INSERT INTO wce.policy_dimension (key,label,category,value_type,unit,enum_values,description,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (key) DO UPDATE SET
         label=EXCLUDED.label, category=EXCLUDED.category, value_type=EXCLUDED.value_type,
         unit=EXCLUDED.unit, enum_values=EXCLUDED.enum_values, description=EXCLUDED.description,
         sort_order=EXCLUDED.sort_order`,
      [d.key, d.label, d.category, d.value_type, d.unit, d.enum_values, d.description, d.sort_order],
    );
  }
  console.log(`[seed-policy] dimensions: ${DIMENSIONS.length} upserted`);
}

// ── Jurisdictions (+ geom) ────────────────────────────────────────────────────
function loadStateGeoms(): Map<string, unknown> {
  const raw = fs.readFileSync(GEOJSON_PATH, "utf-8");
  const fc = JSON.parse(raw) as { features: { properties: Record<string, unknown>; geometry: unknown }[] };
  const byName = new Map<string, unknown>();
  for (const f of fc.features) {
    const name = f.properties?.ST_NM;
    if (typeof name === "string") byName.set(name, f.geometry);
  }
  return byName;
}

async function seedJurisdictions(): Promise<void> {
  const geoms = loadStateGeoms();
  for (const j of JURISDICTIONS) {
    if (j.kind === "national") {
      // state_code is NULL (not conflict-able) — insert once, keep name fresh.
      await pool.query(
        `INSERT INTO wce.jurisdiction (kind,name,state_code,geom)
         SELECT 'national',$1,NULL,NULL
         WHERE NOT EXISTS (SELECT 1 FROM wce.jurisdiction WHERE kind='national')`,
        [j.name],
      );
      await pool.query(`UPDATE wce.jurisdiction SET name=$1 WHERE kind='national'`, [j.name]);
      continue;
    }
    const geometry = j.geom_name ? geoms.get(j.geom_name) : null;
    if (!geometry) fail(`no geometry for state "${j.name}" (ST_NM "${j.geom_name}") in ${GEOJSON_PATH}`);
    await pool.query(
      `INSERT INTO wce.jurisdiction (kind,name,state_code,geom)
       VALUES ('state',$1,$2, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($3)),3)))
       ON CONFLICT (state_code) DO UPDATE SET name=EXCLUDED.name, geom=EXCLUDED.geom`,
      [j.name, j.state_code, JSON.stringify(geometry)],
    );
  }
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE kind='state') AS states,
            count(*) FILTER (WHERE kind='state' AND geom IS NOT NULL) AS with_geom,
            count(*) FILTER (WHERE kind='national') AS national
     FROM wce.jurisdiction`,
  );
  console.log(
    `[seed-policy] jurisdictions: national=${rows[0].national} states=${rows[0].states} (geom on ${rows[0].with_geom})`,
  );
}

// ── Policy values (validated, then loaded) ────────────────────────────────────
function setValueFields(r: PolicyValueRecord): string[] {
  const set: string[] = [];
  if (r.numeric !== undefined && r.numeric !== null) set.push("numeric");
  if (r.bool !== undefined && r.bool !== null) set.push("bool");
  if (r.enum !== undefined && r.enum !== null) set.push("enum");
  if (r.text !== undefined && r.text !== null) set.push("text");
  return set;
}

// Returns an error string, or null if the record is valid for its dimension.
function validateRecord(r: PolicyValueRecord, dim: DimensionDef | undefined, where: string): string | null {
  if (!dim) return `${where}: unknown dimension "${r.dimension}"`;
  if (!r.raw_excerpt || !r.raw_excerpt.trim()) return `${where} [${r.dimension}]: missing raw_excerpt (provenance gate)`;
  if (!r.source_url || !r.source_url.trim()) return `${where} [${r.dimension}]: missing source_url (provenance gate)`;
  if (!Number.isInteger(r.policy_year)) return `${where} [${r.dimension}]: policy_year must be an integer`;
  if (!["verified", "extracted", "estimated"].includes(r.confidence))
    return `${where} [${r.dimension}]: bad confidence "${r.confidence}"`;

  const set = setValueFields(r);
  if (set.length !== 1) return `${where} [${r.dimension}]: exactly one value field required, got [${set.join(",")}]`;
  const got = set[0];

  // Approved deviation: a NUMERIC dimension may carry `text` + basis:'rule'.
  if (dim.value_type === "numeric" && got === "text") {
    if (r.basis !== "rule") return `${where} [${r.dimension}]: numeric dim with text needs basis:"rule"`;
    return null;
  }
  if (r.basis === "rule" && !(dim.value_type === "numeric" && got === "text"))
    return `${where} [${r.dimension}]: basis:"rule" only valid on a numeric dimension carrying text`;

  const expected: Record<string, string> = { numeric: "numeric", boolean: "bool", enum: "enum", text: "text" };
  if (got !== expected[dim.value_type])
    return `${where} [${r.dimension}]: value_type is ${dim.value_type} but got "${got}"`;
  if (dim.value_type === "enum" && dim.enum_values && !dim.enum_values.includes(r.enum as string))
    return `${where} [${r.dimension}]: enum "${r.enum}" not in {${dim.enum_values.join(",")}}`;
  return null;
}

async function seedData(): Promise<void> {
  if (!fs.existsSync(DATA_PATH)) {
    console.log(`[seed-policy] no data file at ${DATA_PATH} — skipping policy_value load`);
    return;
  }
  const dataset = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) as JurisdictionData[];
  const dimByKey = new Map(DIMENSIONS.map((d) => [d.key, d]));

  // Resolve jurisdiction ids by API code (state_code or 'national').
  const { rows: jurRows } = await pool.query(
    `SELECT id, COALESCE(state_code,'national') AS code FROM wce.jurisdiction`,
  );
  const jurIdByCode = new Map<string, number>(jurRows.map((r) => [r.code as string, r.id as number]));

  // Validate EVERYTHING first — write nothing on any error.
  const errors: string[] = [];
  for (const block of dataset) {
    if (!jurIdByCode.has(block.jurisdiction))
      errors.push(`unknown jurisdiction "${block.jurisdiction}" (run "structure" first?)`);
    for (const r of block.values) {
      const e = validateRecord(r, dimByKey.get(r.dimension), block.jurisdiction);
      if (e) errors.push(e);
    }
  }
  if (errors.length) {
    console.error(`[seed-policy] ${errors.length} validation error(s):`);
    for (const e of errors) console.error("  - " + e);
    fail("aborting — no rows written (fix the data file)");
  }

  let n = 0;
  for (const block of dataset) {
    const jurId = jurIdByCode.get(block.jurisdiction)!;
    for (const r of block.values) {
      const dim = dimByKey.get(r.dimension)!;
      await pool.query(
        `INSERT INTO wce.policy_value
           (jurisdiction_id,dimension_id,value_numeric,value_bool,value_enum,value_text,
            raw_excerpt,source_name,source_url,policy_year,as_of_date,confidence)
         SELECT $1,d.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM wce.policy_dimension d WHERE d.key=$2
         ON CONFLICT (jurisdiction_id,dimension_id,policy_year) DO UPDATE SET
           value_numeric=EXCLUDED.value_numeric, value_bool=EXCLUDED.value_bool,
           value_enum=EXCLUDED.value_enum, value_text=EXCLUDED.value_text,
           raw_excerpt=EXCLUDED.raw_excerpt, source_name=EXCLUDED.source_name,
           source_url=EXCLUDED.source_url, as_of_date=EXCLUDED.as_of_date, confidence=EXCLUDED.confidence`,
        [
          jurId, dim.key,
          r.numeric ?? null, r.bool ?? null, r.enum ?? null, r.text ?? null,
          r.raw_excerpt, r.source_name, r.source_url, r.policy_year, today, r.confidence,
        ],
      );
      n++;
    }
  }
  console.log(`[seed-policy] policy_value: ${n} rows upserted across ${dataset.length} jurisdictions`);
}

async function main(): Promise<void> {
  if (!dbAvailable()) fail("DATABASE_URL not set — start PostGIS and set DATABASE_URL.");
  const cmd = process.argv[2] ?? "all";
  if (!["structure", "data", "all"].includes(cmd)) fail(`unknown command "${cmd}" (use structure|data|all)`);

  if (cmd === "structure" || cmd === "all") {
    await seedDimensions();
    await seedJurisdictions();
  }
  if (cmd === "data" || cmd === "all") {
    await seedData();
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
