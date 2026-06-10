import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { requirePro } from "../middleware/requirePro";
import { tileCache } from "../middleware/tileCache";
import { pool, dbAvailable } from "../lib/db";

const router = Router();

const TILE_TTL = Number(process.env.TILE_CACHE_TTL || 3600);

// UUID v4-ish format (any RFC 4122 variant). The DB will reject malformed
// strings too, but bailing here keeps junk traffic off the pool.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limit keys on user id, not IP — NAT/mobile carriers share IPs and a
// shared-IP block would lock out paying users. Falls back to IP for unauth'd
// requests (which requirePro will 401 anyway, but the limiter runs first).
const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

// Map panning is bursty (one drag = dozens of tiles). Generous ceiling.
const tilesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[ratelimit] tiles flood user=${req.user?.email}`);
    res.status(429).json({ error: "Too many tile requests" });
  },
});

// Per-click detail. A human clicks a few pins; hundreds/min = scraper.
const detailLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[ratelimit] detail flood user=${req.user?.email}`);
    res.status(429).json({ error: "Too many detail requests" });
  },
});

// Disk-cache TTL for windmill tiles. The dataset only changes on re-ingestion,
// and the frontend tile URL carries a ?v= version that must be bumped after
// each re-ingest, so 24 h of staleness is safe.
const WINDMILL_TILE_DISK_TTL_MS = 24 * 3600 * 1000;

// Vector tile endpoint. Tiles ship ONLY id + geometry — no attributes, ever.
// Proprietary attributes are exposed one record at a time via /windmill/:id.
//
// Middleware order matters: requirePro runs BEFORE tileCache, so auth always
// executes and the cache only skips the PostGIS query. One cached file serves
// ALL Pro users — safe because the tile SQL below selects id + geometry only,
// with no per-user/per-account filtering. If per-user filtering is ever added,
// the cache key must include a user-id/role hash (or the cache must go).
router.get(
  "/tiles/:z/:x/:y.mvt",
  ...requirePro,
  tilesLimiter,
  tileCache("windmills", WINDMILL_TILE_DISK_TTL_MS),
  async (req: Request, res: Response) => {
    if (!dbAvailable()) {
      res.status(503).json({ error: "Map data offline" });
      return;
    }

    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
      res.status(400).end();
      return;
    }

    // Zoom clamp. Below z=4 you'd be returning national-scale points (scrape
    // risk). Above z=16 there's no point — the tile is smaller than a pin.
    if (z < 4 || z > 16) {
      res.status(204).end();
      return;
    }

    try {
      const { rows } = await pool.query<{ mvt: Buffer }>(
        `
        WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b)
        SELECT ST_AsMVT(t, 'windmills') AS mvt FROM (
          SELECT
            id::text AS id,
            ST_AsMVTGeom(ST_Transform(geom, 3857), bounds.b) AS geom
          FROM windmills, bounds
          WHERE geom && ST_Transform(bounds.b, 4326)
        ) t
        WHERE t.geom IS NOT NULL
        `,
        [z, x, y],
      );

      const mvt = rows[0]?.mvt;
      res.setHeader("Content-Type", "application/vnd.mapbox-vector-tile");
      // In dev, never cache: re-ingesting changes UUIDs and stale browser
      // tiles point at IDs that 404 on /windmill/:id.
      const cacheControl =
        process.env.NODE_ENV === "production"
          ? `private, max-age=${TILE_TTL}`
          : "no-store";
      res.setHeader("Cache-Control", cacheControl);

      if (!mvt || mvt.length === 0) {
        res.status(204).end();
        return;
      }
      res.send(mvt);
    } catch (err) {
      console.error("[tiles] query failed", err);
      res.status(500).json({ error: "Tile generation failed" });
    }
  },
);

// Per-click detail. The ONLY place proprietary attributes leave the server.
router.get(
  "/windmill/:id",
  ...requirePro,
  detailLimiter,
  async (req: Request, res: Response) => {
    if (!dbAvailable()) {
      res.status(503).json({ error: "Map data offline" });
      return;
    }

    const id = req.params.id;
    if (!id || !UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    try {
      const { rows } = await pool.query(
        `
        SELECT
          id,
          ST_Y(geom) AS lat,
          ST_X(geom) AS lon,
          cum_no, sl_no,
          state, station, district,
          date_commence, date_close,
          mast_height_m, elevation_masl,
          maws_ms, mawpd_wm2,
          coord_complete
        FROM windmills
        WHERE id = $1
        `,
        [id],
      );

      if (rows.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(rows[0]);
    } catch (err) {
      console.error("[windmill] query failed", err);
      res.status(500).json({ error: "Lookup failed" });
    }
  },
);

export default router;
