/**
 * Disk cache for finished AnalysisResponse payloads.
 *
 * Key: md5(canonicalGeometryString(aoi) + ANALYSIS_VERSION) — the geometry is
 * already canonical (6-dp rounded, deduped, closed) by the time it reaches
 * here, satisfying the plan's "never hash unrounded geometry" hard rule, and
 * ANALYSIS_VERSION in the key means a version bump invalidates everything.
 * No TTL for the same reason — entries can only become wrong via an
 * algorithm change, which changes the key.
 *
 * Dir resolution mirrors middleware/tileCache.ts (TILE_CACHE_DIR env →
 * /var/cache/tiles in production) with the analysis namespace, except dev
 * gets a real default dir (like services/analysis/tiles.ts) instead of a
 * passthrough: results are version-keyed, so dev staleness cannot happen.
 *
 * Layout: {base}/analysis/{key[0:2]}/{key}.json
 * Writes are temp-file + rename (no torn reads); a corrupt entry is treated
 * as a miss and deleted.
 *
 * Disk-growth guard: the geometry key space is effectively unbounded (any
 * unique 6-dp polygon inside India), so a hostile Pro user could mint cache
 * entries forever. Writes are refused (loudly logged) once the namespace
 * directory exceeds RESULT_CACHE_MAX_MB (default 500). The size ledger is
 * seeded by one recursive scan per process and advanced per write — an
 * approximation, but the failure mode is only a slightly early/late cutoff.
 */

import { createHash } from "crypto";
import { promises as fs, type Dirent } from "fs";
import path from "path";
import { ANALYSIS_VERSION } from "./constants";
import { canonicalGeometryString } from "./geometry";
import type { AnalysisResponse, ValidatedAoi } from "./types";

const CACHE_NAMESPACE = "analysis";
const PROD_CACHE_DIR = "/var/cache/tiles";
/** apps/api root = three levels up from src/services/analysis/. */
const API_ROOT_DIR = path.resolve(import.meta.dir, "..", "..", "..");
const DEV_CACHE_DIR = path.join(API_ROOT_DIR, ".cache", "tiles");
/** Shard fanout copied from middleware/tileCache.ts ({key[0:2]}/). */
const SHARD_PREFIX_LENGTH = 2;

/** Default cap on the analysis namespace; override via RESULT_CACHE_MAX_MB. */
const DEFAULT_RESULT_CACHE_MAX_MB = 500;
const BYTES_PER_MIB = 1024 * 1024;

/** Resolved per call (not at module load) so tests can point TILE_CACHE_DIR
 *  at a tmp dir after import — same seam as services/analysis/tiles.ts. */
function resolveCacheBaseDir(): string {
  const fromEnv = process.env.TILE_CACHE_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return process.env.NODE_ENV === "production" ? PROD_CACHE_DIR : DEV_CACHE_DIR;
}

/** Cache key for one validated AOI under the current ANALYSIS_VERSION. */
export function resultCacheKey(aoi: ValidatedAoi): string {
  return createHash("md5")
    .update(canonicalGeometryString(aoi) + ANALYSIS_VERSION)
    .digest("hex");
}

function resolveNamespaceDir(): string {
  return path.join(resolveCacheBaseDir(), CACHE_NAMESPACE);
}

function entryPathFor(key: string): string {
  return path.join(
    resolveNamespaceDir(),
    key.slice(0, SHARD_PREFIX_LENGTH),
    `${key}.json`,
  );
}

// ── Namespace size ledger (disk-growth guard) ───────────────────────────────

function resolveMaxCacheBytes(): number {
  const raw = process.env.RESULT_CACHE_MAX_MB;
  const parsed = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  const maxMb =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESULT_CACHE_MAX_MB;
  return maxMb * BYTES_PER_MIB;
}

/** Mutable counter holder so concurrent writers share one running total. */
interface SizeLedger {
  bytes: number;
}

/** One ledger per namespace dir (tests point TILE_CACHE_DIR at tmp dirs). */
const sizeLedgers = new Map<string, Promise<SizeLedger>>();

