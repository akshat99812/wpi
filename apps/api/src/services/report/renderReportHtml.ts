/**
 * Site-Analysis PDF Export — SSR the report to a self-contained HTML string
 * (plan §3.5). `renderToStaticMarkup(<SiteReport model={model}/>)` wrapped in a
 * full HTML doc with the inlined print <style>, so Chromium needs ZERO network
 * (fast, reproducible, container-friendly). This is also what the /preview
 * route (PR8) serves for fast layout iteration.
 *
 * Fonts: the page CSS uses a 'Brand' → system fallback stack. Embedding the
 * brand woff2 (base64, with the ₹ glyph) is deferred to the container/asset
 * step (PR14); the system stack already carries ₹ and Indic glyphs, so the
 * report renders correctly today without a network font.
 *
 * Uses createElement (not JSX) so this stays a plain .ts entrypoint; the JSX
 * lives in the .tsx template + page components.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { formatCoords } from "./templates/format";
import { BRAND } from "./templates/brand";
import { PRINT_CSS } from "./templates/print.css";
import { SiteReport } from "./templates/SiteReport";
import type { ReportModel } from "./reportModel";

/** Escape a string for safe interpolation into the HTML <title>. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderReportHtml(model: ReportModel): string {
  const body = renderToStaticMarkup(createElement(SiteReport, { model }));
  const title = escapeHtml(
    `${BRAND.product} — ${BRAND.reportTitle} · ${formatCoords(model.aoi.centroid)}`,
  );
  return (
    `<!doctype html>` +
    `<html lang="en">` +
    `<head>` +
    `<meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${title}</title>` +
    `<style>${PRINT_CSS}</style>` +
    `</head>` +
    `<body>${body}</body>` +
    `</html>`
  );
}
