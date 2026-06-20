/**
 * Phase E infra connector — roads / rail / power lines from the Geofabrik India
 * OSM extract, for the MNRE dynamic-setback checks (ST_DWithin at query time).
 *
 * All-India OSM is too big for live Overpass, so we filter the .pbf with osmium
 * and export GeoJSON-seq, then stream it into wce.infra_feature.
 *
 * Buildings are deliberately NOT loaded here: all-India OSM buildings are tens of
 * millions of features and would blow up the table + disk. Settlement clustering
 * (C3) is better run per-AOI/district at analysis time, not bulk-loaded.
 *
 * Requires `osmium` (brew install osmium-tool). EHV note: the platform's existing
 * OpenInfraMap integration is the authoritative EHV source; OSM power=line here is
 * the fallback per the runbook.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { $ } from "bun";
import type { Pool } from "pg";
import { loadInfra, type LoadResult } from "../loader";
import { SOURCES } from "../registry";
import type { Geometry, InfraKind } from "../types";

const ROOT = path.resolve(import.meta.dir, "../../../.."); // apps/api
const GEO_DIR = path.join(ROOT, "data/by-source/geofabrik");
export const DEFAULT_PBF = path.join(GEO_DIR, "india-latest.osm.pbf");

const STREAM_CHUNK = 5000;

/** osmium tags-filter expression per infra kind (matches exclusion-plan.md Phase E). */
const FILTERS: Record<Exclude<InfraKind, "building" | "institution" | "airport">, string> = {
  road: "w/highway=motorway,trunk,primary,secondary,tertiary",
  rail: "w/railway=rail",
  ehv: "w/power=line",
};

async function ensureOsmium(): Promise<void> {
  try {
    await $`osmium --version`.quiet();
  } catch {
    throw new Error("osmium not found — install with `brew install osmium-tool` (Phase E).");
  }
}

/** Filter the PBF for a kind and export GeoJSON-seq to a temp file. Returns its path. */
async function filterAndExport(pbf: string, kind: keyof typeof FILTERS): Promise<string> {
  const filteredPbf = path.join(GEO_DIR, `${kind}.osm.pbf`);
  const geojsonl = path.join(GEO_DIR, `${kind}.geojsonl`);
  await $`osmium tags-filter ${pbf} ${FILTERS[kind]} -o ${filteredPbf} --overwrite`.quiet();
  // GeoJSON-seq: one feature per line (RFC 8142); osmium may prefix each with RS (0x1e).
  await $`osmium export ${filteredPbf} -f geojsonseq -o ${geojsonl} --overwrite`.quiet();
  return geojsonl;
}

/** Stream a GeoJSON-seq file into wce.infra_feature for one kind. */
async function loadGeojsonl(pool: Pool, kind: InfraKind, filePath: string, truncate: boolean): Promise<LoadResult> {
  const def = SOURCES.geofabrik!;
  const acc: LoadResult = { source_id: def.source_id, inserted: 0, skipped: 0 };
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let buf: { geometry: Geometry | null; attrs?: Record<string, unknown> }[] = [];
  let first = truncate;
  for await (const raw of rl) {
    const line = raw.replace(/\x1e/g, "").trim(); // strip RFC 8142 record separator
    if (!line) continue;
    try {
      const f = JSON.parse(line) as { geometry: Geometry | null; properties?: Record<string, unknown> };
      buf.push({ geometry: f.geometry, attrs: f.properties ?? {} });
    } catch {
      acc.skipped++;
      continue;
    }
    if (buf.length >= STREAM_CHUNK) {
      const r = await loadInfra(pool, def, kind, buf, { truncate: first });
      acc.inserted += r.inserted;
      acc.skipped += r.skipped;
      first = false;
      buf = [];
    }
  }
  if (buf.length) {
    const r = await loadInfra(pool, def, kind, buf, { truncate: first });
    acc.inserted += r.inserted;
    acc.skipped += r.skipped;
  }
  return acc;
}

/**
 * Ingest roads/rail/power from the Geofabrik PBF into infra_feature.
 * `kinds` defaults to all three. Keeps the intermediate filtered PBF + geojsonl
 * in data/by-source/geofabrik/ (gitignored) for inspection / re-runs.
 */
export async function ingestInfra(
  pool: Pool,
  opts: { pbf?: string; kinds?: (keyof typeof FILTERS)[]; truncate?: boolean } = {},
): Promise<Record<string, LoadResult>> {
  const pbf = opts.pbf ?? DEFAULT_PBF;
  if (!fs.existsSync(pbf)) throw new Error(`PBF not found: ${pbf} — download the Geofabrik India extract first (Phase E).`);
  await ensureOsmium();

  const kinds = opts.kinds ?? (["road", "rail", "ehv"] as (keyof typeof FILTERS)[]);
  const out: Record<string, LoadResult> = {};
  for (const kind of kinds) {
    console.log(`[infra] filtering + exporting ${kind}…`);
    const geojsonl = await filterAndExport(pbf, kind);
    console.log(`[infra] loading ${kind} → infra_feature…`);
    out[kind] = await loadGeojsonl(pool, kind, geojsonl, opts.truncate ?? true);
    console.log(`[infra] ${kind}: ${out[kind]!.inserted} inserted, ${out[kind]!.skipped} skipped`);
  }
  return out;
}
