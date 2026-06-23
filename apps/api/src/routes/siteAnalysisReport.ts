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
import { PoolBusyError } from "../services/report/browserPool";
import {
  PDF_EXPORT_RATE_LIMIT,
  PDF_EXPORT_RATE_WINDOW_MS,
  REPORT_PDF_ENABLED,
} from "../services/report/config";
import {
  generateReportPdf,
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

    // ── Validate body, geometry, and the inline map images ──────────────────
    const parsed = reportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
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
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
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
    } catch (err) {
      if (err instanceof PoolBusyError) {
        res.setHeader("Retry-After", "5");
        res.status(503).json({
          error: "Render pool busy — retry shortly",
          code: "POOL_BUSY",
        });
        return;
      }
      if ((err as Error)?.name === "AbortError") return; // client gone
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

export default router;
