/**
 * Inlined print stylesheet (plan §3.4), exported as a string so renderReportHtml
 * can embed it in a self-contained <style> (zero network → reproducible,
 * container-friendly).
 *
 * The running logo header + page numbers are drawn by Puppeteer's NATIVE
 * header/footer (plan §5.3), NOT here — so top/bottom @page margin is reserved
 * for them and the page bodies never repeat them. Colours are forced on with
 * print-color-adjust so band fills survive the PDF print pipeline.
 */

export const PRINT_CSS = `
:root {
  --ink: #1f2937;
  --muted: #6b7280;
  --faint: #9ca3af;
  --line: #e5e7eb;
  --line-strong: #d1d5db;
  --accent: #1d4ed8;
  --accent-soft: #eff6ff;
  --paper: #ffffff;
  --card: #f9fafb;
  --excellent: #15803d;
  --good: #4d7c0f;
  --moderate: #b45309;
  --marginal: #b91c1c;
  --warn-bg: #fffbeb;
  --warn-ink: #92400e;
  --warn-line: #fcd34d;
}

@page { size: A4; margin: 18mm 14mm 16mm 14mm; }

* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Brand', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 10.5px;
  line-height: 1.45;
}

.page {
  break-after: page;
  page-break-after: always;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.page:last-child { break-after: auto; page-break-after: auto; }

.card, .figure, .stat, .contact, .colophon { break-inside: avoid; page-break-inside: avoid; }
/* Long tables (e.g. the policy matrix) may flow across pages, but never split a row. */
.tbl tr { break-inside: avoid; page-break-inside: avoid; }

/* Headings */
.page-kicker {
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
  margin: 0;
}
.page-title {
  font-size: 19px;
  font-weight: 700;
  margin: 1px 0 0;
  letter-spacing: -0.01em;
}
.h2 {
  font-size: 12px;
  font-weight: 700;
  margin: 2px 0 4px;
  color: var(--ink);
}
.subtle { color: var(--muted); }
.muted { color: var(--muted); font-size: 9.5px; }
.faint { color: var(--faint); }

/* Cards & grids */
.card {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--card);
  padding: 9px 11px;
}
.card-title {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 700;
  margin: 0 0 6px;
}
.grid { display: grid; gap: 7px; }
.grid-2 { grid-template-columns: 1fr 1fr; }
.grid-3 { grid-template-columns: 1fr 1fr 1fr; }

.stat {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  padding: 6px 8px;
}
.stat-label {
  font-size: 8.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0;
}
.stat-value {
  font-size: 13px;
  font-weight: 600;
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
}
.stat-sub { font-size: 8.5px; color: var(--muted); margin: 1px 0 0; }

/* Badges */
.badge {
  display: inline-block;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 8.5px;
  font-weight: 600;
  color: var(--ink);
  background: var(--paper);
}
.badge--excellent { color: var(--excellent); border-color: var(--excellent); background: #f0fdf4; }
.badge--good { color: var(--good); border-color: var(--good); background: #f7fee7; }
.badge--moderate { color: var(--moderate); border-color: var(--moderate); background: #fffbeb; }
.badge--marginal { color: var(--marginal); border-color: var(--marginal); background: #fef2f2; }
.badge-row { display: flex; flex-wrap: wrap; gap: 5px; }

/* Figures & maps */
.figure {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  padding: 8px 10px;
}
.figure-cap { font-size: 8.5px; color: var(--muted); margin: 4px 0 0; }
.figure svg { max-width: 100%; height: auto; display: block; }

.map { border: 1px solid var(--line-strong); border-radius: 7px; overflow: hidden; background: var(--card); }
.map img { width: 100%; height: auto; display: block; }
.map-cap { font-size: 8px; color: var(--muted); padding: 3px 6px; }
.map-missing {
  display: flex; align-items: center; justify-content: center;
  min-height: 120px; color: var(--faint); font-size: 9px; font-style: italic;
}

/* Notes */
.note {
  border-left: 3px solid var(--line-strong);
  background: var(--card);
  padding: 6px 9px;
  border-radius: 0 6px 6px 0;
  font-size: 9px;
  color: var(--muted);
}
.note--warn {
  border-left-color: var(--warn-line);
  background: var(--warn-bg);
  color: var(--warn-ink);
}
.unavailable {
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  padding: 7px 10px;
  color: var(--muted);
  font-size: 9.5px;
}

/* Tables */
.tbl { width: 100%; border-collapse: collapse; font-size: 9px; }
.tbl th, .tbl td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
.tbl th { font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 700; }
.tbl td.num, .tbl th.num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl .cat-row td { background: var(--accent-soft); font-weight: 700; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); }

.pos { color: var(--excellent); }
.neg { color: var(--marginal); }
.src { font-size: 7.5px; color: var(--faint); }

/* Cover */
.cover-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--accent); padding-bottom: 8px; }
.cover-brand { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
.cover-brand small { display: block; font-size: 9px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
.cover-score { display: flex; align-items: center; gap: 14px; }
.score-num { font-size: 46px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; }
.score-num small { font-size: 12px; font-weight: 500; color: var(--muted); }
.lead { font-size: 11px; color: var(--ink); }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 9.5px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; font-weight: 600; }

/* Contact + colophon */
.contact { border: 1px solid var(--line); border-radius: 7px; background: var(--card); padding: 10px 12px; }
.contact dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 6px 0 0; font-size: 9px; }
.contact dt { color: var(--muted); }
.contact dd { margin: 0; }
.colophon { border-top: 1px solid var(--line); padding-top: 6px; }
.colophon dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; font-size: 8px; color: var(--muted); }
.colophon dd { margin: 0; font-family: ui-monospace, 'SF Mono', Menlo, monospace; word-break: break-all; }

ul.tight { margin: 3px 0 0; padding-left: 16px; }
ul.tight li { margin: 1px 0; }
`;
