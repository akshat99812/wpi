/**
 * Wind Site Analysis — single home for every pinned constant.
 *
 * Data-source facts (layer names, units, zoom) were verified by the Phase 0
 * probes and are recorded with evidence in ./VERIFIED.md. Do not change them
 * without re-running the probes in apps/api/scripts/probes/.
 */

/** Bump on ANY algorithm change — keys the result cache and the response.
 *  10.1.0: Phase 2 sections went live (validation/grid/context + flag-gated
 *  climate); score now receives real grid + terrain inputs. */
export const ANALYSIS_VERSION = "10.1.0";

/**
 * Sampling zoom for all GWA raster layers. Verified: z9 gives only 256 valid
 * pixels for a 5×5 km AOI (< 300 required); z10 gives 1089. z10 is also the
 * exact maxzoom of every wind/CF/pd/rix layer — never request above it.
 */
export const ANALYSIS_ZOOM = 10;

/** GWA TiTiler (same instance build_wind_atlas.py bakes from). */
export const GWA_TILER_BASE = "https://tiles-stag.ramtt.xyz/titiler/gwa4";

/** Verified GWA layer names (VERIFIED.md §1). Units in comments. */
export const GWA_LAYERS = {
  cfIec3: "cf_iec3", // capacity factor, fraction 0–1 (clamp ≥0: tiny negatives exist)
  cfIec2: "cf_iec2", // capacity factor, fraction 0–1
  ws50: "ws_mean_hgt50m", // m/s
  ws100: "ws_mean_hgt100m", // m/s
  ws150: "ws_mean_hgt150m", // m/s
  pd100: "pd_mean_hgt100m", // W/m²
  rix: "rix", // ruggedness fraction; nodata over flat terrain ⇒ treat NaN as 0
  elevation: "elevation", // m ASL
} as const;

export type GwaLayer = (typeof GWA_LAYERS)[keyof typeof GWA_LAYERS];

/** AOI validation caps (plan §2.7). */
export const AOI_MAX_KM2 = 2_500;
export const AOI_MIN_KM2 = 1;
export const AOI_MAX_VERTICES = 100;

/** India bbox — matches the wind-atlas bake extent. [W, S, E, N]. */
export const INDIA_BBOX = [67.0, 6.0, 98.0, 38.0] as const;

/** Point mode: a click becomes this square, built client- AND server-side. */
export const POINT_MODE_SQUARE_KM = 5;

/** Wall-clock budget for the whole response (plan §2.8). */
export const ANALYSIS_BUDGET_MS = 15_000;

/** Per-fetch timeout for one GWA tile. */
export const GWA_TILE_TIMEOUT_MS = 8_000;

/**
 * Result-cache geometry canonicalization: coordinates are rounded to this
 * many decimals before hashing (≈11 cm) so draw-tool float jitter can never
 * defeat the cache (plan hard rule).
 */
export const GEOMETRY_HASH_DECIMALS = 6;

/** Sizing assumptions (plan §2.5) — must be echoed in every response. */
export const SIZING_MW_PER_KM2 = 5;
export const SIZING_USABLE_LAND_FRACTION = 0.7;
export const SIZING_ASSUMPTIONS = [
  "5 MW/km² density",
  "0.7 usable-land fraction",
  "IEC-III capacity factor",
  "existing wind-farm area excluded",
] as const;

/** Score weights (plan §2.6). Validation confidence NEVER feeds the score. */
export const SCORE_WEIGHTS = {
  resource: 45,
  cf: 25,
  grid: 20,
  terrain: 10,
} as const;

/** Mast-validation distance rules in km (plan §2.3). */
export const MAST_DELTA_MAX_KM = 25;
export const MAST_CONFIDENCE_HIGH_KM = 20;
export const MAST_CONFIDENCE_HIGH_COUNT = 2;

/** Site-class banding on AOI mean speed @100 m (plan §3 contract). */
export const SITE_CLASS_BANDS = {
  excellent: 8,
  good: 7,
  moderate: 6,
} as const;

/**
 * Local Weibull COG files (GWA combined Weibull A/k @100 m, CC-BY 4.0),
 * downloaded once by scripts/fetch-weibull-cogs.ts — see VERIFIED.md §2.
 * Reads degrade to nulls when the files are absent.
 */
export const WEIBULL_COG_DIR = "data/gwa";
export const WEIBULL_A_FILE = "IND_combined-Weibull-A_100m.tif";
export const WEIBULL_K_FILE = "IND_combined-Weibull-k_100m.tif";

/** Climate section feature flag (VERIFIED.md §3: no commercial key yet). */
export const CLIMATE_SECTION_ENABLED =
  process.env.CLIMATE_SECTION_ENABLED === "true";
