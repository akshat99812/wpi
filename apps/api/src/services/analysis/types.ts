/**
 * Wind Site Analysis — shared types.
 *
 * The Response* types ARE the public API contract from plan.md §3 — change
 * them only together with ANALYSIS_VERSION. Internal raster types model one
 * stitched float32 patch per GWA layer covering the AOI's tile cover.
 */

// ── GeoJSON (the slice we accept) ───────────────────────────────────────────

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][]; // [ring][vertex][lon, lat] — outer ring only used
}

// ── Internal raster model ───────────────────────────────────────────────────

/**
 * A stitched mosaic of web-mercator tiles for ONE layer at ANALYSIS_ZOOM,
 * covering the AOI bbox. Row-major, row 0 = north. Nodata = NaN.
 */
export interface LayerPatch {
  zoom: number;
  /** Tile-space origin of the patch (top-left tile of the cover). */
  minTileX: number;
  minTileY: number;
  /** Patch size in pixels (tilesX·256 × tilesY·256). */
  widthPx: number;
  heightPx: number;
  data: Float32Array;
}

/**
 * AOI pixel mask over a patch's pixel grid: 1 = pixel center inside the
 * polygon. Same dimensions/order as LayerPatch.data.
 */
export interface AoiMask {
  widthPx: number;
  heightPx: number;
  inside: Uint8Array;
  /** Number of 1s — precomputed because every consumer needs it. */
  insideCount: number;
}

/** Result of validating + normalizing the request geometry. */
export interface ValidatedAoi {
  /** Closed outer ring, lon/lat, canonicalized to 6 decimals. */
  ring: [number, number][];
  areaKm2: number;
  centroid: [number, number]; // [lon, lat]
  bbox: [number, number, number, number]; // [W, S, E, N]
  isPointMode: boolean;
}

/** Machine-readable 400 codes (plan §3: errors carry a `code`). */
export type GeometryErrorCode =
  | "INVALID_GEOMETRY"
  | "TOO_MANY_VERTICES"
  | "AREA_TOO_LARGE"
  | "AREA_TOO_SMALL"
  | "OUT_OF_INDIA"
  | "SELF_INTERSECTING";

export class GeometryError extends Error {
  constructor(
    public readonly code: GeometryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeometryError";
  }
}

// ── Response contract (plan §3) ─────────────────────────────────────────────

export type SectionStatus = "ok" | "unavailable";

export interface Section<T> {
  status: SectionStatus;
  data: T | null;
}

export type SiteClass = "excellent" | "good" | "moderate" | "marginal";

export interface ResourceData {
  meanSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  p25Speed: number;
  p50Speed: number;
  p75Speed: number;
  /** "90% of site area exceeds X m/s" — 10th percentile of pixel speeds.
   *  Stat line only; never charted, never labelled with the forbidden term. */
  areaExceedance90: number;
  /** Air-density corrected, W/m²; null when pd100 is empty in-mask. */
  powerDensity: number | null;
  /** As served by GWA; null when pd100 is empty in-mask. */
  powerDensityRaw: number | null;
  airDensity: number; // kg/m³ used for the correction
  /** null when the CF layer is entirely empty in-mask. */
  cfIec3: number | null;
  cfIec2: number | null;
  /** CF-engine Phase B (shadow): power-curve CF from the AOI Weibull + air
   *  density, per representative IEC class. null when no Weibull distribution. */
  cfPowerCurve: { iec1: number; iec2: number; iec3: number } | null;
  /** CF-engine Phase C (shadow): net CF = gross·(1−wake)·Π(1−lossᵢ) off the
   *  IEC-III gross, with the loss waterfall. null when no power-curve CF. */
  cfNet: {
    grossCf: number;
    wakeLossFraction: number;
    otherLossFraction: number;
    lossBuckets: {
      availability: number;
      electrical: number;
      soiling: number;
      curtailment: number;
    };
    netCf: number;
  } | null;
  /** CF-engine Phase D (shadow): P50/P75/P90 exceedance of the net CF + the
   *  combined relative σ. null when no net CF. */
  cfExceedance: {
    p50: number;
    p75: number;
    p90: number;
    sigmaTotal: number;
  } | null;
  shearAlpha: number;
  weibull: { A: number; k: number } | null;
  indiaPercentile: number | null;
  siteClass: SiteClass;
}

export interface ClimateRoseSector {
  sector: string; // "N" | "NNE" | ... 16-wind compass
  freqPct: number;
  meanSpeed: number;
}

export interface ClimateData {
  rose: ClimateRoseSector[]; // 16
  monthly: number[]; // 12 mean speeds
  diurnal: number[]; // 24 mean speeds
}

export interface ValidationData {
  mastCountInAoi: number;
  nearestMast: {
    station: string;
    distanceKm: number;
    maws: number;
    mawpd: number | null;
    heightM: number;
    id: string;
  } | null;
  modelDeltaPct: number | null; // null when nearest mast > 25 km
  confidence: "high" | "medium" | "low";
}

export interface GridData {
  nearestSubstation: {
    name: string | null;
    voltageKv: number | null;
    distanceKm: number;
  } | null;
  nearestLine: { voltageKv: number | null; distanceKm: number } | null;
  ehvWithin25Km: boolean;
  dataNote: string;
}

export interface ContextData {
  states: { name: string; installedMw: number | null; potentialMw: number | null }[];
  windfarms: { count: number; overlapFraction: number };
  terrain: {
    elevMean: number;
    elevMin: number;
    elevMax: number;
    slopeMeanDeg: number;
    slopeSteep10Deg: number;
  } | null;
  sizing: {
    capacityMw: number;
    energyGwh: number;
    assumptions: string[];
    /** Buildable area after exclusions + slope + packing + existing farms (km²). */
    usableKm2: number;
    /** Applied developable fraction (0..1): (1−excl)·(1−steep)·packing. */
    developableFraction: number;
    /** Hard (red) legal exclusions ∩ AOI ÷ AOI area; null when the DB is down. */
    excludedFraction: number | null;
    /** In-mask pixels steeper than the slope cutoff ÷ total; null if no slope. */
    steepFraction: number | null;
  };
}

export interface ScoreComponent {
  key: "resource" | "cf" | "grid" | "terrain";
  weight: number;
  raw: number | null;
  normalized: number;
  points: number;
}

export interface AnalysisScore {
  value: number; // 0–100
  /** Mirrors the mast badge; NEVER part of the arithmetic. */
  confidence: "high" | "medium" | "low";
  components: ScoreComponent[];
}

export interface AnalysisResponse {
  analysisVersion: string;
  aoi: { areaKm2: number; centroid: [number, number]; isPointMode: boolean };
  score: AnalysisScore;
  sections: {
    resource: Section<ResourceData>;
    climate: Section<ClimateData>;
    validation: Section<ValidationData>;
    grid: Section<GridData>;
    context: Section<ContextData>;
  };
}
