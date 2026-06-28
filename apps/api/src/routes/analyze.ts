import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { requirePro } from "../middleware/requirePro";
import { analyzeAoi } from "../services/analysis";
import {
  ANALYSIS_RETRY_AFTER_SECONDS,
  MAX_CONCURRENT_ANALYSES,
  tryAcquireAnalysisSlot,
} from "../services/analysis/concurrency";
import { analyzeRequestSchema, validateAoi } from "../services/analysis/geometry";
import { INDIA_BBOX } from "../services/analysis/constants";
import { computePointReport } from "../services/analysis/point";
import {
  getCachedResult,
  putCachedResult,
  resultCacheKey,
} from "../services/analysis/resultCache";
import { GeometryError, type ValidatedAoi } from "../services/analysis/types";

const router = Router();

/** Plan §3: user-keyed rate limit, 20 analyses per minute. */
const ANALYZE_LIMIT_PER_WINDOW = 20;
const ANALYZE_WINDOW_MS = 60_000;

// Rate limit keys on user id, not IP — NAT/mobile carriers share IPs and a
// shared-IP block would lock out paying users. Falls back to IP for unauth'd
// requests (which requirePro will 401 anyway, but the limiter runs first).
// Pattern copied from routes/windmills.ts.
const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

const analyzeLimiter = rateLimit({
  windowMs: ANALYZE_WINDOW_MS,
  limit: ANALYZE_LIMIT_PER_WINDOW,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[ratelimit] analyze flood user=${req.user?.email}`);
    res.status(429).json({ error: "Too many analysis requests" });
  },
});

// POST /api/analyze — Pro-gated site screening (plan §3).
//
// Error contract: invalid geometry → 400 { error, code } (machine-readable
// GeometryErrorCode). Section failures NEVER reach this handler — they
// degrade to status "unavailable" inside analyzeAoi (plan §2.8). A 500 here
// means an unexpected infrastructure fault, and the body never leaks
// internals — full context goes to the server log only.
router.post(
  "/analyze",
  ...requirePro,
  analyzeLimiter,
  async (req: Request, res: Response) => {
    let aoi: ValidatedAoi;
    try {
      const parsed = analyzeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "request body must be { geometry: GeoJSON Polygon }",
          code: "INVALID_GEOMETRY",
        });
        return;
      }
      aoi = validateAoi(parsed.data.geometry);
    } catch (err) {
      if (err instanceof GeometryError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      console.error("[analyze] geometry validation crashed", err);
      res.status(500).json({ error: "Analysis failed" });
      return;
    }

    try {
      const cacheKey = resultCacheKey(aoi);
      const cached = await getCachedResult(cacheKey);
      if (cached !== null) {
        res.setHeader("X-Analysis-Cache", "HIT");
        res.json(cached);
        return;
      }

      // Server-wide concurrency gate (cache misses only): without it, one
      // 20-request burst per Pro account would put every analysis in flight
      // at once, amplifying into thousands of upstream GWA tile fetches.
      const slot = tryAcquireAnalysisSlot();
      if (slot === null) {
        console.warn(
          `[analyze] concurrency cap ${MAX_CONCURRENT_ANALYSES} reached; user=${req.user?.id}`,
        );
        res.setHeader("Retry-After", String(ANALYSIS_RETRY_AFTER_SECONDS));
        res.status(429).json({
          error: "Server is at its analysis limit — please retry shortly",
        });
        return;
      }
      let response;
      try {
        response = await analyzeAoi(aoi);
      } finally {
        slot.release();
      }
      // Fire-and-forget: a cache write failure is logged inside and must
      // never delay or fail the response.
      void putCachedResult(cacheKey, response);
      res.setHeader("X-Analysis-Cache", "MISS");
      res.json(response);
    } catch (err) {
      console.error("[analyze] failed", { user: req.user?.id, err });
      res.status(500).json({ error: "Analysis failed" });
    }
  },
);

// POST /api/analyze/point — exact-point screening for ONE coordinate (a clicked
// turbine in an uploaded micro-sited layout). Reads GWA/grid/mast/exclusion AT
// the point — no AOI averaging. Reuses the analyze rate-limit + concurrency gate.
router.post(
  "/analyze/point",
  ...requirePro,
  analyzeLimiter,
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { lon?: unknown; lat?: unknown };
    const lon = body.lon;
    const lat = body.lat;
    if (
      typeof lon !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat)
    ) {
      res.status(400).json({
        error: "request body must be { lon: number, lat: number }",
        code: "INVALID_POINT",
      });
      return;
    }
    const [west, south, east, north] = INDIA_BBOX;
    if (lon < west || lon > east || lat < south || lat > north) {
      res.status(400).json({
        error: "point is outside the India analysis area",
        code: "OUT_OF_INDIA",
      });
      return;
    }

    const slot = tryAcquireAnalysisSlot();
    if (slot === null) {
      console.warn(
        `[analyze/point] concurrency cap ${MAX_CONCURRENT_ANALYSES} reached; user=${req.user?.id}`,
      );
      res.setHeader("Retry-After", String(ANALYSIS_RETRY_AFTER_SECONDS));
      res.status(429).json({
        error: "Server is at its analysis limit — please retry shortly",
      });
      return;
    }
    try {
      const report = await computePointReport(lon, lat);
      res.json(report);
    } catch (err) {
      console.error("[analyze/point] failed", { user: req.user?.id, err });
      res.status(500).json({ error: "Point analysis failed" });
    } finally {
      slot.release();
    }
  },
);

export default router;
