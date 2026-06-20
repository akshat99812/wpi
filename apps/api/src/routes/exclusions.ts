import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { requirePro } from "../middleware/requirePro";
import { tileCache } from "../middleware/tileCache";
import { pool, dbAvailable } from "../lib/db";

/**
 * Legal exclusion-zone layer for the Pro map (red = hard exclusion, amber =
 * verify-before-use). Polygons live in wce.excl_polygon (downloaded legal
 * boundaries) + wce.excl_buffer (derived ESZ-default / ASI / settlement),
 * loaded by scripts/ingest-exclusions.ts. Mirrors the turbines route: a
 * Pro-gated, disk-cached MVT endpoint. Tiles ship light props (layer_code,
 * class, legal flag, source) so the popup can explain "why" without a second
 * round-trip; full per-source provenance comes from /exclusion-sources.
 */

const router = Router();

const TILE_TTL = Number(process.env.TILE_CACHE_TTL || 3600);
const TILE_EXTENT = 4096; // MVT default; matches ST_AsMVTGeom default extent.
const WEB_MERCATOR_SPAN_M = 40075016.685578488;
// At/above this zoom every polygon is emitted; below it, sub-N-pixel polygons
// are dropped + geometry simplified so a regional tile over dense RFA forest
// (422k compartment polys) stays light.
const EXCL_FULL_ZOOM = 11;
const EXCL_TILE_DISK_TTL_MS = 24 * 3600 * 1000;
// Approx m² per degree² at ~22°N (India centroid) — used only for a cheap
// planar sliver filter, where exactness doesn't matter.
const APPROX_M2_PER_DEG2 = 1.1e10;
const DEG_METERS = 111320; // metres per degree of latitude (for the simplify tol).

const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

const tilesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
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

/**
 * Vector tile endpoint. One source-layer 'exclusions' carries both downloaded
 * zones and derived buffers, tagged by `kind`. Props are lightweight; geometry
 * is clipped to the tile and (below EXCL_FULL_ZOOM) simplified + sliver-dropped.
 */
router.get(
  "/tiles/exclusions/:z/:x/:y.mvt",
  ...requirePro,
  tilesLimiter,
  tileCache("exclusions", EXCL_TILE_DISK_TTL_MS),
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
    // Below z=5 a tile would emit national-scale polygons; above z=16 sub-pixel.
    if (z < 5 || z > 16) {
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

    // Tile metres-per-pixel → simplify tolerance (~1.5 px). Sliver filter +
    // per-tile feature cap keep dense tiles light (RFA = 422k tiny compartments,
    // so a raw z6 forest tile is ~35k features / 3 MB without these guards).
    // The cap is the hard guarantee: largest-area polygons win, capped count.
    const pxMeters = WEB_MERCATOR_SPAN_M / gridSize / TILE_EXTENT;
    // Cheap Douglas-Peucker simplify (~1.5 px) in 4326 BEFORE transform — plain
    // ST_Simplify, not PreserveTopology (which is ~10x slower and pointless at
    // tile resolution). Tolerance shrinks with zoom, so high zooms stay crisp.
    const simplifyTolDeg = (pxMeters * 1.5) / DEG_METERS;
    // Sliver threshold in deg² (cheap planar area, no transform). Within a single
    // tile latitude is ~constant, so planar-area ordering == true-area ordering.
    const minAreaDeg = z >= EXCL_FULL_ZOOM ? 0 : (pxMeters * 6) ** 2 / APPROX_M2_PER_DEG2;
    const featureCap = z >= EXCL_FULL_ZOOM ? 12000 : 4000;

    try {
      const sql = `
        WITH bounds AS (SELECT ST_TileEnvelope($1,$2,$3) AS b),
        cand AS (
          SELECT id, lc, cls, legal, src, kind, geom
          FROM (
            SELECT id, lc, cls, legal, src, kind, geom, ST_Area(geom) AS a
            FROM (
              SELECT e.id::text AS id, e.layer_code AS lc, e.class AS cls,
                     COALESCE((e.attrs->>'is_legal_boundary')::boolean, false) AS legal,
                     e.source_id AS src, 'zone' AS kind, e.geom
              FROM wce.excl_polygon e, bounds
              WHERE e.geom && ST_Transform(bounds.b, 4326)
              UNION ALL
              SELECT b.id::text, b.layer_code, b.class, false, b.source_id, 'buffer', b.geom
              FROM wce.excl_buffer b, bounds
              WHERE b.geom && ST_Transform(bounds.b, 4326)
            ) u
          ) z
          WHERE $5::float8 = 0 OR a > $5::float8
          ORDER BY a DESC
          LIMIT $6::int
        )
        SELECT ST_AsMVT(t,'exclusions') AS mvt FROM (
          SELECT id, lc, cls, legal, src, kind,
                 ST_AsMVTGeom(
                   ST_Transform(ST_Simplify(geom, $4::float8), 3857),
                   (SELECT b FROM bounds)
                 ) AS geom
          FROM cand
        ) t
        WHERE t.geom IS NOT NULL
      `;
      const { rows } = await pool.query<{ mvt: Buffer }>(sql, [z, x, y, simplifyTolDeg, minAreaDeg, featureCap]);
      const mvt = rows[0]?.mvt;

      res.setHeader("Content-Type", "application/vnd.mapbox-vector-tile");
      res.setHeader(
        "Cache-Control",
        process.env.NODE_ENV === "production" ? `private, max-age=${TILE_TTL}` : "no-store",
      );
      if (!mvt || mvt.length === 0) {
        res.status(204).end();
        return;
      }
      res.send(mvt);
    } catch (err) {
      console.error("[exclusion-tiles] query failed", err);
      res.status(500).json({ error: "Tile generation failed" });
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
