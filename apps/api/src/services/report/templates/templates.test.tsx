/**
 * SSR content tests for the print template (plan §3.2/§3.5 acceptance): the
 * report renders to a self-contained HTML string with NO DOM/browser, the
 * null-resource path shows "N/A" (never 0, decision D4), and the policy /
 * nearby-site branches render from the model. Fixtures use the real engine so
 * figures line up with the analyze response.
 */

import { describe, expect, test } from "bun:test";

import type { Cell } from "../../policy/compute";
import type { PolicyContext } from "../../analysis/policyContext";
import type { NearbySiteResult } from "../../analysis/nearbySite";
import { screenWind } from "../../analysis/screenWind";
import type {
  AnalysisResponse,
  ContextData,
  GridData,
  ResourceData,
  ValidationData,
} from "../../analysis/types";
import { toAnalysisScore } from "../../analysis/windScoring";
import { renderReportHtml } from "../renderReportHtml";
import {
  buildReportModel,
  type BuildReportModelInput,
  type ReportAoi,
} from "../reportModel";

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

const POLICY: PolicyContext = {
  asOf: "2025-03-01",
  stateCodes: ["TN"],
  compare: {
    mode: "plain",
    year: null,
    jurisdictions: ["national", "TN"],
    dimensions: [
      {
        key: "ppa_floor",
        label: "PPA floor",
        category: "pricing",
        value_type: "numeric",
        unit: "₹/kWh",
        description: null,
      },
      {
        key: "open_access",
        label: "Open access allowed",
        category: "open_access",
        value_type: "boolean",
        unit: null,
        description: null,
      },
    ],
    matrix: {
      ppa_floor: {
        national: cell("₹3.00/kWh", "CERC RE Tariff 2024", 2024),
        TN: cell("₹2.90/kWh", "TNERC Order", 2023),
      },
      open_access: {
        national: cell("Yes", "Electricity Act", 2022),
        TN: cell("Yes", "TNERC OA Regs", 2023),
      },
    },
  },
};

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

function makeAnalysis(ws: number | null, rich: boolean): AnalysisResponse {
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

function modelFor(
  ws: number | null,
  opts: {
    rich?: boolean;
    policy?: PolicyContext | null;
    nearbySite?: NearbySiteResult | null;
  } = {},
) {
  const input: BuildReportModelInput = {
    analysis: makeAnalysis(ws, opts.rich ?? false),
    aoi: AOI,
    mapImages: {
      street: "data:image/png;base64,AAAA",
      terrain: "data:image/png;base64,BBBB",
      threeD: null,
    },
    generatedAt: "2026-06-23T00:00:00.000Z",
    policy: opts.policy ?? null,
    nearbySite: opts.nearbySite ?? null,
  };
  return buildReportModel(input);
}

describe("renderReportHtml — document shape", () => {
  const html = renderReportHtml(
    modelFor(7.2, { rich: true, policy: POLICY, nearbySite: NEARBY_FOUND }),
  );

  test("is a self-contained HTML doc with inlined style and no network refs", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("@page");
    // No external stylesheet/script/font fetches → reproducible under Chromium.
    // (An <svg> xmlns namespace is not a fetch, so target real refs only.)
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain("@import");
    expect(html).not.toContain("url(http");
  });

  test("carries the brand, title and site coordinates", () => {
    expect(html).toContain("WindPower India");
    expect(html).toContain("Wind Site Screening Report");
    expect(html).toContain("10.0500° N, 78.0500° E");
  });

  test("renders all six logical pages", () => {
    expect((html.match(/class="page"/g) ?? []).length).toBe(6);
  });
});

describe("renderReportHtml — populated content (high wind)", () => {
  const html = renderReportHtml(
    modelFor(7.2, { rich: true, policy: POLICY, nearbySite: NEARBY_FOUND }),
  );

  test("resource page shows the mean speed and capacity factor", () => {
    expect(html).toContain("Mean wind @100 m");
    expect(html).toContain("7.20 m/s");
    expect(html).toContain("Capacity factor (IEC-III)");
  });

  test("context page shows grid, sizing and the nearby better site", () => {
    expect(html).toContain("Tirunelveli SS");
    expect(html).toContain("Indicative sizing");
    expect(html).toContain("higher-scoring site");
  });

  test("policy page renders the matrix with sourced cells", () => {
    expect(html).toContain("PPA floor");
    expect(html).toContain("National");
    expect(html).toContain("₹3.00/kWh");
    expect(html).toContain("CERC RE Tariff 2024");
  });

  test("finance page shows the headline IRR and the indicative tariff warning", () => {
    expect(html).toContain("Equity IRR");
    expect(html).toContain("Placeholder CERC-2024 tariff stack");
  });

  test("final page shows the disclaimer, contact and provenance colophon", () => {
    expect(html).toContain("not a bankable");
    expect(html).toContain("info@cecl.in");
    expect(html).toContain("11.0.0"); // engineVersion in the colophon
    expect(html).toMatch(/[0-9a-f]{40}/); // inputsHash
  });

  test("is deterministic for a fixed model", () => {
    const m = modelFor(7.2, {
      rich: true,
      policy: POLICY,
      nearbySite: NEARBY_FOUND,
    });
    expect(renderReportHtml(m)).toBe(renderReportHtml(m));
  });
});

describe("renderReportHtml — null-resource discipline (D4)", () => {
  const html = renderReportHtml(modelFor(null));

  test("resource and financial screening degrade to explicit N/A notes", () => {
    expect(html).toContain("Wind resource: unavailable for this run.");
    expect(html).toContain("Financial screening: unavailable for this run.");
  });

  test("never renders a fabricated zero IRR figure", () => {
    expect(html).not.toContain("Equity IRR");
    expect(html).not.toContain("0.0%");
  });
});

describe("renderReportHtml — nearby-site branches", () => {
  test("renders the 'none found' reason when no better site exists", () => {
    const html = renderReportHtml(
      modelFor(7.2, {
        rich: true,
        nearbySite: {
          found: false,
          reason: "no higher-scoring site within 10 km",
        },
      }),
    );
    expect(html).toContain("No strictly better site nearby");
    expect(html).toContain("no higher-scoring site within 10 km");
  });

  test("renders 'not run' when nearby search was skipped", () => {
    const html = renderReportHtml(modelFor(7.2, { rich: true }));
    expect(html).toContain("Nearby-site search was not run");
  });
});

describe("renderReportHtml — policy unavailable", () => {
  test("degrades to an explicit note when no policy context", () => {
    const html = renderReportHtml(modelFor(7.2, { rich: true, policy: null }));
    // NB: SSR escapes "&" → "&amp;", so match on the unambiguous tail.
    expect(html).toContain("regulatory context: unavailable for this run.");
  });
});
