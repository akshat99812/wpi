import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { existsSync } from "node:fs";
import path from "node:path";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { requirePro } from "../middleware/requirePro";
import { pool, dbAvailable } from "../lib/db";

/**
 * Legal exclusion-zone layer for the Pro map (red = hard exclusion, amber =
 * verify-before-use). Served from a pre-baked PMTiles pyramid (tippecanoe), NOT
 * live SQL: the 721k-polygon corpus (incl. 422k RFA forest compartments) only
 * changes on quarterly re-ingest, so generating tiles per request was the wrong
 * model (a cold z6 tile was ~3 MB / 15 s). The bake handles low-zoom
 * coalescing/dropping; serving is now a static byte-range read (~ms, no DB).
 *
 * Re-bake after re-ingest:  bun run scripts/bake-exclusions-pmtiles.ts
 *
 * Still Pro-gated + rate-limited (the .pmtiles is read server-side, never handed
 * to the client directly, so auth holds). /exclusion-sources stays DB-backed for
 * the click-to-inspect provenance popup.
 */

const router = Router();

const TILE_TTL = Number(process.env.TILE_CACHE_TTL || 86400);
const MAX_TILE_ZOOM = 14; // bake maxzoom; the client overzooms 14 → 16.
const PMTILES_PATH = path.resolve(import.meta.dir, "../../data/by-source/exclusions.pmtiles");

const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

const tilesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1200, // static reads are cheap — generous ceiling for bursty panning.
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[ratelimit] exclusion tiles flood user=${req.user?.email}`);
    res.status(429).json({ error: "Too many tile requests" });
  },
});

const sourcesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

/** Local-file Source for the pmtiles reader — ranged reads via Bun.file (lazy). */
class FileSource implements Source {
  constructor(private readonly filePath: string) {}
  getKey(): string {
    return this.filePath;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const data = await Bun.file(this.filePath)
      .slice(offset, offset + length)
      .arrayBuffer();
    return { data };
  }
}

// Lazy singleton — opens the archive once; pmtiles caches header + directories.
let pmInstance: PMTiles | null = null;
function getPM(): PMTiles | null {
  if (pmInstance) return pmInstance;
  if (!existsSync(PMTILES_PATH)) return null;
  pmInstance = new PMTiles(new FileSource(PMTILES_PATH));
  return pmInstance;
}

/**
 * Vector tile endpoint — reads z/x/y straight from the PMTiles archive. tippecanoe
 * stores gzipped MVT, so we forward Content-Encoding: gzip when the bytes are
 * gzip-magic'd (the browser inflates; MapLibre can't inflate itself).
 */
router.get(
  "/tiles/exclusions/:z/:x/:y.mvt",
  ...requirePro,
  tilesLimiter,
  async (req: Request, res: Response) => {
    const pm = getPM();
    if (!pm) {
      res.status(503).json({ error: "Exclusion tiles not baked — run bake-exclusions-pmtiles.ts" });
      return;
    }

    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
      res.status(400).end();
      return;
    }
    if (z < 5 || z > MAX_TILE_ZOOM) {
      res.status(204).end();
      return;
    }
    const gridSize = 2 ** z;
    if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) {
      res.status(400).end();
      return;
    }
    // Allowlist only the `v` cache-buster (mirrors the turbine tile route).
    const queryKeys = Object.keys(req.query);
    const v = req.query.v;
    if (queryKeys.some((k) => k !== "v") || (v !== undefined && !/^\d{1,6}$/.test(String(v)))) {
      res.status(400).end();
      return;
    }

    try {
      const tile = await pm.getZxy(z, x, y);
      res.setHeader("Content-Type", "application/vnd.mapbox-vector-tile");
      res.setHeader(
        "Cache-Control",
        process.env.NODE_ENV === "production" ? `private, max-age=${TILE_TTL}` : "no-store",
      );
      if (!tile || !tile.data || tile.data.byteLength === 0) {
        res.status(204).end();
        return;
      }
      // The pmtiles lib returns the tile DECOMPRESSED; gzip it for the wire (MVTs
      // compress ~3x — a z6 tile is ~1.5 MB raw / ~0.5 MB gzipped — and the
      // browser inflates transparently). Pass through if it's already gzipped.
      const raw = Buffer.from(tile.data);
      const alreadyGz = raw[0] === 0x1f && raw[1] === 0x8b;
      res.setHeader("Content-Encoding", "gzip");
      res.send(alreadyGz ? raw : Bun.gzipSync(raw));
    } catch (err) {
      console.error("[exclusion-tiles] pmtiles read failed", err);
      res.status(500).json({ error: "Tile read failed" });
    }
  },
);

/**
 * Per-source provenance for the click-to-inspect "why". Small (≈17 rows), so the
 * frontend fetches it once when the layer is enabled and maps source_id → row.
 */
router.get("/exclusion-sources", ...requirePro, sourcesLimiter, async (_req: Request, res: Response) => {
  if (!dbAvailable()) {
    res.status(503).json({ error: "Map data offline" });
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT source_id, layer_code, class, legal_tier, is_legal_boundary,
              license, authority, notes
       FROM wce.source_registry ORDER BY legal_tier, source_id`,
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.json(rows);
  } catch (err) {
    console.error("[exclusion-sources] query failed", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

export default router;
