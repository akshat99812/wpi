/**
 * Shared formatters for the print template (plan §3.2). Pure string helpers —
 * the pages stay dumb and consistent. The null discipline (decision D4) lives
 * here: a null engine value renders the explicit token, NEVER 0.
 *
 *  - `na(x, fmt)` → "N/A" when the value is absent (resource section missing).
 *  - `dash(x, fmt)` → "—" when a value exists upstream but is null (e.g. irr()
 *    found no sign change) — distinct from a whole section being unavailable.
 */

/** Section-unavailable token (D4): a missing resource never shows as 0. */
export const NA = "N/A";
/** Value-null token: a computed field that legitimately has no value. */
export const DASH = "—";

export function na<T>(
  x: T | null | undefined,
  fmt: (v: T) => string,
): string {
  return x == null ? NA : fmt(x);
}

export function dash<T>(
  x: T | null | undefined,
  fmt: (v: T) => string,
): string {
  return x == null ? DASH : fmt(x);
}

/** Fraction → percent string (0.434 → "43.4%"). */
export const pct = (x: number, digits = 1): string =>
  `${(x * 100).toFixed(digits)}%`;

/** Fraction → percent, "—" when null (mirrors the live FinancialsBlock). */
export const pctOrDash = (x: number | null | undefined, digits = 1): string =>
  x == null ? DASH : pct(x, digits);

/** ₹ amount, fixed decimals. */
export const inr = (x: number, digits = 2): string => `₹${x.toFixed(digits)}`;

/** ₹ rate per kWh. */
export const inrKwh = (x: number, digits = 2): string =>
  `₹${x.toFixed(digits)}/kWh`;

/** ₹ Crore. */
export const inrCr = (x: number, digits = 2): string =>
  `₹${x.toFixed(digits)} Cr`;

export const km = (x: number, digits = 1): string => `${x.toFixed(digits)} km`;

export const ms = (x: number, digits = 2): string => `${x.toFixed(digits)} m/s`;

/** Thousands-separated integer. */
export const int = (x: number): string => Math.round(x).toLocaleString("en-IN");

/**
 * Area fraction → percent, keeping one decimal for slivers (<1%) so a real but
 * small exclusion never rounds to a misleading "0%" (mirrors live areaPct).
 */
export function areaPct(frac: number): string {
  const p = frac * 100;
  if (p <= 0) return "0%";
  if (p < 1) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

/** [lon, lat] centroid → "10.0500° N, 78.0500° E" (India → always N/E). */
export function formatCoords(centroid: readonly [number, number]): string {
  const [lon, lat] = centroid;
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** ISO timestamp → "23 June 2026, 00:00 UTC" (deterministic, UTC). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
  return `${date}, ${time} UTC`;
}

/** ISO date (YYYY-MM-DD) → "23 June 2026"; passes through other strings. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
