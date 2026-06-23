/**
 * Site-Analysis PDF Export — module config & feature flag.
 *
 * Follows the repo convention (see analysis/constants.ts CLIMATE_SECTION_ENABLED):
 * flags are `process.env.* === "true"`, read at the consuming module. There is no
 * central config service. Default OFF for safe rollout (plan D6).
 */

/** Master kill-switch for the PDF-export endpoint. Default OFF. */
export const REPORT_PDF_ENABLED = process.env.REPORT_PDF_ENABLED === "true";

/**
 * Report layout/template version — stamped into ReportMetadata.reportVersion
 * (plan §2.1). Bump on any change to the page layout or figure set so an old
 * PDF is self-identifying ("the layout changed" vs "the engine changed").
 */
export const REPORT_VERSION = "0.1.0";

/**
 * Max concurrent Chromium pages the render pool will hand out (plan §5.1).
 * Env-configurable per box size; a positive integer, default 4. Backpressure
 * (bounded acquire wait → 503) protects the box rather than an unbounded queue.
 */
export const REPORT_BROWSER_POOL_SIZE = Math.max(
  1,
  Math.floor(Number(process.env.REPORT_BROWSER_POOL_SIZE)) || 4,
);

/**
 * Per-user export rate limit (plan §6.4): a heavy endpoint one user must not
 * monopolise. Distinct from the pool's 503 (the box is momentarily full) — this
 * is "you personally asked too often" → 429. Default 5 exports per hour.
 */
export const PDF_EXPORT_RATE_LIMIT = Math.max(
  1,
  Math.floor(Number(process.env.PDF_EXPORT_RATE_LIMIT)) || 5,
);
export const PDF_EXPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Hard cap per inbound map image (plan §6.1/§9.3): base64 data URLs are decoded
 * client-side maps, not arbitrary uploads. 8 MB each keeps a 3-image request
 * bounded without an unbounded-body DoS. No remote fetch (no-SSRF posture).
 */
export const REPORT_MAP_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
