/**
 * Site-Analysis PDF Export — SSR the report to a self-contained HTML string
 * (plan §3.5). `renderToStaticMarkup(<SiteReport model={model}/>)` wrapped in a
 * full HTML doc with inlined <style> and base64-embedded fonts, so Chromium needs
 * ZERO network (fast, reproducible, container-friendly). This is also what the
 * /preview route (PR8) serves for fast layout iteration.
 *
 * SCAFFOLD (PR0): stub. Templates + charts land in PR6/PR7; React 19 SSR via
 * react-dom/server was smoke-tested under Bun in PR0.
 */

import type { ReportModel } from "./reportModel";

export function renderReportHtml(_model: ReportModel): string {
  throw new Error("renderReportHtml: not implemented (PR7)");
}
