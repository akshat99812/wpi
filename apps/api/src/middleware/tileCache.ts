import { Request, Response, NextFunction, RequestHandler } from "express";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * Disk-backed tile cache middleware. Zero new dependencies.
 *
 * Cache key:  md5(req.originalUrl) — the FULL url including query string, so
 *             `?v=` cache-busting on the frontend tile URLs works automatically.
 * Layout:     ${TILE_CACHE_DIR}/{namespace}/{key[0:2]}/{key}        body
 *             ${TILE_CACHE_DIR}/{namespace}/{key[0:2]}/{key}.meta   sidecar JSON
 *
 * The sidecar stores the response metadata needed to replay the body
 * correctly: `ce` (Content-Encoding), `ct` (Content-Type), `cc`
 * (Cache-Control). The body is stored exactly as the handler passed it to
 * res.send(). NOTE: Bun's fetch (and Node 18+) auto-decompresses gzip
 * upstream responses, so proxied bodies are identity-encoded by the time
 * they reach res.send() — `ce` is captured from OUR response headers (set by
 * the handler), never copied from upstream. If a handler ever sends a
 * pre-compressed body it must set Content-Encoding itself, and the meta
 * mechanism replays it on HITs.
 *
 * Behavior:
 *  - Fresh HIT (mtime within TTL)  → replay body + meta headers, X-Cache: HIT.
 *  - MISS                          → handler runs; 200 Buffer responses are
 *                                    written to disk asynchronously (write
 *                                    failures are logged, never swallowed).
 *  - STALE (file exists, TTL past) → handler runs (upstream refresh). On a
 *                                    200 the cache is refreshed (X-Cache:
 *                                    REFRESH); if the handler degrades to a
 *                                    204/5xx instead, the stale body is
 *                                    served with X-Cache: STALE.
 *
 * Concurrency: simultaneous cold misses on the same tile both fetch and both
 * write (last write wins). Known non-issue at current traffic — no lock.
 * Writes go to a temp file + rename so readers never see a torn body.
 *
 * In dev (no TILE_CACHE_DIR, NODE_ENV !== production) this is a pure
 * passthrough — keeps local re-ingestion workflows (which change windmill
 * UUIDs) from being poisoned by a stale disk cache.
 */

const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;

interface CacheMeta {
  /** Content-Encoding of the stored body, or null for identity. */
  ce: string | null;
  /** Content-Type to replay on hits. */
  ct: string | null;
  /** Cache-Control to replay on hits. */
  cc: string | null;
}

interface CacheEntry {
  body: Buffer;
  meta: CacheMeta;
  ageMs: number;
}

function resolveCacheDir(): string | null {
  if (process.env.TILE_CACHE_DIR) return process.env.TILE_CACHE_DIR;
  if (process.env.NODE_ENV === "production") return "/var/cache/tiles";
  return null;
}

async function readEntry(
  bodyPath: string,
  metaPath: string,
): Promise<CacheEntry | null> {
  try {
    const [stat, body, metaRaw] = await Promise.all([
      fs.stat(bodyPath),
      fs.readFile(bodyPath),
      fs.readFile(metaPath, "utf8"),
    ]);
    const meta = JSON.parse(metaRaw) as CacheMeta;
    return { body, meta, ageMs: Date.now() - stat.mtimeMs };
  } catch {
    // Missing, unreadable, or half-written entry — treat as a miss.
    return null;
  }
}

async function writeEntry(
  dir: string,
  bodyPath: string,
  metaPath: string,
  body: Buffer,
  meta: CacheMeta,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  // Temp-file + rename so a concurrent reader never sees a torn body.
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(metaPath + suffix, JSON.stringify(meta));
  await fs.rename(metaPath + suffix, metaPath);
  await fs.writeFile(bodyPath + suffix, body);
  await fs.rename(bodyPath + suffix, bodyPath);
}

function headerString(res: Response, name: string): string | null {
  const v = res.getHeader(name);
  return typeof v === "string" && v.length > 0 ? v : null;
}

function serveEntry(
  res: Response,
  entry: CacheEntry,
  label: "HIT" | "STALE",
  send: (body: Buffer) => Response,
): void {
  res.status(200);
  if (entry.meta.ct) res.setHeader("Content-Type", entry.meta.ct);
  if (entry.meta.cc) res.setHeader("Cache-Control", entry.meta.cc);
  if (entry.meta.ce) res.setHeader("Content-Encoding", entry.meta.ce);
  res.setHeader("X-Cache", label);
  send(entry.body);
}

export function tileCache(
  namespace: string,
  ttlMs: number = DEFAULT_TTL_MS,
): RequestHandler {
  const baseDir = resolveCacheDir();
  if (!baseDir) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = createHash("md5").update(req.originalUrl).digest("hex");
    const dir = path.join(baseDir, namespace, key.slice(0, 2));
    const bodyPath = path.join(dir, key);
    const metaPath = `${bodyPath}.meta`;

    const entry = await readEntry(bodyPath, metaPath);
    if (entry && entry.ageMs < ttlMs) {
      serveEntry(res, entry, "HIT", (body) => res.send(body));
      return;
    }

    // MISS, or STALE candidate awaiting an upstream refresh. Wrap the
    // response so we can capture a fresh 200 body — or fall back to the
    // stale entry if the handler degrades (204 / 5xx).
    const originalSend = res.send.bind(res);
    const originalEnd = res.end.bind(res);
    let settled = false;

    res.send = function patchedSend(body?: unknown): Response {
      if (settled) return originalSend(body as never);
      settled = true;

      if (res.statusCode === 200 && Buffer.isBuffer(body)) {
        res.setHeader("X-Cache", entry ? "REFRESH" : "MISS");
        const meta: CacheMeta = {
          ce: headerString(res, "content-encoding"),
          ct: headerString(res, "content-type"),
          cc: headerString(res, "cache-control"),
        };
        writeEntry(dir, bodyPath, metaPath, body, meta).catch((err) => {
          console.warn("[tilecache] write failed", {
            namespace,
            key,
            err: (err as Error)?.message,
          });
        });
        return originalSend(body);
      }

      // Degraded handler response (proxy 204 fallback, DB 5xx…): serve the
      // stale body instead when we have one. 4xx (auth, validation, rate
      // limit) always passes through untouched.
      if (entry && (res.statusCode === 204 || res.statusCode >= 500)) {
        serveEntry(res, entry, "STALE", originalSend);
        return res;
      }
      return originalSend(body as never);
    } as Response["send"];

    // Handlers that end without a body (res.status(204).end()) bypass
    // res.send — intercept those too for the stale fallback.
    res.end = function patchedEnd(...args: unknown[]): Response {
      const hasBody = args.length > 0 && args[0] != null && typeof args[0] !== "function";
      if (
        !settled &&
        !hasBody &&
        !res.headersSent &&
        entry &&
        (res.statusCode === 204 || res.statusCode >= 500)
      ) {
        settled = true;
        serveEntry(res, entry, "STALE", originalSend);
        return res;
      }
      return (originalEnd as (...a: unknown[]) => Response)(...args);
    } as Response["end"];

    next();
  };
}
