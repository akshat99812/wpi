/**
 * Per-chart SSR snapshots (plan §3.1 acceptance): every chart renders to a
 * string via renderToStaticMarkup with NO DOM/browser. Data is driven from the
 * real engine so the charts and the analyze response line up.
 */

import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WIND_CUF_CURVE } from "../../../analysis/windCuf";
import {
  mulberry32,
  WIND_CONFIG,
  windIrrRange,
} from "../../../analysis/windFinance";
import { windSensitivity } from "../../../analysis/windSensitivity";
import {
  CufCurve,
  McIrrDistribution,
  Tornado,
  TariffStack,
} from "./ResourceFinanceCharts";
import { BandMeter, BulletBar, ScoreComposition } from "./ScoreCharts";

const render = (el: ReactElement): string => renderToStaticMarkup(el);

describe("score charts render to SVG strings (no DOM)", () => {
  test("BandMeter shows the score", () => {
    const html = render(<BandMeter score={72} />);
    expect(html).toContain("<svg");
    expect(html).toContain("72");
  });

  test("ScoreComposition shows both contributions", () => {
    const html = render(<ScoreComposition resourcePoints={50} gridPoints={22} />);
    expect(html).toContain("Resource");
    expect(html).toContain("Grid");
  });

  test("BulletBar shows its label and value", () => {
    const html = render(<BulletBar label="Mean speed" value={7.2} max={10} target={6} unit=" m/s" />);
    expect(html).toContain("Mean speed");
    expect(html).toContain("<rect");
  });
});

describe("resource/finance charts render to SVG strings (no DOM)", () => {
  test("CufCurve draws a path and the operating point", () => {
    const html = render(<CufCurve curve={WIND_CUF_CURVE} ws={7.2} cuf={0.434} />);
    expect(html).toContain("<path");
    expect(html).toContain("m/s");
  });

  test("McIrrDistribution (F16) draws histogram bars + P50", () => {
    const band = windIrrRange(7.2, mulberry32(42), WIND_CONFIG, { histogram: true })!;
    const html = render(
      <McIrrDistribution histogram={band.histogram!} p10={band.p10} p50={band.p50} p90={band.p90} />,
    );
    expect(html).toContain("<rect");
    expect(html).toContain("P50");
  });

  test("McIrrDistribution degrades to N/A on an empty histogram", () => {
    const html = render(<McIrrDistribution histogram={{ binEdges: [], counts: [] }} />);
    expect(html).toContain("N/A");
  });

  test("Tornado draws a bar per variable and the base line", () => {
    const s = windSensitivity(7.2)!;
    const html = render(<Tornado baseIrr={s.baseIrr} rows={s.rows} />);
    expect(html).toContain("<rect");
    expect(html).toContain("CUF");
    expect(html).toContain("base");
  });

  test("TariffStack sums the components to the effective tariff (₹4.50)", () => {
    const html = render(<TariffStack ppa={3.5} rec={0.35} tod={0.4} carbon={0.25} />);
    expect(html).toContain("₹4.50/kWh");
  });

  test("charts are deterministic (same props → same markup)", () => {
    expect(render(<BandMeter score={72} />)).toBe(render(<BandMeter score={72} />));
    const s = windSensitivity(7.2)!;
    expect(render(<Tornado baseIrr={s.baseIrr} rows={s.rows} />)).toBe(
      render(<Tornado baseIrr={s.baseIrr} rows={s.rows} />),
    );
  });
});
