/**
 * One-time / re-runnable Overpass → PostGIS ingest of every INDIVIDUAL wind
 * turbine in India (OpenStreetMap / OpenInfraMap: power=generator +
 * generator:source=wind). Powers the Pro-map "Wind turbines" black-dot layer.
 *
 * Usage:
 *   bun run apps/api/scripts/ingest-turbines.ts [--truncate] [--no-cache]
 *                                               [--cell-deg=3] [--concurrency=2]
 *
 * Why chunked: a single area(India) Overpass query times out (verified — 121 s
 * limit hit). bbox queries are far cheaper than area-membership, so we tile
 * India's bounding box into ~cell-deg° cells and union the results, deduping by
 * (osm_type, osm_id) across cell borders. Each cell's raw JSON is cached to
 * data/cache/turbines/ so re-runs are instant and Overpass-friendly.
 *
 * Idempotent: upsert ON CONFLICT (osm_type, osm_id) — re-running refreshes
 * attributes in place, no duplicates. --truncate wipes first for a clean import.
 *
 * Coordinates: node lat/lon directly; ways (turbines mapped as small areas)
 * use Overpass `out center`. WGS84, stored as GEOMETRY(Point,4326).
 */

import { pool } from "../src/lib/db";
import fs from "node:fs";
import path from "node:path";

// ── India bbox (lon/lat) — from public/india-outline.geojson, +pad. ─────────
const INDIA = { west: 68.0, south: 6.5, east: 97.5, north: 37.6 };

// Overpass endpoints, tried in order on retry. overpass-api.de is the most
// reliable for India; the mirrors are kept as fallbacks but are frequently
// unreachable, so the main instance leads and a transient 504 just retries it.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "wce-turbine-ingest/1.0 (wind-energy map; contact via repo)";
const PER_CELL_TIMEOUT_S = 120; // Overpass-side [timeout:]
const FETCH_TIMEOUT_MS = 150_000; // client-side abort
const MAX_RETRIES = 6;
// Politeness delay after each LIVE (cache-miss) request — the public Overpass
// instances rate-limit anonymous clients hard (HTTP 429) above ~1 slot, so we
// default to sequential (concurrency 1) + this gap rather than hammering.
const INTER_REQUEST_DELAY_MS = 1200;
const BATCH_SIZE = 500;

const CACHE_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../data/cache/turbines",
);

const args = parseArgs(process.argv.slice(2));
const truncate = flag(args.truncate);
const useCache = !flag(args["no-cache"]);
const cellDeg = numArg(args["cell-deg"], 3);
// Default sequential — public Overpass rejects concurrent anonymous slots.
const concurrency = Math.max(1, Math.trunc(numArg(args.concurrency, 1)));

// ── Parsed turbine record (one per OSM element) ─────────────────────────────
interface Turbine {
  osmType: "node" | "way";
  osmId: number;
  lon: number;
  lat: number;
  name: string | null;
  operator: string | null;
  manufacturer: string | null;
  model: string | null;
  ratedPowerKw: number | null;
  ratedPowerRaw: string | null;
  hubHeightM: number | null;
  rotorDiameterM: number | null;
  startDate: string | null;
  eleM: number | null;
  ref: string | null;
  tags: Record<string, string>;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// ── Tag parsers ─────────────────────────────────────────────────────────────

/** "2.1 MW" | "800 kW" | "2000000 W" | "2000000" | "yes" → kW (or null). */
function parseRatedKw(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([\d.,]+)\s*(gw|mw|kw|w)?/i);
  if (!m || !m[1]) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] || "").toLowerCase();
  switch (unit) {
    case "gw":
      return n * 1_000_000;
    case "mw":
      return n * 1000;
    case "kw":
      return n;
    case "w":
      return n / 1000;
    default:
      // No unit: OSM convention for generator:output:electricity is watts when
      // bare and large (e.g. 2000000). Heuristic: ≥10000 → watts, else kW.
      return n >= 10_000 ? n / 1000 : n;
  }
}

/** "80" | "80 m" | "119.5m" → metres (or null). */
function parseMetres(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([\d.,]+)\s*m?\b/i);
  if (!m || !m[1]) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function strOrNull(s: string | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t ? t : null;
}

/** Turbine model name — skip generator:type (axis orientation, not a model). */
function pickModel(t: Record<string, string>): string | null {
  const axis = (t["generator:type"] || "").toLowerCase();
  const candidates = [
    t["model"],
    t["generator:model"],
    t["manufacturer:type"],
    // generator:type only when it's clearly a model, not "horizontal_axis".
    axis && !axis.includes("axis") ? t["generator:type"] : undefined,
  ];
  for (const c of candidates) {
    const v = strOrNull(c);
    if (v) return v;
  }
  return null;
}

