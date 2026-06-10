import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { tileCache } from "../middleware/tileCache";

/**
 * Proxy for OpenInfraMap power-grid vector tiles (transmission lines,
 * substations, power plants). Public — the data is ODbL OpenStreetMap; the
 * proxy exists so the browser never depends on openinframap.org directly and
 * so tiles are cached on our disk (see middleware/tileCache.ts).
 *
 * Schema verified 2026-06-10 against live tiles (see
 * apps/web/components/Map/utils/powerGrid.ts for the layer/property
 * constants): upstream serves z0–z17, Content-Type
 * application/vnd.mapbox-vector-tile, Content-Encoding gzip. Bun's fetch
 * auto-decompresses the body (while leaving the header on the Response
 * object), so the Buffer below is identity-encoded protobuf — we must NOT
 * forward upstream's Content-Encoding header.
 */

const router = Router();

const UPSTREAM_BASE = "https://openinframap.org/map/power";
// Verified 2026-06-10: z17 → 200, z18 → 404.
const UPSTREAM_MAX_ZOOM = 17;
const UPSTREAM_TIMEOUT_MS = 5_000;
const BROWSER_CACHE_SECONDS = 7 * 24 * 3600;

// Public endpoint → IP-keyed limiter. Same generous ceiling as the windmill
// tiles: one map drag fetches dozens of tiles.
const powerTilesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[ratelimit] power tiles flood ip=${req.ip}`);
    res.status(429).json({ error: "Too many tile requests" });
  },
});

router.get(
  "/tiles/power/:z/:x/:y.pbf",
  powerTilesLimiter,
  tileCache("power"),
  async (req: Request, res: Response) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (
      !Number.isInteger(z) || z < 0 ||
      !Number.isInteger(x) || x < 0 ||
      !Number.isInteger(y) || y < 0
    ) {
      res.status(400).end();
      return;
    }

    // The cache key is md5(originalUrl) INCLUDING the query string, so an
    // unconstrained query would let one client mint unlimited cold-miss keys
    // (each an upstream fetch + disk write). Allowlist: only `v` (the
    // frontend cache-buster), small integer. Anything else → 400, which the
    // cache middleware never stores and the handler never proxies.
    const queryKeys = Object.keys(req.query);
    const v = req.query.v;
    if (
      queryKeys.some((k) => k !== "v") ||
      (v !== undefined && !/^\d{1,6}$/.test(String(v)))
    ) {
      res.status(400).end();
      return;
    }

    // Safety net — the frontend source's maxzoom prevents these requests,
    // but a hand-crafted URL above the upstream ceiling is a guaranteed 404.
    if (z > UPSTREAM_MAX_ZOOM) {
      res.status(404).end();
      return;
    }

    // x/y outside the tile grid for this zoom can never resolve.
    const gridSize = 2 ** z;
    if (x >= gridSize || y >= gridSize) {
      res.status(400).end();
      return;
    }

    try {
      const upstream = await fetch(`${UPSTREAM_BASE}/${z}/${x}/${y}.pbf`, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (!upstream.ok) {
        if (upstream.status !== 404) {
          console.warn(
            `[power-tiles] upstream ${upstream.status} for ${z}/${x}/${y}`,
          );
        }
        // Degrade silently: MapLibre treats 204 as "no data here" without
        // logging or retrying. If a stale cached copy exists, the tileCache
        // middleware intercepts this 204 and serves it instead.
        res.status(204).end();
        return;
      }

      const body = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", "application/x-protobuf");
      res.setHeader("Cache-Control", `public, max-age=${BROWSER_CACHE_SECONDS}`);
      res.send(body);
    } catch (err) {
      console.warn("[power-tiles] upstream fetch failed", {
        z,
        x,
        y,
        err: (err as Error)?.message,
      });
      res.status(204).end();
    }
  },
);

export default router;
