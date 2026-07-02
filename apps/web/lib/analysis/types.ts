/**
 * Client mirror of the /api/analyze response contract.
 *
 * KEEP IN SYNC with apps/api/src/services/analysis/types.ts (the server file
 * is the source of truth; plan.md §3 is the spec). Mirrored rather than
 * imported because the apps don't share a package — if the shapes drift the
 * results panel breaks loudly in dev, which is the alarm we want.
 */

export type SectionStatus = "ok" | "unavailable";

export interface Section<T> {
  status: SectionStatus;
  data: T | null;
}

export type SiteClass = "excellent" | "good" | "moderate" | "marginal";
export type Confidence = "high" | "medium" | "low";

/** Per-hub-height wind readouts (50/100/150 m) from GWA; drives the AOI height
 *  dropdown. The 100 m entry equals the top-level ResourceData speed/power. */
export interface HeightResource {
  heightM: number;
  meanSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  p25Speed: number;
  p50Speed: number;
  p75Speed: number;
  areaExceedance90: number;
  powerDensity: number | null;
  powerDensityRaw: number | null;
}

export interface ResourceData {
  meanSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  p25Speed: number;
  p50Speed: number;
  p75Speed: number;
  /** "90% of site area exceeds X m/s" — rendered as a stat line only. */
  areaExceedance90: number;
  /** Air-density corrected W/m²; null when the layer was empty in-AOI. */
  powerDensity: number | null;
  powerDensityRaw: number | null;
  airDensity: number;
  /** null when the CF layer was entirely empty in-AOI. */
  cfIec3: number | null;
  cfIec2: number | null;
  /** Power-curve CF (shadow) from the AOI Weibull + air density, per IEC class. */
  cfPowerCurve: { iec1: number; iec2: number; iec3: number } | null;
  /** Net CF (shadow): gross·(1−wake)·Π(1−lossᵢ) off IEC-III + loss waterfall. */
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
  /** P50/P75/P90 exceedance of the net CF + combined relative σ (shadow). */
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
  /** Wind speed + power density at 50/100/150 m; null when unavailable (the
   *  top-level fields always carry the 100 m values). */
  heights: HeightResource[] | null;
}

export interface ClimateRoseSector {
  sector: string;
  freqPct: number;
  meanSpeed: number;
}

export interface ClimateData {
  rose: ClimateRoseSector[];
  monthly: number[];
  diurnal: number[];
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
  modelDeltaPct: number | null;
  confidence: Confidence;
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
  /** Individual physical wind turbines standing inside the AOI; null when DB down. */
  turbines: { count: number; ratedMw: number | null; ratedCount: number } | null;
  /** Exclusion-zone coverage of the AOI broken down by kind; null when DB down. */
  exclusions: {
    redFraction: number;
    amberFraction: number;
    categories: { layerCode: string; cls: "red" | "amber"; fraction: number; km2: number }[];
  } | null;
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
    usableKm2: number;
    developableFraction: number;
    excludedFraction: number | null;
    steepFraction: number | null;
  };
}

/** Methodology §A rating band derived from the headline value. */
export type ScoreRating = "Excellent" | "Good" | "Moderate" | "Marginal" | "Poor";

export interface ScoreComponent {
  /** Methodology PART A is resource-weighted 72/28 — two components only. */
  key: "resource" | "grid";
  weight: number;
  /** resource: the CUF the score anchored to; grid: the grid sub-score. */
  raw: number | null;
  normalized: number;
  points: number;
}

export interface AnalysisScore {
  value: number;
  /** §A3 rating band derived from `value`. */
  rating: ScoreRating;
  /** Shared capacity factor (windCuf) the score anchored to; null when ws missing. */
  cuf: number | null;
  confidence: Confidence;
  components: ScoreComponent[];
}

/** Methodology PART B (per 1 MW). Mirrors apps/api windFinance.ts. */
export interface WindFinancials {
  irr: number | null; // equity IRR (headline), fraction
  projIrr: number | null;
  payback: number | null; // years
  npvCr: number; // ₹ Cr/MW at 10%
  lcoe: number | null; // ₹/kWh
  annualMwh: number;
  effTariff: number; // ₹/kWh
}

/** §B5 Monte-Carlo equity-IRR band (fractions). */
export interface IrrBand {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  n: number;
}

export interface AnalysisResponse {
  analysisVersion: string;
  aoi: { areaKm2: number; centroid: [number, number]; isPointMode: boolean };
  score: AnalysisScore;
  /** PART B financials; null when the wind speed was unavailable. */
  financials: WindFinancials | null;
  /** §B5 Monte-Carlo IRR band; null when ws unavailable. */
  irrBand: IrrBand | null;
  sections: {
    resource: Section<ResourceData>;
    climate: Section<ClimateData>;
    validation: Section<ValidationData>;
    grid: Section<GridData>;
    context: Section<ContextData>;
  };
}

/** Machine-readable 400 body from the route. */
export interface AnalysisErrorBody {
  error: string;
  code?: string;
}

// ── Exact-point report (per-turbine click in a micro-sited layout) ──────────
// Mirrors apps/api/src/services/analysis/point.ts (POST /api/analyze/point).

/** Per-hub-height point readout (single pixel): ws + power density. */
export interface PointHeightResource {
  heightM: number;
  meanSpeed: number;
  powerDensity: number | null;
  powerDensityRaw: number | null;
}

export interface PointResourceData {
  /** Mean wind speed @100 m (m/s) at the exact point. */
  meanSpeed: number;
  ws50: number | null;
  ws150: number | null;
  shearAlpha: number | null;
  cfIec3: number | null;
  cfIec2: number | null;
  powerDensity: number | null;
  powerDensityRaw: number | null;
  airDensity: number | null;
  elevationM: number | null;
  /** ws + power density at 50/100/150 m for the dropdown; 100 m entry equals
   *  the top-level meanSpeed/powerDensity. */
  heights: PointHeightResource[];
}

export interface PointExclusionHit {
  layerCode: string;
  cls: "red" | "amber";
}

export interface PointExclusion {
  inExclusion: boolean;
  hardHit: boolean;
  hits: PointExclusionHit[];
}

export interface PointReport {
  point: { lon: number; lat: number };
  resource: PointResourceData | null;
  validation: {
    nearestMast: ValidationData["nearestMast"];
    modelDeltaPct: number | null;
  } | null;
  grid: GridData | null;
  exclusion: PointExclusion | null;
}
