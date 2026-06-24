/**
 * Site-analysis report routes (plan §6).
 *
 * POST /api/site-analysis/report — Pro-gated 6-page PDF export.
 *   SCAFFOLD (PR0): wired + auth/flag-gated but inert (404 flag-off / 501 flag-on).
 *   Real pipeline (zod-validate → buildReportModel → renderReportHtml →
 *   withPage(renderPdf) → stream application/pdf) lands in PR11.
 *
 * GET /api/site-analysis/report/preview — PR8 fast-layout-iteration route.
 *   Renders a SAMPLE ReportModel to text/html so the template can be tuned in a
 *   plain browser in milliseconds (no Puppeteer, no DB, no GWA tiles). Flag-gated
 *   AND non-prod only — it serves sample data and must never be reachable in
 *   production. Not Pro-gated (a dev tool that exposes no user data).
 *   `?fixture=high-wind|null-resource|multi-state|no-nearby` (default high-wind).
 */

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import { requirePro } from "../middleware/requirePro";
import { analyzeAoi } from "../services/analysis";
import {
  ANALYSIS_RETRY_AFTER_SECONDS,
  tryAcquireAnalysisSlot,
} from "../services/analysis/concurrency";
import { validateAoi } from "../services/analysis/geometry";
import { findNearbyBetterSite } from "../services/analysis/nearbySite";
import { getPolicyContext } from "../services/analysis/policyContext";
import {
  getCachedResult,
  putCachedResult,
  resultCacheKey,
} from "../services/analysis/resultCache";
import { GeometryError, type ValidatedAoi } from "../services/analysis/types";
import { poolStats, PoolBusyError } from "../services/report/browserPool";
import {
  PDF_EXPORT_RATE_LIMIT,
  PDF_EXPORT_RATE_WINDOW_MS,
  REPORT_PDF_ENABLED,
} from "../services/report/config";
import {
  recordOutcome,
  recordRequest,
  snapshot,
} from "../services/report/metrics";
import {
  generateReportPdf,
  inFlightReportCount,
  ReportRequestError,
  reportRequestSchema,
  selectedSiteFrom,
  validateMapImages,
} from "../services/report/reportController";
import {
  buildReportModel,
  type ReportMapImages,
} from "../services/report/reportModel";
import { renderReportHtml } from "../services/report/renderReportHtml";
import {
  isSampleFixture,
  SAMPLE_FIXTURES,
  sampleReportModel,
} from "../services/report/sampleReportModel";

const router = Router();

/** Rate-limit keys on user id (NAT-safe), falling back to IP — analyze pattern. */
const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

/**
 * Per-user export limit (plan §6.4). A different lever from the pool's 503:
 * 429 = "you personally asked too often"; 503 = "the box is momentarily full".
 */
const exportLimiter = rateLimit({
  windowMs: PDF_EXPORT_RATE_WINDOW_MS,
  limit: PDF_EXPORT_RATE_LIMIT,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    recordOutcome("rateLimited429");
    console.warn(`[report] export rate-limit user=${req.user?.email}`);
    res.setHeader(
      "Retry-After",
      String(Math.ceil(PDF_EXPORT_RATE_WINDOW_MS / 1000)),
    );
    res
      .status(429)
      .json({ error: "Too many report exports", code: "RATE_LIMITED" });
  },
});

