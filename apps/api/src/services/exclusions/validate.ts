/**
 * Phase F — validation, classification audit, coverage, provenance.
 *
 *  - coverageReport: per layer_code feature count, area, % of India, tier, legal.
 *  - classificationAudit: assert is_legal_boundary=true ONLY for tier 1–2
 *    (gazette / official GIS: CRZ, notified wetlands, RF-PF, notified ESZ).
 *    OSM / FSI-cover / buffer-off-point must be false.
 *  - writeLicenses: emit data/by-source/LICENSES.md, surfacing WDPA's
 *    non-commercial status explicitly so it's never promoted into the product.
 */
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

const ROOT = path.resolve(import.meta.dir, "../../.."); // apps/api

export type CoverageRow = {
  table: string;
  layer_code: string;
  source_id: string;
  legal_tier: number;
  is_legal_boundary: boolean;
  features: number;
  area_km2: number;
  pct_india: number | null;
};

type RawCov = {
  layer_code: string;
  source_id: string;
  legal_tier: number;
  is_legal_boundary: boolean;
  features: string;
  area_km2: number;
};

export async function coverageReport(pool: Pool): Promise<CoverageRow[]> {
  const india = await pool.query<{ a: number | null }>(
    `SELECT SUM(ST_Area(geom::geography))/1e6 AS a FROM wce.admin_country`,
  );
  const indiaKm2 = india.rows[0]?.a ?? null;
  const pct = (a: number) => (indiaKm2 && indiaKm2 > 0 ? Math.round((a / indiaKm2) * 1e6) / 1e4 : null);

  const poly = await pool.query<RawCov>(
    `SELECT p.layer_code, p.source_id, r.legal_tier,
            COALESCE((p.attrs->>'is_legal_boundary')::boolean, r.is_legal_boundary) AS is_legal_boundary,
            COUNT(*) AS features, COALESCE(SUM(ST_Area(p.geom::geography))/1e6,0) AS area_km2
     FROM wce.excl_polygon p JOIN wce.source_registry r USING (source_id)
     GROUP BY p.layer_code, p.source_id, r.legal_tier,
              COALESCE((p.attrs->>'is_legal_boundary')::boolean, r.is_legal_boundary)
     ORDER BY p.layer_code`,
  );
  const buf = await pool.query<RawCov>(
    `SELECT b.layer_code, b.source_id, r.legal_tier, r.is_legal_boundary,
            COUNT(*) AS features, COALESCE(SUM(ST_Area(b.geom::geography))/1e6,0) AS area_km2
     FROM wce.excl_buffer b JOIN wce.source_registry r USING (source_id)
     GROUP BY b.layer_code, b.source_id, r.legal_tier, r.is_legal_boundary
     ORDER BY b.layer_code`,
  );

  const map = (table: string) => (row: RawCov): CoverageRow => ({
    table,
    layer_code: row.layer_code,
    source_id: row.source_id,
    legal_tier: row.legal_tier,
    is_legal_boundary: row.is_legal_boundary,
    features: Number(row.features),
    area_km2: Math.round(row.area_km2 * 100) / 100,
    pct_india: pct(row.area_km2),
  });

  return [...poly.rows.map(map("excl_polygon")), ...buf.rows.map(map("excl_buffer"))];
}

export type AuditViolation = { id: string; layer_code: string; source_id: string; legal_tier: number; reason: string };

/** is_legal_boundary=true is only valid for tier 1–2. Everything else flagged. */
export async function classificationAudit(pool: Pool): Promise<AuditViolation[]> {
  const res = await pool.query<AuditViolation>(
    `SELECT p.id::text AS id, p.layer_code, p.source_id, r.legal_tier,
            'is_legal_boundary=true but legal_tier='||r.legal_tier||' (only tier 1–2 may be legal)' AS reason
     FROM wce.excl_polygon p JOIN wce.source_registry r USING (source_id)
     WHERE COALESCE((p.attrs->>'is_legal_boundary')::boolean, r.is_legal_boundary) = true
       AND r.legal_tier > 2`,
  );
  return res.rows;
}

/** Orphan check (FK already enforces this, but assert it anyway for the report). */
export async function orphanCheck(pool: Pool): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM wce.excl_polygon p
     LEFT JOIN wce.source_registry r USING (source_id) WHERE r.source_id IS NULL`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** Invalid-geometry count (should be 0 after ST_MakeValid at load). */
export async function invalidGeomCount(pool: Pool): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM wce.excl_polygon WHERE NOT ST_IsValid(geom)`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function writeLicenses(
  pool: Pool,
  outPath = path.join(ROOT, "data/by-source/LICENSES.md"),
): Promise<string> {
  const rows = await pool.query<{
    source_id: string; license: string; authority: string | null; url: string | null;
    legal_tier: number; is_legal_boundary: boolean; acquired_at: string | null; notes: string | null;
  }>(
    `SELECT source_id, license, authority, url, legal_tier, is_legal_boundary, acquired_at, notes
     FROM wce.source_registry ORDER BY legal_tier, source_id`,
  );

  const lines: string[] = [
    "# Exclusion-zone data — license & provenance manifest",
    "",
    "Generated from `wce.source_registry`. Every layer ingested into `wce.*` is",
    "CC0 / CC-BY / ODbL (OSM) / Indian Government open data — commercially usable",
    "with attribution.",
    "",
    "> **WDPA (Protected Planet) is NOT in this database.** It prohibits commercial",
    "> use and derivatives without UNEP-WCMC permission and disclaims boundary legal",
    "> status. It is used only as an offline cross-check and must never be loaded,",
    "> served, or promoted into the platform.",
    "",
    "| source_id | tier | legal? | license | authority | acquired | notes |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of rows.rows) {
    const acq = r.acquired_at ? new Date(r.acquired_at).toISOString().slice(0, 10) : "—";
    const notes = (r.notes ?? "").replace(/\|/g, "\\|");
    lines.push(
      `| \`${r.source_id}\` | ${r.legal_tier} | ${r.is_legal_boundary ? "✅" : "—"} | ${r.license} | ${r.authority ?? "—"} | ${acq} | ${notes} |`,
    );
  }
  lines.push("");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"));
  return outPath;
}
