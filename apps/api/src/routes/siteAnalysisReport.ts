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
import { requirePro } from "../middleware/requirePro";
import { REPORT_PDF_ENABLED } from "../services/report/config";
import { renderReportHtml } from "../services/report/renderReportHtml";
import {
  isSampleFixture,
  SAMPLE_FIXTURES,
  sampleReportModel,
} from "../services/report/sampleReportModel";

const router = Router();

router.post(
  "/site-analysis/report",
  ...requirePro,
  async (_req: Request, res: Response) => {
    if (!REPORT_PDF_ENABLED) {
      res.status(404).json({ error: "PDF export is not enabled" });
      return;
    }
    res.status(501).json({
      error: "PDF export not implemented yet",
      code: "NOT_IMPLEMENTED",
    });
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
