/**
 * Report endpoint orchestration (plan §6.2/§6.4) — the testable core behind
 * POST /api/site-analysis/report. Pure validation + derivation helpers plus the
 * render step with in-flight de-dupe, all separated from Express so they unit-
 * test without a request object.
 *
 *  - reportRequestSchema / validateMapImages — boundary validation (no SSRF:
 *    inline base64 only, png/jpeg, size-capped).
 *  - selectedSiteFrom — the headline site, for the nearby-better-site search.
 *  - generateReportPdf — renderReportHtml → withPage(renderPdf), de-duped on
 *    ReportMetadata.inputsHash so a double-click runs Chromium once (plan §6.4).
 */

import { z } from "zod";

import { geoJsonPolygonSchema } from "../analysis/geometry";
import type { SelectedSite } from "../analysis/nearbySite";
import type { AnalysisResponse } from "../analysis/types";
import { REPORT_MAP_IMAGE_MAX_BYTES } from "./config";
import { withPage } from "./browserPool";
import { renderPdf } from "./renderPdf";
import { renderReportHtml } from "./renderReportHtml";
import type { ReportMapImages, ReportModel } from "./reportModel";

/** Body: the AOI geometry + the three client-captured map images (or null). */
export const reportRequestSchema = z.object({
  geometry: geoJsonPolygonSchema,
  mapImages: z.object({
    street: z.string().nullable(),
    terrain: z.string().nullable(),
    threeD: z.string().nullable(),
  }),
});

export type ReportRequest = z.infer<typeof reportRequestSchema>;

/** 400-class validation failure with a machine-readable code. */
export class ReportRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReportRequestError";
  }
}

const DATA_URL_RE = /^data:image\/(png|jpeg);base64,/;

/** Approx decoded byte length of a base64 payload (ignores padding skew). */
function base64Bytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Validate the three map images: each is either null (a skipped shot → the
 * template renders a placeholder) or a png/jpeg base64 data URL within the size
 * cap. Throws ReportRequestError (→ 400). Never fetches a remote URL.
 */
export function validateMapImages(raw: {
  street: string | null;
  terrain: string | null;
  threeD: string | null;
}): ReportMapImages {
  const check = (value: string | null, name: string): string | null => {
    if (value === null) return null;
    if (!DATA_URL_RE.test(value)) {
      throw new ReportRequestError(
        "BAD_IMAGE",
        `${name} must be a base64 image/png or image/jpeg data URL`,
      );
    }
    if (base64Bytes(value) > REPORT_MAP_IMAGE_MAX_BYTES) {
      throw new ReportRequestError(
        "IMAGE_TOO_LARGE",
        `${name} exceeds the ${REPORT_MAP_IMAGE_MAX_BYTES}-byte map-image limit`,
      );
    }
    return value;
  };
  return {
    street: check(raw.street, "street"),
    terrain: check(raw.terrain, "terrain"),
    threeD: check(raw.threeD, "threeD"),
  };
}

/**
 * The selected site for the nearby-better-site search (plan §1.3). Null when the
 * resource section is unavailable — there is nothing to compare, so the search
 * is skipped rather than run against a null headline.
 */
export function selectedSiteFrom(
  analysis: AnalysisResponse,
): SelectedSite | null {
  const resource =
    analysis.sections.resource.status === "ok"
      ? analysis.sections.resource.data
      : null;
  const ws = resource?.meanSpeed ?? null;
  if (ws === null) return null;
  const grid =
    analysis.sections.grid.status === "ok" ? analysis.sections.grid.data : null;
  const fin = analysis.financials;
  return {
    ws,
    score: analysis.score.value,
    cuf: analysis.score.cuf,
    lineKm: grid?.nearestLine?.distanceKm ?? null,
    subKm: grid?.nearestSubstation?.distanceKm ?? null,
    equityIrr: fin?.irr ?? null,
    npvCr: fin?.npvCr ?? null,
    paybackYr: fin?.payback ?? null,
  };
}

/** Injectable so the de-dupe logic is tested without launching Chromium. */
export type PdfRenderer = (
  html: string,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

const defaultRenderer: PdfRenderer = (html, signal) =>
  withPage((page) => renderPdf(page, html), { signal });

/** hash → in-flight render, so concurrent identical requests share one render. */
const inFlight = new Map<string, Promise<Uint8Array>>();

export function inFlightReportCount(): number {
  return inFlight.size;
}

/**
 * Render a built ReportModel to a PDF, de-duped on inputsHash (plan §6.4): a
 * double-click or client retry joins the running render instead of starting a
 * second Chromium pass. The map is registered synchronously, so two concurrent
 * identical requests can never both miss it.
 */
export function generateReportPdf(args: {
  model: ReportModel;
  signal?: AbortSignal;
  render?: PdfRenderer;
}): Promise<Uint8Array> {
  const hash = args.model.meta.inputsHash;
  const existing = inFlight.get(hash);
  if (existing) return existing;

  const render = args.render ?? defaultRenderer;
  const startedAt = performance.now();
  const promise = (async () => {
    const html = renderReportHtml(args.model);
    const pdf = await render(html, args.signal);
    console.info(
      `[report] rendered hash=${hash.slice(0, 8)} ` +
        `bytes=${pdf.length} ms=${Math.round(performance.now() - startedAt)}`,
    );
    return pdf;
  })().finally(() => inFlight.delete(hash));

  inFlight.set(hash, promise);
  return promise;
}
