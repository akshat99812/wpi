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
  shearAlpha: number;
  weibull: { A: number; k: number } | null;
  indiaPercentile: number | null;
  siteClass: SiteClass;
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
  terrain: {
    elevMean: number;
    elevMin: number;
    elevMax: number;
    slopeMeanDeg: number;
    slopeSteep10Deg: number;
  } | null;
  sizing: { capacityMw: number; energyGwh: number; assumptions: string[] };
}

export interface ScoreComponent {
  key: "resource" | "cf" | "grid" | "terrain";
  weight: number;
  raw: number | null;
  normalized: number;
  points: number;
}

export interface AnalysisScore {
  value: number;
  confidence: Confidence;
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

/** Machine-readable 400 body from the route. */
export interface AnalysisErrorBody {
  error: string;
  code?: string;
}
