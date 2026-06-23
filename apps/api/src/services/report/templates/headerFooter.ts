/**
 * Puppeteer running header/footer templates (plan §5.3).
 *
 * Chromium renders header/footer as ISOLATED documents that do NOT inherit the
 * page CSS and default to ~6px text — so every element carries an explicit
 * inline font-size, and the footer uses Chromium's magic `.pageNumber` /
 * `.totalPages` spans for native page numbering. Kept out of the page bodies
 * (which reserve top/bottom @page margin for these instead).
 */

import { BRAND } from "./brand";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WRAP =
  "font-size:8px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;" +
  "width:100%;padding:0 14mm;display:flex;justify-content:space-between;align-items:center;";

/** Running header: brand (left) + the site label / report title (right). */
export function buildHeaderHtml(opts?: { title?: string }): string {
  const right = esc(opts?.title ?? BRAND.reportTitle);
  return (
    `<div style="${WRAP}">` +
    `<span style="font-weight:700;color:#1f2937;">${esc(BRAND.product)}</span>` +
    `<span>${right}</span>` +
    `</div>`
  );
}

/** Running footer: the "not bankable" microcopy + native "Page X of Y". */
export function buildFooterHtml(opts?: { microcopy?: string }): string {
  const micro = esc(
    opts?.microcopy ?? "Screening report — not a bankable assessment",
  );
  return (
    `<div style="${WRAP}">` +
    `<span>${micro}</span>` +
    `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` +
    `</div>`
  );
}
