/**
 * One-time / re-runnable CSV → PostGIS ingest for the Pro wind-farm map.
 *
 * Usage:
 *   bun run apps/api/scripts/ingest-windmills.ts --path=/path/to/wra_masts.csv [--truncate]
 *
 * Source: NIWE / WRA mast inventory CSV (wra_masts.csv). One row per mast.
 * Decimal `latitude` / `longitude` columns drive the geometry; DMS triplets
 * in the CSV are ignored (redundant with the decimal pair). Rows with a
 * missing or non-finite lat/lon are dropped — they can't be placed on the map.
 *
 * Idempotency is NOT automatic — pass --truncate to wipe before re-import,
 * otherwise duplicates accumulate (PK is a generated UUID).
 */

import { parse } from "csv-parse/sync";
import { pool } from "../src/lib/db";
import fs from "node:fs";

type Row = Record<string, string>;

const args = parseArgs(process.argv.slice(2));
const csvPath = args.path;
const truncate = args.truncate === "true" || args.truncate === "";

if (!csvPath) {
  console.error("Usage: bun run ingest-windmills.ts --path=/path/to/wra_masts.csv [--truncate]");
  process.exit(1);
}
const csvPathResolved: string = csvPath;
if (!fs.existsSync(csvPathResolved)) {
  console.error(`File not found: ${csvPathResolved}`);
  process.exit(1);
}

const BATCH_SIZE = 500;

type MastInsert = {
  lon: number;
  lat: number;
  cum_no: number | null;
  sl_no: number | null;
  state: string | null;
  station: string | null;
  district: string | null;
  date_commence: string | null;
  date_close: string | null;
  mast_height_m: number | null;
  elevation_masl: number | null;
  maws_ms: number | null;
  mawpd_wm2: number | null;
  coord_complete: boolean | null;
};

async function main() {
  console.log(`[ingest] reading ${csvPathResolved}`);

  const text = fs.readFileSync(csvPathResolved, "utf8");
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Row[];

  const masts: MastInsert[] = [];
  let dropped = 0;
  for (const r of rows) {
    const lat = numOrNull(r.latitude);
    const lon = numOrNull(r.longitude);
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      dropped++;
      continue;
    }
    masts.push({
      lon,
      lat,
      cum_no: intOrNull(r.cum_no),
      sl_no: intOrNull(r.sl_no),
      state: strOrNull(r.state),
      station: strOrNull(r.station),
      district: strOrNull(r.district),
      date_commence: parseDmyDate(r.date_commence),
      date_close: parseDmyDate(r.date_close),
      mast_height_m: numOrNull(r.mast_height_m),
      elevation_masl: numOrNull(r.elevation_masl),
      maws_ms: numOrNull(r.maws_ms),
      mawpd_wm2: numOrNull(r.mawpd_wm2),
      coord_complete: parseBool(r.coord_complete),
    });
  }

  console.log(
    `[ingest] parsed ${rows.length} rows (${masts.length} valid, ${dropped} dropped for missing lat/lon)`,
  );

  if (masts.length === 0) {
    console.log("[ingest] nothing to insert");
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (truncate) {
      console.log("[ingest] TRUNCATE windmills (--truncate set)");
      await client.query("TRUNCATE TABLE windmills");
    }

    let inserted = 0;
    const COLS = 14; // lon, lat, cum_no, sl_no, state, station, district,
                    // date_commence, date_close, mast_height_m, elevation_masl,
                    // maws_ms, mawpd_wm2, coord_complete

    for (let i = 0; i < masts.length; i += BATCH_SIZE) {
      const batch = masts.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((m, idx) => {
        values.push(
          m.lon,
          m.lat,
          m.cum_no,
          m.sl_no,
          m.state,
          m.station,
          m.district,
          m.date_commence,
          m.date_close,
          m.mast_height_m,
          m.elevation_masl,
          m.maws_ms,
          m.mawpd_wm2,
          m.coord_complete,
        );

        const b = idx * COLS;
        // Explicit casts on every param — pg can't infer types when a batch
        // contains NULLs (error 42P18).
        placeholders.push(
          `(ST_SetSRID(ST_MakePoint($${b + 1}::float8, $${b + 2}::float8), 4326),` +
            ` $${b + 3}::integer, $${b + 4}::integer,` +
            ` $${b + 5}::text, $${b + 6}::text, $${b + 7}::text,` +
            ` $${b + 8}::date, $${b + 9}::date,` +
            ` $${b + 10}::numeric, $${b + 11}::numeric,` +
            ` $${b + 12}::numeric, $${b + 13}::numeric,` +
            ` $${b + 14}::boolean)`,
        );
      });

      const sql = `
        INSERT INTO windmills
          (geom, cum_no, sl_no, state, station, district,
           date_commence, date_close, mast_height_m, elevation_masl,
           maws_ms, mawpd_wm2, coord_complete)
        VALUES ${placeholders.join(",")}
      `;
      const res = await client.query(sql, values);
      inserted += res.rowCount ?? batch.length;
      process.stdout.write(`\r[ingest] inserted ${inserted}/${masts.length}`);
    }

    await client.query("COMMIT");
    process.stdout.write("\n");
    console.log(`[ingest] done — inserted ${inserted} mast points`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n[ingest] failed, rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// ── parsers ───────────────────────────────────────────────────────────────────

// CSV dates are DD/MM/YY (Indian convention). Two-digit years ≤30 are 20xx,
// otherwise 19xx — matches the existing KMZ-side convention and covers the
// 1992 → 2030 range observed in the source.
function parseDmyDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const rawYear = parseInt(m[3], 10);
  let year = rawYear;
  if (m[3].length === 2) year = rawYear <= 30 ? 2000 + rawYear : 1900 + rawYear;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function parseBool(s: string | undefined): boolean | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t === "true" || t === "t" || t === "1" || t === "yes") return true;
  if (t === "false" || t === "f" || t === "0" || t === "no") return false;
  return null;
}

function numOrNull(s: string | undefined): number | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(s: string | undefined): number | null {
  const n = numOrNull(s);
  return n == null ? null : Math.trunc(n);
}

function strOrNull(s: string | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t ? t : null;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = "";
    }
  }
  return out;
}

main();