router.post(
  "/site-analysis/report",
  ...requirePro,
  exportLimiter,
  async (req: Request, res: Response) => {
    if (!REPORT_PDF_ENABLED) {
      res.status(404).json({ error: "PDF export is not enabled" });
      return;
    }
    recordRequest();

    // ── Validate body, geometry, and the inline map images ──────────────────
    const parsed = reportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      recordOutcome("badRequest400");
      res
        .status(400)
        .json({ error: "invalid request body", code: "INVALID_BODY" });
      return;
    }
    let aoi: ValidatedAoi;
    let mapImages: ReportMapImages;
    try {
      aoi = validateAoi(parsed.data.geometry);
      mapImages = validateMapImages(parsed.data.mapImages);
    } catch (err) {
      if (err instanceof GeometryError || err instanceof ReportRequestError) {
        recordOutcome("badRequest400");
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      recordOutcome("failed500");
      console.error("[report] validation crashed", err);
      res.status(500).json({ error: "Report generation failed" });
      return;
    }

    // Free the render page immediately if the client navigates away (plan §5.1).
    const ac = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });

    try {
      // ── Recompute (or reuse cached) analysis — mirrors POST /analyze ───────
      const cacheKey = resultCacheKey(aoi);
      let analysis = await getCachedResult(cacheKey);
      if (analysis === null) {
        const slot = tryAcquireAnalysisSlot();
        if (slot === null) {
          recordOutcome("analysisBusy503");
          res.setHeader("Retry-After", String(ANALYSIS_RETRY_AFTER_SECONDS));
          res.status(503).json({
            error: "Server is at its analysis limit — retry shortly",
            code: "BUSY",
          });
          return;
        }
        try {
          analysis = await analyzeAoi(aoi);
        } finally {
          slot.release();
        }
        void putCachedResult(cacheKey, analysis);
      }

      // ── Controller-supplied I/O (degrade, never fail the export) ───────────
      const selected = selectedSiteFrom(analysis);
      const [policy, nearbySite] = await Promise.all([
        getPolicyContext(parsed.data.geometry).catch(() => null),
        selected
          ? findNearbyBetterSite({
              centroid: aoi.centroid,
              areaKm2: aoi.areaKm2,
              selected,
            }).catch(() => ({
              found: false,
              reason: "nearby-site search failed",
            }))
          : Promise.resolve(null),
      ]);

      // ── Build the model, render the PDF (de-duped), stream it back ─────────
      const model = buildReportModel({
        analysis,
        aoi,
        mapImages,
        generatedAt: new Date().toISOString(),
        policy,
        nearbySite,
      });
      const pdf = await generateReportPdf({ model, signal: ac.signal });
      if (res.writableEnded) return; // client already disconnected

      const filename = `windpower-site-${model.meta.inputsHash.slice(0, 8)}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-Length", String(pdf.length));
      res.send(Buffer.from(pdf));
      recordOutcome("succeeded");
    } catch (err) {
      if (err instanceof PoolBusyError) {
        recordOutcome("poolBusy503");
        res.setHeader("Retry-After", "5");
        res.status(503).json({
          error: "Render pool busy — retry shortly",
          code: "POOL_BUSY",
        });
        return;
      }
      if ((err as Error)?.name === "AbortError") {
        recordOutcome("aborted");
        return; // client gone
      }
      recordOutcome("failed500");
      console.error("[report] failed", { user: req.user?.id, err });
      if (!res.headersSent) {
        res.status(500).json({ error: "Report generation failed" });
      }
    }
  },
);

router.get("/site-analysis/report/preview", (req: Request, res: Response) => {
  // Dev-only: behind the feature flag and never served in production.
  if (!REPORT_PDF_ENABLED || process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Report preview is not enabled" });
    return;
  }
  const raw =
    typeof req.query.fixture === "string" ? req.query.fixture : "high-wind";
  if (!isSampleFixture(raw)) {
    res.status(400).json({
      error: "Unknown fixture",
      code: "BAD_FIXTURE",
      allowed: SAMPLE_FIXTURES,
    });
    return;
  }
  const html = renderReportHtml(sampleReportModel(raw));
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(html);
});

/**
 * GET /api/site-analysis/report/stats — ops observability (PR15).
 *
 * Returns the in-process render metrics so we can tell whether the §6.4
 * async-queue triggers (p95 render >~10s, nonzero queue-wait, climbing 503s)
 * have fired before building the queue. This is operational, not user-facing,
 * data, and must work in production without a user session — so it is gated by a
 * shared bearer token in `REPORT_METRICS_TOKEN`, NOT requirePro. Fail-closed:
 * when the token is unset the route 404s (feature off), so production never
 * exposes metrics by accident. Independent of REPORT_PDF_ENABLED so stats stay
 * inspectable even after the export kill-switch is flipped.
 */
router.get("/site-analysis/report/stats", (req: Request, res: Response) => {
  const token = process.env.REPORT_METRICS_TOKEN;
  if (!token) {
    res.status(404).json({ error: "Report metrics are not enabled" });
    return;
  }
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided !== token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(
    snapshot({ pool: poolStats(), inFlight: inFlightReportCount() }),
  );
});

export default router;
