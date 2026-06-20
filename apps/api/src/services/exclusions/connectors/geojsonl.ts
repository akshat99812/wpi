/**
 * Generic GeoJSON / GeoJSON-Lines reader → loader.
 *
 * india-geodata ships large layers as `.geojsonl` (one Feature per line, the
 * format `split2`/`JSONStream` were chosen for in the runbook). Smaller normalised
 * outputs are plain `.geojson` FeatureCollections. This reader handles both and
 * streams features through a per-source `mapper` into `loadPolygons` in chunks,
 * so a multi-hundred-MB coastal file never has to sit fully in memory.
 */
import fs from "node:fs";
import readline from "node:readline";
import type { Pool } from "pg";
import { loadPolygons, type LoadResult } from "../loader";
import type { SourceDef } from "../registry";
import type { Feature, NormalisedFeature } from "../types";

const STREAM_CHUNK = 2000; // features per loader flush

/** A mapper turns a raw GeoJSON feature into 0..n normalised features. */
export type FeatureMapper = (feature: Feature) => NormalisedFeature | NormalisedFeature[] | null;

function toArray(x: NormalisedFeature | NormalisedFeature[] | null): NormalisedFeature[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

async function flush(
  pool: Pool,
  def: SourceDef,
  buf: NormalisedFeature[],
  acc: LoadResult,
  truncate: boolean,
): Promise<void> {
  if (buf.length === 0) return;
  const r = await loadPolygons(pool, def, buf, { truncate });
  acc.inserted += r.inserted;
  acc.skipped += r.skipped;
}

/** Ingest a `.geojsonl` file (one Feature per line). */
async function ingestLines(
  pool: Pool,
  def: SourceDef,
  filePath: string,
  mapper: FeatureMapper,
  truncate: boolean,
): Promise<LoadResult> {
  const acc: LoadResult = { source_id: def.source_id, inserted: 0, skipped: 0 };
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let buf: NormalisedFeature[] = [];
  let first = truncate;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "," || trimmed === "[" || trimmed === "]") continue;
    let feat: Feature;
    try {
      feat = JSON.parse(trimmed.replace(/,\s*$/, "")) as Feature;
    } catch {
      acc.skipped++;
      continue;
    }
    buf.push(...toArray(mapper(feat)));
    if (buf.length >= STREAM_CHUNK) {
      await flush(pool, def, buf, acc, first);
      first = false;
      buf = [];
    }
  }
  await flush(pool, def, buf, acc, first);
  return acc;
}

/** Ingest a `.geojson` FeatureCollection (whole-file parse). */
async function ingestCollection(
  pool: Pool,
  def: SourceDef,
  filePath: string,
  mapper: FeatureMapper,
  truncate: boolean,
): Promise<LoadResult> {
  const fc = JSON.parse(await fs.promises.readFile(filePath, "utf8")) as {
    features?: Feature[];
  };
  const features = fc.features ?? [];
  const acc: LoadResult = { source_id: def.source_id, inserted: 0, skipped: 0 };
  let buf: NormalisedFeature[] = [];
  let first = truncate;
  for (const feat of features) {
    buf.push(...toArray(mapper(feat)));
    if (buf.length >= STREAM_CHUNK) {
      await flush(pool, def, buf, acc, first);
      first = false;
      buf = [];
    }
  }
  await flush(pool, def, buf, acc, first);
  return acc;
}

/** Dispatch on extension. */
export async function ingestPolygonFile(
  pool: Pool,
  def: SourceDef,
  filePath: string,
  mapper: FeatureMapper,
  opts: { truncate?: boolean } = {},
): Promise<LoadResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Raw file not found: ${filePath}\n` +
        `  Download it first (see exclusion-plan.md), then re-run. ` +
        `Expected under data/by-source/${def.source_id}/raw/.`,
    );
  }
  const isLines = /\.(geojsonl|jsonl|ndjson)$/i.test(filePath);
  const truncate = opts.truncate ?? true;
  return isLines
    ? ingestLines(pool, def, filePath, mapper, truncate)
    : ingestCollection(pool, def, filePath, mapper, truncate);
}
