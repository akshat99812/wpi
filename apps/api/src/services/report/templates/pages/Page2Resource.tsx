/**
 * Page 2 — Wind resource (plan §3.2). Mirrors the live ResourceBlock stat grid
 * plus the CUF operating-point curve and the terrain / 3-D map shots. When the
 * resource section is unavailable the whole page degrades to an explicit N/A
 * note — never 0 (decision D4).
 */

import type { ResourceData } from "../../../analysis/types";
import { CufCurve } from "../charts/ResourceFinanceCharts";
import { dash, ms, na, pct } from "../format";
import {
  Badge,
  Card,
  Figure,
  MapFrame,
  Page,
  Stat,
  StatGrid,
  Unavailable,
} from "../primitives";
import type { ReportModel } from "../../reportModel";

function ResourceStats({ r }: { r: ResourceData }) {
  return (
    <StatGrid cols={2}>
      <Stat label="Mean wind @100 m" value={ms(r.meanSpeed)} />
      <Stat
        label="Capacity factor (IEC-III)"
        value={dash(r.cfIec3, (v) => pct(v))}
        sub={r.cfIec2 != null ? `IEC-II: ${pct(r.cfIec2)}` : undefined}
      />
      <Stat
        label="Power density (corrected)"
        value={dash(r.powerDensity, (v) => `${Math.round(v)} W/m²`)}
        sub={
          r.powerDensityRaw != null
            ? `raw ${Math.round(r.powerDensityRaw)} · ρ ${r.airDensity.toFixed(3)}`
            : undefined
        }
      />
      <Stat label="Shear α" value={r.shearAlpha.toFixed(2)} />
      <Stat
        label="Speed spread (p25–p75)"
        value={`${r.p25Speed.toFixed(1)}–${r.p75Speed.toFixed(1)} m/s`}
        sub={`median ${r.p50Speed.toFixed(1)} · range ${r.minSpeed.toFixed(1)}–${r.maxSpeed.toFixed(1)}`}
      />
      <Stat
        label="Area coverage"
        value={`90% > ${r.areaExceedance90.toFixed(1)} m/s`}
        sub="of site area exceeds this speed"
      />
    </StatGrid>
  );
}

export function Page2Resource({ model }: { model: ReportModel }) {
  const { analysis, figures, mapImages } = model;
  const r =
    analysis.sections.resource.status === "ok"
      ? analysis.sections.resource.data
      : null;

  return (
    <Page kicker="Wind resource" title="Resource & terrain">
      {r ? (
        <>
          <div className="badge-row">
            <Badge variant={r.siteClass}>{r.siteClass} site</Badge>
            {r.indiaPercentile != null ? (
              <Badge>India percentile {Math.round(r.indiaPercentile)}</Badge>
            ) : null}
            {r.weibull ? (
              <Badge>
                Weibull A={r.weibull.A.toFixed(1)} · k={r.weibull.k.toFixed(2)}
              </Badge>
            ) : null}
          </div>
          <ResourceStats r={r} />
          <Figure
            title="Capacity factor vs wind speed"
            caption="Engine CUF curve with this site's operating point. Modern 120–140 m hub class."
          >
            <CufCurve
              curve={figures.cufCurve}
              ws={r.meanSpeed}
              cuf={analysis.score.cuf}
              width={420}
              height={170}
            />
          </Figure>
        </>
      ) : (
        <Unavailable label="Wind resource" />
      )}

      <Card title="Site imagery">
        <div className="grid grid-2">
          <MapFrame src={mapImages.terrain} caption="Terrain & hillshade" />
          <MapFrame src={mapImages.threeD} caption="3-D perspective" />
        </div>
        <p className="muted" style={{ marginTop: "6px" }}>
          Mean wind speed is the air-density-corrected GWA value at 100 m;{" "}
          {na(r?.meanSpeed, ms)} drives the capacity factor and every downstream
          figure.
        </p>
      </Card>
    </Page>
  );
}
