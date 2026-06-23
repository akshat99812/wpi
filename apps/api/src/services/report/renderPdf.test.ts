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
import { SAMPLE_FIXTURES, sampleReportModel } from "./sampleReportModel";

afterAll(async () => {
  await shutdownBrowserPool();
});

async function renderToPdf(fixture: Parameters<typeof sampleReportModel>[0]) {
  const html = renderReportHtml(sampleReportModel(fixture));
  return Buffer.from(await withPage((page) => renderPdf(page, html)));
}

describe("renderPdf — real Chromium print", () => {
  test(
    "renders the high-wind sample to a valid 6-page PDF with extractable text",
    async () => {
      const buf = await renderToPdf("high-wind");
      expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(5_000);

      const parsed = await new PDFParse({ data: buf }).getText();
      expect(parsed.total).toBe(6);
      // Body text is real (extractable) text, and the brand renders.
      expect(parsed.text).toContain("WindPower India");
      expect(parsed.text).toContain("Equity IRR");
    },
    60_000,
  );

  test(
    "every fixture stays exactly 6 pages (no overflow on the dense ones)",
    async () => {
      // Guards the 6-page invariant across all branches: multi-state's wider
      // policy table and the null-resource N/A page must not spill to a 7th.
      for (const fixture of SAMPLE_FIXTURES) {
        const buf = await renderToPdf(fixture);
        expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
        const parsed = await new PDFParse({ data: buf }).getText();
        expect(parsed.total).toBe(6);
      }
    },
    120_000,
  );
});