function toTurbine(el: OverpassElement): Turbine | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  if (el.type !== "node" && el.type !== "way") return null;
  const tags = el.tags ?? {};
  const ratedRaw = strOrNull(tags["generator:output:electricity"]);
  return {
    osmType: el.type,
    osmId: el.id,
    lon,
    lat,
    name: strOrNull(tags["name"]),
    operator: strOrNull(tags["operator"]),
    manufacturer: strOrNull(tags["manufacturer"]),
    model: pickModel(tags),
    ratedPowerKw: parseRatedKw(ratedRaw ?? undefined),
    ratedPowerRaw: ratedRaw,
    hubHeightM: parseMetres(tags["height:hub"]) ?? parseMetres(tags["height"]),
    rotorDiameterM: parseMetres(tags["rotor:diameter"]),
    startDate: strOrNull(tags["start_date"]),
    eleM: parseMetres(tags["ele"]),
    ref: strOrNull(tags["ref"]),
    tags,
  };
}

// ── Overpass fetch (per cell, cached, retried) ──────────────────────────────

interface Cell {
  south: number;
  west: number;
  north: number;
  east: number;
}

function buildGrid(): Cell[] {
  const cells: Cell[] = [];
  for (let lat = INDIA.south; lat < INDIA.north; lat += cellDeg) {
    for (let lon = INDIA.west; lon < INDIA.east; lon += cellDeg) {
      cells.push({
        south: round6(lat),
        west: round6(lon),
        north: round6(Math.min(lat + cellDeg, INDIA.north)),
        east: round6(Math.min(lon + cellDeg, INDIA.east)),
      });
    }
  }
  return cells;
}

function cellQuery(c: Cell): string {
  // node + way: most turbines are nodes; a minority are mapped as small areas.
  return `[out:json][timeout:${PER_CELL_TIMEOUT_S}];
(
  node["power"="generator"]["generator:source"="wind"](${c.south},${c.west},${c.north},${c.east});
  way["power"="generator"]["generator:source"="wind"](${c.south},${c.west},${c.north},${c.east});
);
out center tags;`;
}

function cacheFile(c: Cell): string {
  return path.join(
    CACHE_DIR,
    `cell_${c.south}_${c.west}_${c.north}_${c.east}.json`,
  );
}

async function fetchCell(c: Cell, idx: number): Promise<OverpassElement[]> {
  const file = cacheFile(c);
  if (useCache && fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8")) as {
        elements?: OverpassElement[];
      };
      return cached.elements ?? [];
    } catch {
      // Corrupt cache entry — fall through to re-fetch.
    }
  }

  const body = `data=${encodeURIComponent(cellQuery(c))}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length]!;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status === 504) {
        throw new Error(`overpass ${res.status} (busy)`);
      }
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const text = await res.text();
      const json = JSON.parse(text) as {
        elements?: OverpassElement[];
        remark?: string;
      };
      if (json.remark && /timed out|runtime error/i.test(json.remark)) {
        throw new Error(`overpass remark: ${json.remark}`);
      }
      const elements = json.elements ?? [];
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ cell: c, elements }));
      // Throttle only LIVE requests; cached re-runs stay instant.
      await sleep(INTER_REQUEST_DELAY_MS);
      return elements;
    } catch (err) {
      lastErr = err;
      // Exponential backoff, capped — a transient 504 on the main instance
      // recovers in seconds, so don't wait minutes.
      const backoffMs = Math.min(2000 * 2 ** attempt, 12_000) + Math.trunc(500 * (idx % 3));
      console.warn(
        `[turbines] cell ${idx} attempt ${attempt + 1}/${MAX_RETRIES} failed (${(err as Error).message}); retry in ${backoffMs}ms`,
      );
      await sleep(backoffMs);
    }
  }
  throw new Error(
    `cell ${idx} [${c.south},${c.west},${c.north},${c.east}] failed after ${MAX_RETRIES} tries: ${(lastErr as Error)?.message}`,
  );
}

// Bounded-concurrency map over cells. A cell that exhausts its retries is
// recorded as failed and SKIPPED (never aborts the whole run) — its raw JSON
// isn't cached, so simply re-running the script retries only the gaps while
// every already-fetched cell replays from cache instantly.
async function fetchAllCells(
  cells: Cell[],
): Promise<{ elements: OverpassElement[]; failed: Cell[] }> {
  const all: OverpassElement[] = [];
  const failed: Cell[] = [];
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < cells.length) {
      const idx = next++;
      const cell = cells[idx]!;
      try {
        const els = await fetchCell(cell, idx);
        done += 1;
        if (els.length > 0) {
          process.stdout.write(
            `\r[turbines] cells ${done}/${cells.length} · last cell +${els.length} elements   `,
          );
        } else {
          process.stdout.write(`\r[turbines] cells ${done}/${cells.length}            `);
        }
        all.push(...els);
      } catch (err) {
        done += 1;
        failed.push(cell);
        process.stdout.write("\n");
        console.warn(`[turbines] SKIP ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  process.stdout.write("\n");
  return { elements: all, failed };
}

// ── Upsert ──────────────────────────────────────────────────────────────────

