/**
 * POST /api/site-analysis/report — Pro-gated 6-page PDF export (plan §6).
 *
 * SCAFFOLD (PR0): the route is wired, auth-gated, and flag-gated but inert.
 * - flag OFF (default) → 404 (feature does not exist).
 * - flag ON           → 501 (pipeline not implemented yet).
 *
 * The real pipeline — zod-validate body → buildReportModel → renderReportHtml →
 * withPage(renderPdf) → stream application/pdf — lands in PR11, mirroring the
 * conventions in routes/analyze.ts (user-keyed rate limit, concurrency, error
 * contract). A flag-gated GET /api/site-analysis/report/preview (text/html) is
 * added in PR8 for fast layout iteration.
 */

import { Router, type Request, type Response } from "express";
import { requirePro } from "../middleware/requirePro";
import { REPORT_PDF_ENABLED } from "../services/report/config";

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

export default router;
