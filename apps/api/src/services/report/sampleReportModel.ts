/**
 * Deterministic sample ReportModels (plan §8 four-fixture matrix) — the single
 * source of fixture data shared by the /preview route (PR8) and the template
 * tests. Built from the REAL engine (screenWind + toAnalysisScore) so the
 * figures line up with a genuine analyze response; the I/O-bound pieces
 * (policy, nearby-site) are hand-authored sample values.
 *
 * This is SAMPLE data for layout iteration only — it never touches the DB or
 * GWA tiles, so /preview renders in milliseconds. The map images are left null
 * (the template renders the missing-image placeholder).
 */

import type { Cell } from "../policy/compute";
import type { PolicyContext } from "../analysis/policyContext";
import type { NearbySiteResult } from "../analysis/nearbySite";
import { screenWind } from "../analysis/screenWind";
import type {
  AnalysisResponse,
  ContextData,
  GridData,
  ResourceData,
  ValidationData,
} from "../analysis/types";
import { toAnalysisScore } from "../analysis/windScoring";
import {
  buildReportModel,
  type ReportAoi,
  type ReportModel,
} from "./reportModel";

/** The four layout/QA fixtures (plan §8). */
export type SampleFixture =
  | "high-wind"
  | "null-resource"
  | "multi-state"
  | "no-nearby";

export const SAMPLE_FIXTURES: readonly SampleFixture[] = [
  "high-wind",
  "null-resource",
  "multi-state",
  "no-nearby",
] as const;

export function isSampleFixture(s: string): s is SampleFixture {
  return (SAMPLE_FIXTURES as readonly string[]).includes(s);
}

const AOI: ReportAoi = {
  ring: [
    [78.0, 10.0],
    [78.1, 10.0],
    [78.1, 10.1],
    [78.0, 10.1],
    [78.0, 10.0],
  ],
  bbox: [78.0, 10.0, 78.1, 10.1],
  centroid: [78.05, 10.05],
  areaKm2: 25,
  isPointMode: false,
};

const RESOURCE: ResourceData = {
  meanSpeed: 7.2,
  minSpeed: 6.4,
  maxSpeed: 7.9,
  p25Speed: 7.0,
  p50Speed: 7.2,
  p75Speed: 7.4,
  areaExceedance90: 6.8,
  powerDensity: 420,
  powerDensityRaw: 440,
  airDensity: 1.16,
  cfIec3: 0.434,
  cfIec2: 0.39,
  cfPowerCurve: null,
  cfNet: null,
  cfExceedance: null,
  shearAlpha: 0.16,
  weibull: { A: 8.1, k: 2.2 },
  indiaPercentile: 88,
  siteClass: "good",
  heights: [
    {
      heightM: 50,
      meanSpeed: 6.4,
      minSpeed: 5.7,
      maxSpeed: 7.0,
      p25Speed: 6.2,
      p50Speed: 6.4,
      p75Speed: 6.6,
      areaExceedance90: 6.0,
      powerDensity: 300,
      powerDensityRaw: 314,
    },
    {
      heightM: 100,
      meanSpeed: 7.2,
      minSpeed: 6.4,
      maxSpeed: 7.9,
      p25Speed: 7.0,
      p50Speed: 7.2,
      p75Speed: 7.4,
      areaExceedance90: 6.8,
      powerDensity: 420,
      powerDensityRaw: 440,
    },
    {
      heightM: 150,
      meanSpeed: 7.8,
      minSpeed: 6.9,
      maxSpeed: 8.5,
      p25Speed: 7.6,
      p50Speed: 7.8,
      p75Speed: 8.0,
      areaExceedance90: 7.4,
      powerDensity: 520,
      powerDensityRaw: 545,
    },
  ],
};

const GRID: GridData = {
  nearestSubstation: { name: "Tirunelveli SS", voltageKv: 220, distanceKm: 4.2 },
  nearestLine: { voltageKv: 132, distanceKm: 2.1 },
  ehvWithin25Km: true,
  dataNote: "Nearest features from OpenStreetMap power layer.",
};

const CONTEXT: ContextData = {
  states: [{ name: "Tamil Nadu", installedMw: 10000, potentialMw: 33000 }],
  windfarms: { count: 2, overlapFraction: 0.1 },
  turbines: { count: 12, ratedMw: 24, ratedCount: 10 },
  exclusions: {
    redFraction: 0.05,
    amberFraction: 0.02,
    categories: [
      { layerCode: "eco_wls", cls: "red", fraction: 0.05, km2: 1.25 },
    ],
  },
  terrain: {
    elevMean: 300,
    elevMin: 250,
    elevMax: 350,
    slopeMeanDeg: 3,
    slopeSteep10Deg: 2,
  },
  sizing: {
    capacityMw: 50,
    energyGwh: 130,
    assumptions: ["~0.3 MW/km² packing density"],
    usableKm2: 18,
    developableFraction: 0.72,
    excludedFraction: 0.05,
    steepFraction: 0.02,
  },
};