async function upsert(turbines: Turbine[]): Promise<number> {
  const client = await pool.connect();
  const COLS = 16;
  let written = 0;
  try {
    await client.query("BEGIN");
    if (truncate) {
      console.log("[turbines] TRUNCATE wind_turbines (--truncate set)");
      await client.query("TRUNCATE TABLE wind_turbines");
    }

    for (let i = 0; i < turbines.length; i += BATCH_SIZE) {
      const batch = turbines.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const rows: string[] = [];
      batch.forEach((t, idx) => {
        values.push(
          t.osmType,
          t.osmId,
          t.lon,
          t.lat,
          t.name,
          t.operator,
          t.manufacturer,
          t.model,
          t.ratedPowerKw,
          t.ratedPowerRaw,
          t.hubHeightM,
          t.rotorDiameterM,
          t.startDate,
          t.eleM,
          t.ref,
          JSON.stringify(t.tags),
        );
        const b = idx * COLS;
        // Explicit casts on every param — pg can't infer types across NULLs.
        rows.push(
          `($${b + 1}::text, $${b + 2}::bigint,` +
            ` ST_SetSRID(ST_MakePoint($${b + 3}::float8, $${b + 4}::float8), 4326),` +
            ` $${b + 5}::text, $${b + 6}::text, $${b + 7}::text, $${b + 8}::text,` +
            ` $${b + 9}::numeric, $${b + 10}::text, $${b + 11}::numeric,` +
            ` $${b + 12}::numeric, $${b + 13}::text, $${b + 14}::numeric,` +
            ` $${b + 15}::text, $${b + 16}::jsonb)`,
        );
      });

      const sql = `
        INSERT INTO wind_turbines
          (osm_type, osm_id, geom, name, operator, manufacturer, model,
           rated_power_kw, rated_power_raw, hub_height_m, rotor_diameter_m,
           start_date, ele_m, ref, tags)
        VALUES ${rows.join(",")}
        ON CONFLICT (osm_type, osm_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          name = EXCLUDED.name,
          operator = EXCLUDED.operator,
          manufacturer = EXCLUDED.manufacturer,
          model = EXCLUDED.model,
          rated_power_kw = EXCLUDED.rated_power_kw,
          rated_power_raw = EXCLUDED.rated_power_raw,
          hub_height_m = EXCLUDED.hub_height_m,
          rotor_diameter_m = EXCLUDED.rotor_diameter_m,
          start_date = EXCLUDED.start_date,
          ele_m = EXCLUDED.ele_m,
          ref = EXCLUDED.ref,
          tags = EXCLUDED.tags,
          updated_at = now()
      `;
      const res = await client.query(sql, values);
      written += res.rowCount ?? batch.length;
      process.stdout.write(`\r[turbines] upserted ${written}/${turbines.length}`);
    }
    await client.query("COMMIT");
    process.stdout.write("\n");
    return written;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
function flag(v: string | undefined): boolean {
  return v === "" || v === "true" || v === "1";
}
function numArg(v: string | undefined, dflt: number): number {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cells = buildGrid();
  console.log(
    `[turbines] India bbox tiled into ${cells.length} cells of ${cellDeg}°` +
      ` (cache=${useCache ? "on" : "off"}, concurrency=${concurrency})`,
  );

  const { elements, failed } = await fetchAllCells(cells);
  console.log(`[turbines] fetched ${elements.length} raw OSM elements`);
  if (failed.length > 0) {
    console.warn(
      `[turbines] ${failed.length}/${cells.length} cells failed (Overpass busy) —` +
        ` re-run the script to retry only those (cached cells replay instantly).`,
    );
  }

  // Dedupe by (type, id) across cell borders; parse + drop unplaceable.
  const byKey = new Map<string, Turbine>();
  let dropped = 0;
  for (const el of elements) {
    const t = toTurbine(el);
    if (!t) {
      dropped += 1;
      continue;
    }
    byKey.set(`${t.osmType}:${t.osmId}`, t);
  }
  const turbines = [...byKey.values()];
  console.log(
    `[turbines] ${turbines.length} unique turbines` +
      ` (${dropped} dropped for missing coords, ${elements.length - turbines.length - dropped} dedup'd)`,
  );

  if (turbines.length === 0) {
    console.log("[turbines] nothing to insert");
    await pool.end();
    return;
  }

  const written = await upsert(turbines);

  const withPower = turbines.filter((t) => t.ratedPowerKw != null).length;
  const withHub = turbines.filter((t) => t.hubHeightM != null).length;
  const withMfr = turbines.filter((t) => t.manufacturer != null).length;
  const totalMw = turbines.reduce((s, t) => s + (t.ratedPowerKw ?? 0), 0) / 1000;
  console.log(
    `[turbines] done — ${written} rows upserted\n` +
      `           ${withPower} have rated power (Σ ${totalMw.toFixed(0)} MW),` +
      ` ${withHub} hub height, ${withMfr} manufacturer`,
  );
  await pool.end();

  // "Not missing a single one": if any cell failed, the import is INCOMPLETE
  // even though the rows above were written. Exit non-zero so a human / cron
  // notices and re-runs (cached cells replay instantly, so only gaps re-fetch).
  if (failed.length > 0) {
    console.error(
      `[turbines] INCOMPLETE — ${failed.length}/${cells.length} cells did not fetch;` +
        ` coverage is partial. Re-run the script to fill the gaps.`,
    );
    process.exit(2);
  }
}

main().catch(async (err) => {
  console.error("\n[turbines] FAILED:", err);
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
