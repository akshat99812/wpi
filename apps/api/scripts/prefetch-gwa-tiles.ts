/**
 * Pre-seed the GWA tile cache for all of India — the durable fix for "site
 * analysis returns 0 everywhere".
 *
 * WHY
 *   Site analysis samples Global Wind Atlas raster tiles from GWA's own TiTiler
 *   (GWA_TILER_BASE). That host is third-party infra we don't control and is
 *   intermittently unreliable (spurious 404s, inconsistent payloads, slow cold
 *   responses). When a tile fails, the wind read is NaN → AOI mean speed null →
 *   score/capacity/AEP/financials all come back null (the UI shows 0).
 *
 *   The analysis tile cache (services/analysis/tiles.ts) has INFINITE TTL and a
 *   cached tile ALWAYS wins before the network. So if we fetch every India tile
 *   once into that cache, analysis stops depending on GWA's live tiler.
 *
 * WHAT
 *   Walks the India bbox tile cover at ANALYSIS_ZOOM (z10) for all 7 GWA layers
 *   and fills {cacheDir}/gwa/{layer}/10/{x}/{y}.tif via the SAME loadTile() the
 *   analyzer uses — identical layout + decode validation, zero drift.
 *
 *   - Resumable: tiles already on disk are skipped (just a stat), so re-running
 *     only fills gaps. Safe to Ctrl-C and restart anytime.
 *   - Flaky-host tolerant: each tile is retried; a tile that 404s on EVERY
 *     attempt is treated as genuine no-data (ocean/outside coverage) and left
 *     uncached (the analyzer reads it as NaN, which is correct there).
 *
 * USAGE
 *   bun scripts/prefetch-gwa-tiles.ts                 # all India, all layers
 *   bun scripts/prefetch-gwa-tiles.ts --layers=ws100,cf_iec3
 *   bun scripts/prefetch-gwa-tiles.ts --bbox=72,18,76,22   # smaller test box
 *   bun scripts/prefetch-gwa-tiles.ts --concurrency=12 --max-tries=8
 *
 *   Cache location follows the API: TILE_CACHE_DIR env, else /var/cache/tiles
 *   (NODE_ENV=production) or apps/api/.cache/tiles (dev). Set TILE_CACHE_DIR to
 *   seed the production path directly.
 */

import { promises as fs } from "fs";
import {
  ANALYSIS_ZOOM,
  GWA_LAYERS,
  GWA_TILER_BASE,
  INDIA_BBOX,
  type GwaLayer,
} from "../src/services/analysis/constants";
import { tileCoverForBbox, tileCountOf } from "../src/services/analysis/mercator";
import {
  loadTile,
  resolveTileCacheDir,
  tileCachePath,
} from "../src/services/analysis/tiles";

// ── Defaults ───────────────────────────────────────────────────────────────
const DEFAULT_CONCURRENCY = 8;
// 6 tries → a land tile (~10% spurious-404 rate) has ~1e-6 odds of looking
// like no-data; an ocean tile 404s on all 6 and is correctly classified.
const DEFAULT_MAX_TRIES = 6;
const BACKOFF_BASE_MS = 400;
const PROGRESS_EVERY = 250;

