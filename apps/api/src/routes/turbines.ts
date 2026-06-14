import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { requirePro } from "../middleware/requirePro";
import { tileCache } from "../middleware/tileCache";
import { pool, dbAvailable } from "../lib/db";

/**
 * Individual wind-turbine layer for the Pro map (black dots). Data is OSM /
 * OpenInfraMap power=generator + generator:source=wind, ingested into the
 * `wind_turbines` table by scripts/ingest-turbines.ts. Mirrors the windmills
 * (NIWE mast) route: a Pro-gated, disk-cached MVT tile endpoint ships id +
 * geometry only; per-click attributes leave the server one record at a time
 * via /turbine/:id.
 */

const router = Router();

const TILE_TTL = Number(process.env.TILE_CACHE_TTL || 3600);

// Our PK is a generated UUID (same as windmills) — validate before hitting pg.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Below this zoom the tile SQL collapses coincident turbines onto a pixel grid
// so a country-scale tile never emits tens of thousands of overlapping points;
// at/above it every turbine is emitted (individually distinguishable on screen,
// and the detail endpoint always has the full set regardless of zoom).
const TURBINE_FULL_ZOOM = 11;
const TILE_EXTENT = 4096; // MVT default; matches ST_AsMVTGeom default extent.
// One representative point per ~8 screen px at low zoom (extent/8 grid cells).
const LOW_ZOOM_PX_PER_POINT = 8;
// Full Web-Mercator (EPSG:3857) world span in metres. The low-zoom thinning
// grid is computed in metres and snapped on the 3857 geometry so its cells are
// SQUARE on screen everywhere — snapping in raw 4326 degrees would give cells
// ~15% narrower E–W than N–S at India's latitudes (uneven thinning density).
const WEB_MERCATOR_SPAN_M = 40075016.685578488;

const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

// Map panning is bursty (one drag = dozens of tiles). Generous ceiling, same
// as the windmill tiles limiter.
const tilesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[ratelimit] turbine tiles flood user=${req.user?.email}`);
    res.status(429).json({ error: "Too many tile requests" });
  },
});

// Per-click detail. A human clicks a few turbines; hundreds/min = scraper.
const detailLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[ratelimit] turbine detail flood user=${req.user?.email}`);
    res.status(429).json({ error: "Too many detail requests" });
  },
});

// The dataset only changes on re-ingestion, and the frontend tile URL carries
// a ?v= version bumped after each re-ingest, so 24 h of staleness is safe.
const TURBINE_TILE_DISK_TTL_MS = 24 * 3600 * 1000;

/**
 * Vector tile endpoint. Ships ONLY id + geometry — every attribute is exposed
 * one record at a time via /turbine/:id. requirePro runs BEFORE tileCache so
 * auth always executes; the cached file (id + geometry, no per-user data) is
 * safe to share across all Pro users.
 */
router.get(
  "/tiles/turbines/:z/:x/:y.mvt",
  ...requirePro,
  tilesLimiter,
  tileCache("turbines", TURBINE_TILE_DISK_TTL_MS),
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

    // Zoom clamp mirrors the windmills route. Below z=4 you'd return national-
    // scale points (scrape risk); above z=16 the tile is sub-pixel.
    if (z < 4 || z > 16) {
      res.status(204).end();
      return;
    }

    // x/y outside the tile grid for this zoom can never resolve.
    const gridSize = 2 ** z;
    if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) {
      res.status(400).end();
      return;
    }

    // The disk cache key is md5(originalUrl) INCLUDING the query string, so an
    // unconstrained query would let a (Pro) client mint unlimited cold-miss
    // keys, each a DB query + a cache file. Allowlist only `v` (the frontend
    // cache-buster, a small integer) — mirrors the public power-tile proxy.
    const queryKeys = Object.keys(req.query);
    const v = req.query.v;
    if (
      queryKeys.some((k) => k !== "v") ||
      (v !== undefined && !/^\d{1,6}$/.test(String(v)))
    ) {
      res.status(400).end();
      return;
    }

    try {
      // Full fidelity from TURBINE_FULL_ZOOM up; below it, collapse coincident
      // turbines onto a ~8-px screen grid so the tile stays light. The grid is
      // sized + snapped in Web Mercator metres (square on-screen cells).
      const useFull = z >= TURBINE_FULL_ZOOM;
      const gridMeters =
        WEB_MERCATOR_SPAN_M / gridSize / (TILE_EXTENT / LOW_ZOOM_PX_PER_POINT);

      const sql = useFull
        ? `
          WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b)
          SELECT ST_AsMVT(t, 'turbines') AS mvt FROM (
            SELECT
              id::text AS id,
              ST_AsMVTGeom(ST_Transform(geom, 3857), bounds.b) AS geom
            FROM wind_turbines, bounds
            WHERE geom && ST_Transform(bounds.b, 4326)
          ) t
          WHERE t.geom IS NOT NULL
          `
        : `
          WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b),
          src AS (
            SELECT DISTINCT ON (ST_SnapToGrid(ST_Transform(w.geom, 3857), $4::float8))
              w.id, w.geom
            FROM wind_turbines w, bounds
            WHERE w.geom && ST_Transform(bounds.b, 4326)
            ORDER BY ST_SnapToGrid(ST_Transform(w.geom, 3857), $4::float8), w.id
          )
          SELECT ST_AsMVT(t, 'turbines') AS mvt FROM (
            SELECT
              src.id::text AS id,
              ST_AsMVTGeom(ST_Transform(src.geom, 3857), bounds.b) AS geom
            FROM src, bounds
          ) t
          WHERE t.geom IS NOT NULL
          `;

      const params = useFull ? [z, x, y] : [z, x, y, gridMeters];
      const { rows } = await pool.query<{ mvt: Buffer }>(sql, params);

      const mvt = rows[0]?.mvt;
      res.setHeader("Content-Type", "application/vnd.mapbox-vector-tile");
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
      console.error("[turbine-tiles] query failed", err);
      res.status(500).json({ error: "Tile generation failed" });
    }
  },
);

// Per-click detail. The ONLY place per-turbine attributes leave the server.
router.get(
  "/turbine/:id",
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
          osm_type, osm_id,
          ST_Y(geom) AS lat,
          ST_X(geom) AS lon,
          name, operator, manufacturer, model,
          rated_power_kw, rated_power_raw,
          hub_height_m, rotor_diameter_m,
          start_date, ele_m, ref
        FROM wind_turbines
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
      console.error("[turbine] query failed", err);
      res.status(500).json({ error: "Lookup failed" });
    }
  },
);

export default router;
