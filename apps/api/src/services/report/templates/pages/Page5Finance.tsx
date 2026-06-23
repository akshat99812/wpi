/**
 * Page 5 — Financial screening (plan §3.2, methodology PART B). Per-MW headline
 * pro-forma, the Monte-Carlo equity-IRR distribution (F16), the one-at-a-time
 * tornado, and the effective-tariff stack. The tariff stack is PLACEHOLDER
 * CERC-2024 config (badged "indicative" and visually separated from the sourced
 * policy values on page 4). Null financials → explicit N/A (decision D4).
 */

import { WIND_CONFIG } from "../../../analysis/windFinance";
import {
  McIrrDistribution,
  TariffStack,
  Tornado,
} from "../charts/ResourceFinanceCharts";
import { FINANCE_METHODOLOGY } from "../brand";
import { dash, inrCr, inrKwh, int, pctOrDash } from "../format";
import {
  Card,
  Figure,
  Note,
  Page,
  Stat,
  StatGrid,
  Unavailable,
} from "../primitives";
import type { ReportModel } from "../../reportModel";

export function Page5Finance({ model }: { model: ReportModel }) {
  const { analysis, figures } = model;
  const fin = analysis.financials;
  const band = analysis.irrBand;

  if (!fin) {
    return (
      <Page kicker="Financial screening" title="Commercial read-out">
        <Unavailable label="Financial screening" />
        <p className="muted">
          No wind resource was resolved for this AOI, so the per-MW pro-forma
          cannot be computed. Financial figures are intentionally blank rather
          than zero.
        </p>
      </Page>
    );
  }

  return (
    <Page kicker="Financial screening" title="Commercial read-out · per MW">
      <StatGrid cols={3}>
        <Stat
          label="Equity IRR"
          value={pctOrDash(fin.irr)}
          sub="levered · headline"
        />
        <Stat label="Project IRR" value={pctOrDash(fin.projIrr)} sub="unlevered" />
        <Stat label="LCOE" value={dash(fin.lcoe, inrKwh)} />
        <Stat label="Payback" value={dash(fin.payback, (v) => `${v} yr`)} />
        <Stat label="NPV @10%" value={inrCr(fin.npvCr)} />
        <Stat label="Annual energy" value={`${int(fin.annualMwh)} MWh`} />
      </StatGrid>

      {band ? (
        <Card
          title={`Equity-IRR band · ${band.n.toLocaleString()} Monte-Carlo runs`}
        >
          <p className="lead">
            P50 {pctOrDash(band.p50)}{" "}
            <span className="muted">
              likely {pctOrDash(band.p25)}–{pctOrDash(band.p75)} · envelope{" "}
              {pctOrDash(band.p10)}–{pctOrDash(band.p90)} (P10–P90)
            </span>
          </p>
        </Card>
      ) : null}

      <div className="grid grid-2">
        {figures.irrHistogram ? (
          <Figure
            title="Equity-IRR distribution (F16)"
            caption="4,000-run Monte Carlo over the published market spread, with P10/P50/P90."
          >
            <McIrrDistribution
              histogram={figures.irrHistogram}
              p10={band?.p10}
              p50={band?.p50}
              p90={band?.p90}
              width={300}
              height={170}
            />
          </Figure>
        ) : (
          <Unavailable label="IRR distribution" />
        )}
        {figures.tornado ? (
          <Figure
            title="Sensitivity (tornado)"
            caption="One-at-a-time swing of each input to its min/max; bars sorted by influence on equity IRR."
          >
            <Tornado
              baseIrr={figures.tornado.baseIrr}
              rows={figures.tornado.rows}
              width={300}
              height={190}
            />
          </Figure>
        ) : (
          <Unavailable label="Sensitivity" />
        )}
      </div>

      <Figure
        title="Effective tariff stack (indicative)"
        caption="PPA floor plus REC / ToD-merchant / carbon adders — the adders are what lift IRR above a bare PPA."
      >
        <TariffStack
          ppa={WIND_CONFIG.ppa}
          rec={WIND_CONFIG.recWind}
          tod={WIND_CONFIG.todMerchantWind}
          carbon={WIND_CONFIG.carbon}
          width={420}
        />
      </Figure>

      <Note warn>
        Placeholder CERC-2024 tariff stack (PPA ₹{WIND_CONFIG.ppa.toFixed(2)} +
        REC + ToD + carbon = ₹{fin.effTariff.toFixed(2)}/kWh). These are
        normative market assumptions, not this project's PPA — ground them in
        real offtake terms before quoting any IRR as meaningful.
      </Note>

      <Card title="How this is modelled">
        <ul className="tight muted">
          {FINANCE_METHODOLOGY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