interface Args {
  bbox: readonly [number, number, number, number];
  layers: GwaLayer[];
  concurrency: number;
  maxTries: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };

  const bboxRaw = get("bbox");
  let bbox: readonly [number, number, number, number] = INDIA_BBOX;
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`--bbox must be W,S,E,N numbers; got "${bboxRaw}"`);
    }
    bbox = parts as [number, number, number, number];
  }

  const allLayers = Object.entries(GWA_LAYERS); // [shortKey, layerName]
  const layersRaw = get("layers");
  let layers: GwaLayer[];
  if (layersRaw) {
    const wanted = layersRaw.split(",").map((s) => s.trim());
    layers = allLayers
      .filter(([key, name]) => wanted.includes(key) || wanted.includes(name))
      .map(([, name]) => name);
    if (layers.length === 0) {
      throw new Error(
        `--layers matched nothing. Valid: ${allLayers
          .map(([k, n]) => `${k}(${n})`)
          .join(", ")}`,
      );
    }
  } else {
    layers = allLayers.map(([, name]) => name);
  }

  const concurrency = Number(get("concurrency") ?? DEFAULT_CONCURRENCY);
  const maxTries = Number(get("max-tries") ?? DEFAULT_MAX_TRIES);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer`);
  }
  if (!Number.isInteger(maxTries) || maxTries < 1) {
    throw new Error(`--max-tries must be a positive integer`);
  }
  return { bbox, layers, concurrency, maxTries };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

type TileOutcome = "cached" | "fetched" | "nodata" | "failed";

/** Seed one tile through the analyzer's own loadTile (which fetches + decode-
 *  validates + writes the cache on success). Returns how it resolved. */
async function seedTile(
  layer: GwaLayer,
  x: number,
  y: number,
  maxTries: number,
): Promise<TileOutcome> {
  const cachePath = tileCachePath(resolveTileCacheDir(), layer, ANALYSIS_ZOOM, x, y);
  if (await fileExists(cachePath)) return "cached";

  let sawError = false;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const tile = await loadTile(layer, x, y, fetch);
      if (tile !== null) return "fetched"; // loadTile cached it
      // null = HTTP 404. Could be a spurious blip or genuine no-data (ocean).
      // Keep retrying; only after every attempt 404s do we call it no-data.
    } catch {
      sawError = true; // network/timeout/HTTP non-404 — retry with backoff
    }
    if (attempt < maxTries) await sleep(BACKOFF_BASE_MS * attempt);
  }
  // Exhausted: all-404 with no hard errors ⇒ treat as genuine no-data. If we
  // also hit errors, it's a real failure (host outage) worth surfacing.
  return sawError ? "failed" : "nodata";
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const cover = tileCoverForBbox(args.bbox, ANALYSIS_ZOOM);
  const perLayer = tileCountOf(cover);
  const cacheDir = resolveTileCacheDir();

  const coords: { x: number; y: number }[] = [];
  for (let y = cover.minY; y <= cover.maxY; y++) {
    for (let x = cover.minX; x <= cover.maxX; x++) coords.push({ x, y });
  }

  console.log("GWA tile prefetch");
  console.log(`  source     : ${GWA_TILER_BASE}`);
  console.log(`  cache dir  : ${cacheDir}`);
  console.log(`  bbox       : [${args.bbox.join(", ")}]  zoom ${ANALYSIS_ZOOM}`);
  console.log(`  cover      : ${cover.maxX - cover.minX + 1}×${cover.maxY - cover.minY + 1} = ${perLayer} tiles/layer`);
  console.log(`  layers     : ${args.layers.join(", ")} (${args.layers.length})`);
  console.log(`  total      : ${perLayer * args.layers.length} tile-fetches (uncached)`);
  console.log(`  concurrency: ${args.concurrency}   max-tries: ${args.maxTries}`);
  console.log("");

  const grand = { cached: 0, fetched: 0, nodata: 0, failed: 0 };
  const failures: string[] = [];

  for (const layer of args.layers) {
    const tally = { cached: 0, fetched: 0, nodata: 0, failed: 0 };
    let done = 0;
    const startedAt = performance.now();

    await pool(coords, args.concurrency, async ({ x, y }) => {
      const outcome = await seedTile(layer, x, y, args.maxTries);
      tally[outcome]++;
      if (outcome === "failed") failures.push(`${layer}/${ANALYSIS_ZOOM}/${x}/${y}`);
      done++;
      if (done % PROGRESS_EVERY === 0 || done === coords.length) {
        const pct = ((done / coords.length) * 100).toFixed(0);
        process.stdout.write(
          `\r  [${layer}] ${done}/${coords.length} (${pct}%) ` +
            `cached=${tally.cached} fetched=${tally.fetched} nodata=${tally.nodata} failed=${tally.failed}   `,
        );
      }
    });

    const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
    process.stdout.write("\n");
    console.log(`  [${layer}] done in ${secs}s\n`);
    grand.cached += tally.cached;
    grand.fetched += tally.fetched;
    grand.nodata += tally.nodata;
    grand.failed += tally.failed;
  }

  console.log("──────────────────────────────────────────");
  console.log(
    `SUMMARY  cached(skip)=${grand.cached}  fetched=${grand.fetched}  ` +
      `nodata=${grand.nodata}  failed=${grand.failed}`,
  );
  if (grand.failed > 0) {
    console.log(
      `\n${grand.failed} tile(s) FAILED (host errors, not 404). Re-run to retry — ` +
        `cached tiles are skipped. First few:`,
    );
    for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll tiles seeded. Analysis no longer depends on the live GWA tiler for this bbox.");
  }
}

main().catch((err) => {
  console.error("prefetch-gwa-tiles failed:", err);
  process.exit(1);
});
