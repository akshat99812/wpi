/**
 * SSR content tests for the print template (plan §3.2/§3.5 acceptance): the
 * report renders to a self-contained HTML string with NO DOM/browser, the
 * null-resource path shows "N/A" (never 0, decision D4), and the policy /
 * nearby-site branches render from the model. Fixtures are the shared four-case
 * matrix from sampleReportModel (DRY with the /preview route).
 */

import { describe, expect, test } from "bun:test";

import { renderReportHtml } from "../renderReportHtml";
import type { ReportModel } from "../reportModel";
import {
  isSampleFixture,
  SAMPLE_FIXTURES,
  sampleReportModel,
} from "../sampleReportModel";

describe("renderReportHtml — document shape", () => {
  const html = renderReportHtml(sampleReportModel("high-wind"));

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
  const html = renderReportHtml(sampleReportModel("high-wind"));

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
    expect(renderReportHtml(sampleReportModel("high-wind"))).toBe(
      renderReportHtml(sampleReportModel("high-wind")),
    );
  });
});

describe("renderReportHtml — multi-state policy", () => {
  const html = renderReportHtml(sampleReportModel("multi-state"));

  test("renders a column per intersected state", () => {
    expect(html).toContain("National");
    expect(html).toContain("TN");
    expect(html).toContain("KA");
    expect(html).toContain("₹3.10/kWh"); // KA-only PPA floor value
  });
});

describe("renderReportHtml — null-resource discipline (D4)", () => {
  const html = renderReportHtml(sampleReportModel("null-resource"));

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
    const html = renderReportHtml(sampleReportModel("no-nearby"));
    expect(html).toContain("No strictly better site nearby");
    expect(html).toContain("no higher-scoring site within 10 km");
  });

  test("renders 'not run' when nearby search was skipped", () => {
    const base = sampleReportModel("high-wind");
    const model: ReportModel = { ...base, nearbySite: null };
    expect(renderReportHtml(model)).toContain("Nearby-site search was not run");
  });
});

describe("renderReportHtml — policy unavailable", () => {
  test("degrades to an explicit note when no policy context", () => {
    const base = sampleReportModel("high-wind");
    const model: ReportModel = { ...base, policy: null };
    // NB: SSR escapes "&" → "&amp;", so match on the unambiguous tail.
    expect(renderReportHtml(model)).toContain(
      "regulatory context: unavailable for this run.",
    );
  });
});

describe("sampleReportModel — /preview fixture matrix (PR8)", () => {
  test("every advertised fixture renders a 6-page report without throwing", () => {
    for (const f of SAMPLE_FIXTURES) {
      const html = renderReportHtml(sampleReportModel(f));
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect((html.match(/class="page"/g) ?? []).length).toBe(6);
    }
  });

  test("isSampleFixture guards the query param", () => {
    expect(isSampleFixture("high-wind")).toBe(true);
    expect(isSampleFixture("multi-state")).toBe(true);
    expect(isSampleFixture("bogus")).toBe(false);
    expect(isSampleFixture("")).toBe(false);
  });
});
