/**
 * Unit tests for the report controller (plan §6.2/§6.4) — boundary validation,
 * selected-site derivation, and the inputsHash de-dupe. No DB and no Chromium:
 * the render step is exercised through an injected fake PdfRenderer.
 */

import { describe, expect, test } from "bun:test";

import { REPORT_MAP_IMAGE_MAX_BYTES } from "./config";
import {
  generateReportPdf,
  inFlightReportCount,
  type PdfRenderer,
  reportRequestSchema,
  ReportRequestError,
  selectedSiteFrom,
  validateMapImages,
} from "./reportController";
import { sampleReportModel } from "./sampleReportModel";

const SQUARE = {
  type: "Polygon" as const,
  coordinates: [
    [
      [78.0, 10.0],
      [78.1, 10.0],
      [78.1, 10.1],
      [78.0, 10.1],
      [78.0, 10.0],
    ],
  ],
};

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

describe("reportRequestSchema", () => {
  test("accepts a geometry + three (nullable) map images", () => {
    const r = reportRequestSchema.safeParse({
      geometry: SQUARE,
      mapImages: { street: PNG, terrain: null, threeD: null },
    });
    expect(r.success).toBe(true);
  });

  test("rejects a body missing mapImages", () => {
    const r = reportRequestSchema.safeParse({ geometry: SQUARE });
    expect(r.success).toBe(false);
  });

  test("rejects a non-polygon geometry", () => {
    const r = reportRequestSchema.safeParse({
      geometry: { type: "Point", coordinates: [78, 10] },
      mapImages: { street: null, terrain: null, threeD: null },
    });
    expect(r.success).toBe(false);
  });
});

describe("validateMapImages", () => {
  test("passes nulls and valid png/jpeg data URLs through", () => {
    const out = validateMapImages({ street: PNG, terrain: null, threeD: null });
    expect(out).toEqual({ street: PNG, terrain: null, threeD: null });
  });

  test("rejects a non-image data URL (no SSRF, inline only)", () => {
    expect(() =>
      validateMapImages({
        street: "data:text/html;base64,PHA+",
        terrain: null,
        threeD: null,
      }),
    ).toThrow(ReportRequestError);
  });

  test("rejects a remote URL", () => {
    expect(() =>
      validateMapImages({
        street: "https://evil.example/x.png",
        terrain: null,
        threeD: null,
      }),
    ).toThrow(ReportRequestError);
  });

  test("rejects an over-cap image", () => {
    const huge =
      "data:image/png;base64," +
      "A".repeat(Math.ceil((REPORT_MAP_IMAGE_MAX_BYTES * 4) / 3) + 16);
    expect(() =>
      validateMapImages({ street: huge, terrain: null, threeD: null }),
    ).toThrow(ReportRequestError);
  });
});

describe("selectedSiteFrom", () => {
  test("derives the headline site when resource is available", () => {
    const sel = selectedSiteFrom(sampleReportModel("high-wind").analysis);
    expect(sel).not.toBeNull();
    expect(sel!.ws).toBeGreaterThan(0);
    expect(sel!.score).toBeGreaterThan(0);
  });

  test("returns null when the resource section is unavailable", () => {
    expect(
      selectedSiteFrom(sampleReportModel("null-resource").analysis),
    ).toBeNull();
  });
});

describe("generateReportPdf — inputsHash de-dupe (plan §6.4)", () => {
  test("two concurrent identical requests share one render", async () => {
    const model = sampleReportModel("high-wind");
    let calls = 0;
    const fake: PdfRenderer = () => {
      calls += 1;
      return new Promise((resolve) =>
        setTimeout(() => resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])), 15),
      );
    };
    const [a, b] = await Promise.all([
      generateReportPdf({ model, render: fake }),
      generateReportPdf({ model, render: fake }),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(inFlightReportCount()).toBe(0); // cleaned up on settle
  });
});
