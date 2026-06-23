/**
 * Static report content (plan §3.2 / D4 senior note: "policy is content, not
 * computation" — the same applies to brand, contact, disclaimer, methodology).
 *
 * DRY: these strings mirror the live results panel
 * (apps/web/components/Map/components/AnalysisResults.tsx — ReportDisclaimer,
 * FINANCE_METHODOLOGY, COMPONENT_METHOD). Keep both in sync if either moves;
 * the report is the canonical client-facing artifact.
 */

export const BRAND = {
  product: "WindPower India",
  reportTitle: "Wind Site Screening Report",
  tagline: "Early-stage wind site screening for India",
} as const;

/** CECL advisory contact (mirrors live ReportDisclaimer). */
export const CONTACT = {
  shortName: "CECL Advisory",
  legalName: "Consolidated Energy Consultants Limited",
  emails: ["info@cecl.in", "conenergy@gmail.com"],
  phones: ["+91-0755-2600241", "+91-0755-4058931"],
  office:
    "‘Energy Tower’, 64-B Sector, Kasturba Nagar, Bhopal 462023, Madhya Pradesh, India",
} as const;

/** The "this is screening, not bankable" disclaimer (mirrors live copy). */
export const DISCLAIMER =
  "Screening estimate for early-stage site comparison only — not a bankable " +
  "energy assessment. Figures are indicative and derived from public datasets " +
  "and placeholder commercial assumptions. Contact CECL for bankable reports.";

/** Plain-language summary of the PART B finance model (mirrors live FINANCE_METHODOLOGY). */
export const FINANCE_METHODOLOGY: readonly string[] = [
  "Levered project-finance pro-forma per 1 MW, CERC RE Tariff 2024 norms.",
  "Effective tariff = PPA floor + REC + TOD/merchant + carbon — the adders are what lift IRR above a bare PPA.",
  "75:25 debt:equity · 9.5% loan (15 yr) · 4.67%/yr depreciation (cap 90%) · MAT 17.47% → corporate 34.94% at year 20 · 8,766 h/yr.",
  "Equity IRR = levered post-tax return (headline); Project IRR = unlevered. Payback = first year cumulative equity cashflow ≥ 0.",
  "LCOE = (capex + discounted O&M) ÷ discounted energy — cost-side only, so it will not reconcile against the IRR.",
  "P10–P90 band = 4,000-run Monte Carlo over the published market spread (CAPEX/PPA/REC/TOD/CUF), not site-specific edits.",
] as const;

/** Per-factor scoring breakpoints (mirrors live COMPONENT_METHOD). */
export const SCORE_METHODOLOGY: readonly {
  label: string;
  weight: number;
  text: string;
}[] = [
  {
    label: "Wind resource (CUF)",
    weight: 72,
    text: "Capacity factor from @100 m wind speed (modern 120–140 m hub), scored via the anchor table — 0.34 CUF earns 0.42, rising to full credit at 0.46 CUF.",
  },
  {
    label: "Grid access",
    weight: 28,
    text: "Line + substation distance — line full ≤2 km (0 at 40 km), substation full ≤5 km (0 at 80 km), blended 60/40. A missing distance scores 0.15.",
  },
] as const;

export const SCORE_INTRO =
  "A 0–100 screening score. Each factor is scored 0–1 on a linear ramp between " +
  "its breakpoints, multiplied by its weight, then summed. Breakpoints are " +
  "calibrated to India's wind distribution, so the windiest ~2% of sites " +
  "approach a full resource score. The confidence chip reflects met-mast " +
  "validation only and never affects the score.";

/** Data-source / attribution lines for page 6 (provenance the report rests on). */
export const DATA_SOURCES: readonly string[] = [
  "Wind resource: Global Wind Atlas (GWA 3.0) @100 m, air-density corrected.",
  "Grid & infrastructure: OpenStreetMap power features; substation/line distances are nearest-feature estimates.",
  "Legal exclusions & jurisdictions: WCE geodatabase (gazette / official GIS / open-data tiers; see live source registry).",
  "Policy values: WCE policy-comparison dataset — every cell is individually sourced and dated (see per-cell citations).",
  "Map imagery: rendered from the application's configured basemap/terrain provider; retain provider attribution on redistribution.",
];
