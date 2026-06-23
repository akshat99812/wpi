/**
 * Site-Analysis PDF Export — the ReportModel contract (plan §2, decision D4).
 *
 * ONE DTO is the seam between data (the analysis engine + Phase-1 additions) and
 * rendering (SSR template → Puppeteer). `buildReportModel` is PURE and SYNCHRONOUS:
 *  - the figure pieces (MC IRR histogram, tornado) are deterministic from the
 *    engine ws, reusing the SAME MC_SEED as the analyze band so they agree;
 *  - the I/O-bound pieces (policy context, nearby-site) are computed by the
 *    controller and passed IN, keeping this builder free of DB/network and thus
 *    snapshot-testable without Chromium.
 *
 * Null discipline (D4): the report MUST branch on `analysis.score.cuf === null`
 * (resource unavailable) — never on `value === 0`. This builder simply passes the
 * nullable engine output through and emits null figures; the template renders
 * "N/A", never 0.
 */

import { createHash } from "node:crypto";

import type { NearbySiteResult } from "../analysis/nearbySite";
import type { PolicyContext } from "../analysis/policyContext";
import { MC_SEED } from "../analysis/screenWind";
import type { AnalysisResponse, ValidatedAoi } from "../analysis/types";
import { WIND_CUF_CURVE } from "../analysis/windCuf";
import {
  mulberry32,
  WIND_CONFIG,
  windIrrRange,
  type IrrHistogram,
} from "../analysis/windFinance";
import {
  windSensitivity,
  type WindSensitivity,
} from "../analysis/windSensitivity";
import { REPORT_VERSION } from "./config";

/**
 * Self-identifying provenance for every exported PDF (plan §2.1). Rendered in
 * the page-6 colophon. `inputsHash` doubles as the idempotency/dedupe key (§6.4).
 */
export interface ReportMetadata {
  /** ISO timestamp of render. */
  generatedAt: string;
  /** Template/layout version — see REPORT_VERSION. */
  reportVersion: string;
  /** Pinned analysis-engine version (AnalysisResponse.analysisVersion). */
  engineVersion: string;
  /** ReportModel shape version — guards snapshot tests against silent drift. */
  modelSchemaVersion: string;
  /** Policy dataset as-of date (PolicyContext.asOf), or "" when unavailable. */
  policyAsOf: string;
  /** Stable sha1 of {aoi, engine version, mapImage digests} — repro + idempotency key. */
  inputsHash: string;
}

/** ReportModel shape version. Bump on any ReportModel field change. */
export const MODEL_SCHEMA_VERSION = "0.2.0";

/**
 * Validated, normalized map images (data URLs) captured client-side. A failed
 * shot is `null` so the template can render a placeholder rather than fail the
 * whole export (plan §4 senior note).
 */
export interface ReportMapImages {
  street: string | null;
  terrain: string | null;
  threeD: string | null;
}

/** AOI subset the report needs (AnalysisResponse omits ring/bbox). */
export type ReportAoi = Pick<
  ValidatedAoi,
  "ring" | "bbox" | "centroid" | "areaKm2" | "isPointMode"
>;

/** Pre-computed figure data the SVG charts render (the template stays dumb). */
export interface ReportFigures {
  /** CUF-vs-windspeed knots (CUF curve figure) — engine constant. */
  cufCurve: ReadonlyArray<readonly [number, number]>;
  /** Monte-Carlo equity-IRR histogram (figure F16); null when no resource. */
  irrHistogram: IrrHistogram | null;
  /** One-at-a-time tornado sensitivity; null when no resource. */
  tornado: WindSensitivity | null;
}

/** The full contract the template renders. Everything it needs lives here. */
export interface ReportModel {
  meta: ReportMetadata;
  /** Raw engine output (resource/score/finance/sections), passed through. */
  analysis: AnalysisResponse;
  /** Original AOI — needed because AnalysisResponse omits ring/bbox. */
  aoi: ReportAoi;
  mapImages: ReportMapImages;
  figures: ReportFigures;
  /** National + per-state policy (getPolicyContext); null when unavailable. */
  policy: PolicyContext | null;
  /** Nearby better-site comparison (findNearbyBetterSite); null when not run. */
  nearbySite: NearbySiteResult | null;
}

export interface BuildReportModelInput {
  analysis: AnalysisResponse;
  aoi: ReportAoi;
  mapImages: ReportMapImages;
  /** ISO timestamp of render — injected so the model is deterministic/snapshot-safe. */
  generatedAt: string;
  /** Controller-supplied I/O results (kept out of this pure builder). */
  policy?: PolicyContext | null;
  nearbySite?: NearbySiteResult | null;
}

const sha1 = (s: string): string => createHash("sha1").update(s).digest("hex");

/** The ws@100m that drives the headline — null when the resource section is unavailable. */
function headlineWs(analysis: AnalysisResponse): number | null {
  const r = analysis.sections.resource;
  return r.status === "ok" ? r.data?.meanSpeed ?? null : null;
}

function buildMeta(input: BuildReportModelInput): ReportMetadata {
  const imageDigests = {
    street: input.mapImages.street ? sha1(input.mapImages.street) : null,
    terrain: input.mapImages.terrain ? sha1(input.mapImages.terrain) : null,
    threeD: input.mapImages.threeD ? sha1(input.mapImages.threeD) : null,
  };
  const inputsHash = sha1(
    JSON.stringify({
      ring: input.aoi.ring,
      bbox: input.aoi.bbox,
      areaKm2: input.aoi.areaKm2,
      engineVersion: input.analysis.analysisVersion,
      imageDigests,
    }),
  );
  return {
    generatedAt: input.generatedAt,
    reportVersion: REPORT_VERSION,
    engineVersion: input.analysis.analysisVersion,
    modelSchemaVersion: MODEL_SCHEMA_VERSION,
    policyAsOf: input.policy?.asOf ?? "",
    inputsHash,
  };
}

function buildFigures(ws: number | null): ReportFigures {
  const irrHistogram =
    ws === null
      ? null
      : windIrrRange(ws, mulberry32(MC_SEED), WIND_CONFIG, { histogram: true })
          ?.histogram ?? null;
  return {
    cufCurve: WIND_CUF_CURVE,
    irrHistogram,
    tornado: windSensitivity(ws),
  };
}

/**
 * Assemble the ReportModel. PURE + synchronous — no rendering, no Puppeteer, no
 * I/O (policy/nearby-site are passed in). Snapshot-test this seam.
 */
export function buildReportModel(input: BuildReportModelInput): ReportModel {
  const ws = headlineWs(input.analysis);
  return {
    meta: buildMeta(input),
    analysis: input.analysis,
    aoi: input.aoi,
    mapImages: input.mapImages,
    figures: buildFigures(ws),
    policy: input.policy ?? null,
    nearbySite: input.nearbySite ?? null,
  };
}
