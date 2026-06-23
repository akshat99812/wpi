/**
 * Integration test (plan §8.3): the full render path through REAL Chromium —
 * sampleReportModel → renderReportHtml → withPage(renderPdf) → a valid multi-
 * page A4 PDF. Asserts the magic header, the page count via pdf-parse, and that
 * body text is extractable (vector text, not a rasterised DOM).
 *
 * Launches a headless browser, so it is slower than the unit suites; the shared
 * pool is closed in afterAll.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { PDFParse } from "pdf-parse";

import { shutdownBrowserPool, withPage } from "./browserPool";
import { renderPdf } from "./renderPdf";
import { renderReportHtml } from "./renderReportHtml";
import { sampleReportModel } from "./sampleReportModel";

afterAll(async () => {
  await shutdownBrowserPool();
});

describe("renderPdf — real Chromium print", () => {
  test(
    "renders the sample report to a valid multi-page A4 PDF",
    async () => {
      const html = renderReportHtml(sampleReportModel("high-wind"));
      const bytes = await withPage((page) => renderPdf(page, html));
      const buf = Buffer.from(bytes);

      expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(5_000);

      const parsed = await new PDFParse({ data: buf }).getText();
      // The template is six logical pages; dense fixtures must not overflow that.
      expect(parsed.total).toBe(6);
      // Body text is real (extractable) text, and the brand renders.
      expect(parsed.text).toContain("WindPower India");
      expect(parsed.text).toContain("Equity IRR");
    },
    60_000,
  );

  test(
    "null-resource report still produces a 6-page PDF (N/A, not a crash)",
    async () => {
      const html = renderReportHtml(sampleReportModel("null-resource"));
      const bytes = await withPage((page) => renderPdf(page, html));
      const buf = Buffer.from(bytes);
      expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const parsed = await new PDFParse({ data: buf }).getText();
      expect(parsed.total).toBe(6);
    },
    60_000,
  );
});
