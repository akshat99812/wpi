/**
 * Site-Analysis PDF Export — Puppeteer print step (plan §5.2/§5.3).
 *
 * Operates on a Page acquired from browserPool.withPage (never launches its own
 * browser — decision D5). setContent(html) → document.fonts.ready → page.pdf
 * with A4 + printBackground + native running header/footer. Caller closes the
 * page in `finally`.
 *
 * SCAFFOLD (PR0): stub — implemented in PR10.
 */

import type { Page } from "puppeteer";

export interface RenderPdfOptions {
  /** Chromium header/footer are isolated docs — pass full inline-styled HTML. */
  headerHtml?: string;
  footerHtml?: string;
}

export async function renderPdf(
  _page: Page,
  _html: string,
  _opts?: RenderPdfOptions,
): Promise<Uint8Array> {
  throw new Error("renderPdf: not implemented (PR10)");
}