const VALIDATION: ValidationData = {
  mastCountInAoi: 1,
  nearestMast: {
    station: "Radhapuram",
    distanceKm: 5.0,
    maws: 7.0,
    mawpd: null,
    heightM: 100,
    id: "m1",
  },
  modelDeltaPct: 3.2,
  confidence: "high",
};

const cell = (display: string, source: string, year: number): Cell => ({
  value: display,
  display,
  raw: display,
  source,
  source_url: null,
  policy_year: year,
  confidence: "high",
});

const DIMENSIONS = [
  {
    key: "ppa_floor",
    label: "PPA floor",
    category: "pricing",
    value_type: "numeric" as const,
    unit: "₹/kWh",
    description: null,
  },
  {
    key: "open_access",
    label: "Open access allowed",
    category: "open_access",
    value_type: "boolean" as const,
    unit: null,
    description: null,
  },
  {
    key: "wheeling",
    label: "Wheeling charge",
    category: "charges",
    value_type: "numeric" as const,
    unit: "₹/kWh",
    description: null,
  },
  {
    key: "banking",
    label: "Banking allowed",
    category: "banking",
    value_type: "boolean" as const,
    unit: null,
    description: null,
  },
];

function policyFor(stateCodes: string[]): PolicyContext {
  const codes = ["national", ...stateCodes];
  return {
    asOf: "2025-03-01",
    stateCodes,
    compare: {
      mode: "plain",
      year: null,
      jurisdictions: codes,
      dimensions: DIMENSIONS,
      matrix: {
        ppa_floor: {
          national: cell("₹3.00/kWh", "CERC RE Tariff 2024", 2024),
          TN: cell("₹2.90/kWh", "TNERC Order", 2023),
          KA: cell("₹3.10/kWh", "KERC Order", 2023),
        },
        open_access: {
          national: cell("Yes", "Electricity Act", 2022),
          TN: cell("Yes", "TNERC OA Regs", 2023),
          KA: cell("Yes", "KERC OA Regs", 2022),
        },
        wheeling: {
          TN: cell("₹0.40/kWh", "TNERC", 2023),
          KA: cell("₹0.55/kWh", "KERC", 2023),
        },
        banking: {
          national: cell("Yes", "MoP", 2022),
          TN: cell("Monthly", "TNERC", 2023),
          KA: cell("Annual", "KERC", 2022),
        },
      },
    },
  };
}

const NEARBY_FOUND: NearbySiteResult = {
  found: true,
  candidate: {
    lat: 10.1,
    lon: 78.1,
    distanceKm: 7.5,
    ws: 7.8,
    cuf: 0.46,
    score: 80,
    lineKm: 2,
    subKm: 4,
    equityIrr: 0.25,
    npvCr: 3.5,
    paybackYr: 5,
  },
  deltas: { score: 6, ws: 0.6, cuf: 0.02, equityIrr: 0.02 },
};

const NEARBY_NONE: NearbySiteResult = {
  found: false,
  reason: "no higher-scoring site within 10 km",
};

function sampleAnalysis(ws: number | null, rich: boolean): AnalysisResponse {
  const s = screenWind(ws, 2.1, 4.2);
  return {
    analysisVersion: "11.0.0",
    aoi: { areaKm2: 25, centroid: [78.05, 10.05], isPointMode: false },
    score: toAnalysisScore(s.score, "high"),
    financials: s.financials,
    irrBand: s.irrBand,
    sections: {
      resource: {
        status: ws === null ? "unavailable" : "ok",
        data: ws === null ? null : RESOURCE,
      },
      climate: { status: "unavailable", data: null },
      validation: {
        status: rich ? "ok" : "unavailable",
        data: rich ? VALIDATION : null,
      },
      grid: { status: rich ? "ok" : "unavailable", data: rich ? GRID : null },
      context: {
        status: rich ? "ok" : "unavailable",
        data: rich ? CONTEXT : null,
      },
    },
  };
}

interface FixtureSpec {
  ws: number | null;
  rich: boolean;
  states: string[] | null;
  nearby: NearbySiteResult | null;
}

const SPECS: Record<SampleFixture, FixtureSpec> = {
  "high-wind": { ws: 7.2, rich: true, states: ["TN"], nearby: NEARBY_FOUND },
  "null-resource": { ws: null, rich: false, states: null, nearby: null },
  "multi-state": {
    ws: 7.2,
    rich: true,
    states: ["TN", "KA"],
    nearby: NEARBY_FOUND,
  },
  "no-nearby": { ws: 7.2, rich: true, states: ["TN"], nearby: NEARBY_NONE },
};

/** Build the sample ReportModel for a fixture (default: high-wind). */
export function sampleReportModel(
  fixture: SampleFixture = "high-wind",
): ReportModel {
  const spec = SPECS[fixture];
  return buildReportModel({
    analysis: sampleAnalysis(spec.ws, spec.rich),
    aoi: AOI,
    mapImages: { street: null, terrain: null, threeD: null },
    generatedAt: "2026-06-23T00:00:00.000Z",
    policy: spec.states ? policyFor(spec.states) : null,
    nearbySite: spec.nearby,
  });
}
