/**
 * Shared scale + format helpers for the print SVG charts (plan §3.1).
 *
 * Pure and dependency-light — d3-scale for axes, plus a small palette tuned for
 * print (solid fills, print-color-adjust handled in the page CSS). No DOM.
 */

import { scaleLinear } from "d3-scale";

export { scaleLinear };

/** Print palette. Band colours match the engine's site-class semantics. */
export const PALETTE = {
  excellent: "#15803d",
  good: "#4d7c0f",
  moderate: "#b45309",
  marginal: "#b91c1c",
  ink: "#1f2937",
  muted: "#6b7280",
  grid: "#e5e7eb",
  axis: "#9ca3af",
  accent: "#1d4ed8",
  accentSoft: "#bfdbfe",
  bandFill: "#dbeafe",
  positive: "#15803d",
  negative: "#b91c1c",
} as const;

export const FONT =
  "'Brand', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** A 0–100 composite score → its band colour. */
export function scoreColor(score: number): string {
  if (score >= 75) return PALETTE.excellent;
  if (score >= 60) return PALETTE.good;
  if (score >= 45) return PALETTE.moderate;
  return PALETTE.marginal;
}

export const fmtPct = (x: number, digits = 1): string =>
  `${(x * 100).toFixed(digits)}%`;

export const fmtInr = (x: number, digits = 2): string => `₹${x.toFixed(digits)}`;

/** Clamp a value into [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
