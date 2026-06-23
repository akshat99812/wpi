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
