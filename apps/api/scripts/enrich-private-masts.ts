/**
 * One-off / re-runnable: sample ground elevation for every private mast and
 * write data/private/privateMasts.elevation.json (consumed by
 * routes/privateMasts.ts; the CSV itself is never modified).
 *
 * Source: the GWA `elevation` float32 layer at ANALYSIS_ZOOM=10 via the
 * analysis service's fetchPointValue — the exact same pixel source the site
 * analysis uses for air density (VERIFIED.md §1), with its infinite-TTL disk
 * cache. One pixel ≈ 150 m at this latitude, appropriate for mast elevation.
 *
 * Correctness check: the KMZ-derived CSV carries a real (non-zero) altitude
 * for ~100 masts. The script cross-validates the sampled elevation against
 * every one of them and prints the error distribution — run it and READ the
 * report before trusting the output.
 *
 * Usage: cd apps/api && bun scripts/enrich-private-masts.ts
 */

import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPointValue } from "../src/services/analysis/tiles";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, "../data/private/privateMasts.csv");
const OUT_PATH = path.resolve(
  __dirname,
  "../data/private/privateMasts.elevation.json",
);

const CONCURRENCY = 8;

type Row = Record<string, string>;

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)}|${lon.toFixed(6)}`;
}

async function main() {
  const rows = parse(fs.readFileSync(CSV_PATH, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Row[];

  const masts = rows
    .map((r) => ({
      name: r.name ?? "",
      lat: Number(r.latitude),
      lon: Number(r.longitude),
      csvAltitude: Number(r.altitude),
    }))
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon));

  console.log(`[enrich] sampling elevation for ${masts.length} masts…`);

  const byCoord: Record<string, number> = {};
  let misses = 0;
  for (let i = 0; i < masts.length; i += CONCURRENCY) {
    const batch = masts.slice(i, i + CONCURRENCY);
    const sampled = await Promise.all(
      batch.map((m) => fetchPointValue("elevation", m.lon, m.lat)),
    );
    batch.forEach((m, j) => {
      const v = sampled[j];
      if (v == null) {
        misses++;
        console.warn(`[enrich] no elevation pixel for ${m.name} (${m.lat}, ${m.lon})`);
        return;
      }
      byCoord[coordKey(m.lat, m.lon)] = Math.round(v);
    });
    process.stdout.write(`\r[enrich] ${Math.min(i + CONCURRENCY, masts.length)}/${masts.length}`);
  }
  process.stdout.write("\n");

  // ── Cross-validation against the KMZ altitudes the CSV does carry ──────
  const diffs = masts
    .filter((m) => m.csvAltitude > 0 && byCoord[coordKey(m.lat, m.lon)] != null)
    .map((m) => ({
      name: m.name,
      csv: m.csvAltitude,
      gwa: byCoord[coordKey(m.lat, m.lon)] as number,
      diff: Math.abs(m.csvAltitude - (byCoord[coordKey(m.lat, m.lon)] as number)),
    }))
    .sort((a, b) => a.diff - b.diff);

  if (diffs.length > 0) {
    const ds = diffs.map((d) => d.diff);
    const median = ds[Math.floor(ds.length / 2)] ?? 0;
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    const p90 = ds[Math.floor(ds.length * 0.9)] ?? 0;
    console.log(
      `[validate] vs ${diffs.length} KMZ altitudes — median |Δ| ${median} m · mean ${mean.toFixed(1)} m · p90 ${p90} m`,
    );
    console.log("[validate] 5 worst:");
    for (const d of diffs.slice(-5)) {
      console.log(`  ${d.name}: csv ${d.csv} m vs gwa ${d.gwa} m (Δ ${d.diff} m)`);
    }
  } else {
    console.warn("[validate] no rows with a non-zero CSV altitude to validate against");
  }

  const out = {
    generated: new Date().toISOString().slice(0, 10),
    source: "GWA elevation layer, z10 pixel via analysis fetchPointValue",
    byCoord,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1));
  console.log(
    `[enrich] wrote ${Object.keys(byCoord).length} elevations (${misses} misses) → ${OUT_PATH}`,
  );
}

main();
