/**
 * Unit tests for the ReportModel builder (reportModel.ts, PR5).
 *
 * buildReportModel is the data↔rendering seam: deterministic, snapshot-safe,
 * null-resource-safe (figures null, never 0). Fixtures are built from the real
 * engine so the figures line up with the analyze response.
 */

import { describe, expect, test } from "bun:test";

import { screenWind } from "../analysis/screenWind";
import type { AnalysisResponse, ResourceData } from "../analysis/types";
import { WIND_CUF_CURVE } from "../analysis/windCuf";
import { toAnalysisScore } from "../analysis/windScoring";
import { REPORT_VERSION } from "./config";
import {
  buildReportModel,
  MODEL_SCHEMA_VERSION,
  type BuildReportModelInput,
  type ReportAoi,
} from "./reportModel";

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

function makeAnalysis(ws: number | null): AnalysisResponse {
  const s = screenWind(ws, 0.5, 0.5);
  return {
    analysisVersion: "11.0.0",
    aoi: { areaKm2: 25, centroid: [78.05, 10.05], isPointMode: false },
    score: toAnalysisScore(s.score, "high"),
    financials: s.financials,
    irrBand: s.irrBand,
    sections: {
      resource: {
        status: ws === null ? "unavailable" : "ok",
        data: ws === null ? null : ({ meanSpeed: ws } as unknown as ResourceData),
      },
      climate: { status: "unavailable", data: null },
      validation: { status: "unavailable", data: null },
      grid: { status: "unavailable", data: null },
      context: { status: "unavailable", data: null },
    },
  };
}

function inputFor(ws: number | null): BuildReportModelInput {
  return {
    analysis: makeAnalysis(ws),
    aoi: AOI,
    mapImages: { street: "data:image/png;base64,AAAA", terrain: null, threeD: null },
    generatedAt: "2026-06-23T00:00:00.000Z",
  };
}

describe("buildReportModel — meta & provenance", () => {
  const model = buildReportModel(inputFor(7.2));

  test("stamps engine/report/schema versions + a sha1 inputsHash", () => {
    expect(model.meta.engineVersion).toBe("11.0.0");
    expect(model.meta.reportVersion).toBe(REPORT_VERSION);
    expect(model.meta.modelSchemaVersion).toBe(MODEL_SCHEMA_VERSION);
    expect(model.meta.generatedAt).toBe("2026-06-23T00:00:00.000Z");
    expect(model.meta.inputsHash).toMatch(/^[0-9a-f]{40}$/);
  });

  test("inputsHash changes when the AOI ring changes", () => {
    const a = buildReportModel(inputFor(7.2)).meta.inputsHash;
    const moved: BuildReportModelInput = {
      ...inputFor(7.2),
      aoi: { ...AOI, ring: AOI.ring.map(([x, y]) => [x + 1, y] as [number, number]) },
    };
    expect(buildReportModel(moved).meta.inputsHash).not.toBe(a);
  });
});

describe("buildReportModel — figures", () => {
  test("ws present: histogram + tornado + cuf curve are populated and consistent", () => {
    const model = buildReportModel(inputFor(7.2));
    expect(model.figures.cufCurve).toBe(WIND_CUF_CURVE);
    expect(model.figures.irrHistogram).not.toBeNull();
    // Histogram is built from the SAME MC band the analyze response carries.
    const total = model.figures.irrHistogram!.counts.reduce((s, c) => s + c, 0);
    expect(total).toBe(model.analysis.irrBand!.n);
    expect(model.figures.tornado).not.toBeNull();
    expect(model.figures.tornado!.baseIrr).toBeCloseTo(model.analysis.financials!.irr!, 9);
  });

  test("null resource: figures null, financials null, never 0 (D4)", () => {
    const model = buildReportModel(inputFor(null));
    expect(model.figures.irrHistogram).toBeNull();
    expect(model.figures.tornado).toBeNull();
    expect(model.analysis.financials).toBeNull();
    expect(model.analysis.score.cuf).toBeNull(); // the null-discriminator
  });
});

describe("buildReportModel — purity & passthrough", () => {
  test("is deterministic for a fixed input", () => {
    expect(buildReportModel(inputFor(7.2))).toEqual(buildReportModel(inputFor(7.2)));
  });

  test("policy & nearbySite default to null and pass through when provided", () => {
    expect(buildReportModel(inputFor(7.2)).policy).toBeNull();
    expect(buildReportModel(inputFor(7.2)).nearbySite).toBeNull();
    const withExtras = buildReportModel({
      ...inputFor(7.2),
      policy: { asOf: "2025-01-01", stateCodes: ["TN"], compare: {} as never },
      nearbySite: { found: false, reason: "none" },
    });
    expect(withExtras.policy!.stateCodes).toEqual(["TN"]);
    expect(withExtras.meta.policyAsOf).toBe("2025-01-01");
    expect(withExtras.nearbySite!.found).toBe(false);
  });
});
