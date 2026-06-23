/**
 * Site-Analysis PDF Export — Puppeteer print step (plan §5.2/§5.3).
 *
 * Operates on a Page acquired from browserPool.withPage (never launches its own
 * browser — decision D5). setContent(html) → document.fonts.ready → page.pdf
 * with A4 + printBackground + native running header/footer. Caller closes the
 * page in `finally`.
 *
 * preferCSSPageSize uses the template's @page size + margin (print.css.ts):
 * the 18mm top / 16mm bottom margin is the space the running header/footer
 * occupy, so they never overlap the page bodies.
 */

import type { Page } from "puppeteer";

import { buildFooterHtml, buildHeaderHtml } from "./templates/headerFooter";

export interface RenderPdfOptions {
  /** Chromium header/footer are isolated docs — pass full inline-styled HTML. */
  headerHtml?: string;
  footerHtml?: string;
  /** Hard cap for setContent navigation + pdf generation. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function renderPdf(
  page: Page,
  html: string,
  opts?: RenderPdfOptions,
): Promise<Uint8Array> {
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  page.setDefaultTimeout(timeout);

  // Inlined CSS/fonts → no external requests, so "load" is sufficient (and is
  // the only network-lifecycle setContent accepts; networkidle is goto-only).
  await page.setContent(html, { waitUntil: "load", timeout });
  // Wait for web fonts to settle so the ₹ glyph / metrics are final before print.
  await page.evaluateHandle("document.fonts.ready");

  return page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: opts?.headerHtml ?? buildHeaderHtml(),
    footerTemplate: opts?.footerHtml ?? buildFooterHtml(),
    // Reserve the running-header/footer band (matches print.css @page margin).
    margin: { top: "18mm", bottom: "16mm", left: "14mm", right: "14mm" },
    timeout,
  });
}