async function shardSizeBytes(shardDir: string): Promise<number> {
  let total = 0;
  const files = await fs.readdir(shardDir, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile()) continue;
    try {
      total += (await fs.stat(path.join(shardDir, file.name))).size;
    } catch (err) {
      // Entry deleted between readdir and stat — fine for an approximation.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }
  return total;
}

/** Recursive size of {namespaceDir}/{shard}/*.json. Missing dir = 0 bytes. */
async function scanNamespaceSizeBytes(namespaceDir: string): Promise<number> {
  let shards: Dirent[];
  try {
    shards = await fs.readdir(namespaceDir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      console.warn("[analysis-cache] size scan failed; assuming empty", {
        namespaceDir,
        err: (err as Error).message,
      });
    }
    return 0;
  }
  let total = 0;
  for (const shard of shards) {
    if (!shard.isDirectory()) continue;
    try {
      total += await shardSizeBytes(path.join(namespaceDir, shard.name));
    } catch (err) {
      console.warn("[analysis-cache] shard size scan failed; undercounting", {
        shard: shard.name,
        err: (err as Error).message,
      });
    }
  }
  return total;
}

function ledgerFor(namespaceDir: string): Promise<SizeLedger> {
  const existing = sizeLedgers.get(namespaceDir);
  if (existing !== undefined) return existing;
  const created = scanNamespaceSizeBytes(namespaceDir).then((bytes) => ({ bytes }));
  sizeLedgers.set(namespaceDir, created);
  return created;
}

/** Minimal shape check so a foreign/truncated JSON file can't masquerade as
 *  a response. Full validity is the producer's job — this guards the disk. */
function isAnalysisResponse(value: unknown): value is AnalysisResponse {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AnalysisResponse>;
  return (
    typeof candidate.analysisVersion === "string" &&
    typeof candidate.aoi === "object" &&
    candidate.aoi !== null &&
    typeof candidate.score === "object" &&
    candidate.score !== null &&
    typeof candidate.sections === "object" &&
    candidate.sections !== null
  );
}

/** Best-effort delete of a corrupt entry; never throws. */
async function deleteCorruptEntry(entryPath: string, reason: string): Promise<void> {
  console.warn(`[analysis-cache] corrupt entry treated as miss (${reason})`, { entryPath });
  try {
    await fs.unlink(entryPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[analysis-cache] failed to delete corrupt entry", {
        entryPath,
        err: (err as Error).message,
      });
    }
  }
}

/**
 * Cached response for `key`, or null on miss. A corrupt or unparseable file
 * is deleted and treated as a miss. Never throws.
 */
export async function getCachedResult(key: string): Promise<AnalysisResponse | null> {
  const entryPath = entryPathFor(key);
  let raw: string;
  try {
    raw = await fs.readFile(entryPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[analysis-cache] read failed; treating as miss", {
        entryPath,
        err: (err as Error).message,
      });
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isAnalysisResponse(parsed)) {
      await deleteCorruptEntry(entryPath, "shape mismatch");
      return null;
    }
    return parsed;
  } catch (err) {
    await deleteCorruptEntry(entryPath, `unparseable JSON: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Fire-and-forget write: kicks off the disk write and returns immediately.
 * Failures are logged, never thrown — a cache write must never affect the
 * response. The returned promise is for tests that need to await settling.
 */
export function putCachedResult(key: string, response: AnalysisResponse): Promise<void> {
  return writeEntry(key, response).catch((err) => {
    console.warn("[analysis-cache] write failed", {
      key,
      err: (err as Error).message,
    });
  });
}

async function writeEntry(key: string, response: AnalysisResponse): Promise<void> {
  const entryPath = entryPathFor(key);
  const body = JSON.stringify(response);
  const incomingBytes = Buffer.byteLength(body);

  // Disk-growth guard: refuse new entries once the namespace is full. The
  // route only writes on cache miss, so re-writes of an existing key (which
  // the ledger would double-count) do not occur on the production path.
  const ledger = await ledgerFor(resolveNamespaceDir());
  const maxBytes = resolveMaxCacheBytes();
  if (ledger.bytes + incomingBytes > maxBytes) {
    console.warn("[analysis-cache] namespace size cap reached; skipping write", {
      key,
      namespaceBytes: ledger.bytes,
      incomingBytes,
      maxBytes,
    });
    return;
  }

  await fs.mkdir(path.dirname(entryPath), { recursive: true });
  // Temp-file + rename so a concurrent reader never sees a torn body
  // (pattern copied from middleware/tileCache.ts).
  const tmpPath = `${entryPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, body);
  await fs.rename(tmpPath, entryPath);
  ledger.bytes += incomingBytes;
}
