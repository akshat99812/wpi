/**
 * Page 3 — Grid, sizing & site context (plan §3.2). Grid proximity, indicative
 * sizing, exclusion-zone coverage, on-site inventory, and the nearby
 * better-site comparison (or a graceful "none found"). Every section degrades
 * to an explicit note when its data did not arrive — never an empty hole.
 */

import type { ContextData, GridData } from "../../../analysis/types";
import type { NearbySiteResult } from "../../../analysis/nearbySite";
import { areaPct, dash, int, km, pctOrDash } from "../format";
import { Card, Page, Stat, StatGrid, Unavailable } from "../primitives";
import type { ReportModel } from "../../reportModel";

function GridCard({ grid }: { grid: GridData }) {
  return (
    <Card title="Grid proximity">
      <p>
        Nearest substation:{" "}
        {grid.nearestSubstation ? (
          <>
            <strong>{grid.nearestSubstation.name ?? "unnamed"}</strong> (
            {grid.nearestSubstation.voltageKv != null
              ? `${grid.nearestSubstation.voltageKv} kV`
              : "unknown kV"}
            ) · {km(grid.nearestSubstation.distanceKm)}
          </>
        ) : (
          "none found within search range"
        )}
      </p>
      {grid.nearestLine ? (
        <p>
          Nearest line:{" "}
          {grid.nearestLine.voltageKv != null
            ? `${grid.nearestLine.voltageKv} kV`
            : "unknown kV"}{" "}
          · {km(grid.nearestLine.distanceKm)}
        </p>
      ) : null}
      <p className="muted" style={{ marginTop: "4px" }}>
        {grid.ehvWithin25Km
          ? "EHV grid within 25 km. "
          : "No EHV within 25 km. "}
        {grid.dataNote}
      </p>
    </Card>
  );
}

function SizingCard({ ctx }: { ctx: ContextData }) {
  const s = ctx.sizing;
  return (
    <Card title="Indicative sizing">
      <StatGrid cols={3}>
        <Stat label="Capacity" value={`~${Math.round(s.capacityMw)} MW`} />
        <Stat label="Annual energy" value={`~${Math.round(s.energyGwh)} GWh`} />
        <Stat
          label="Developable area"
          value={`~${s.usableKm2.toFixed(1)} km²`}
          sub={`${(s.developableFraction * 100).toFixed(0)}% of area`}
        />
      </StatGrid>
      {(s.excludedFraction != null || s.steepFraction != null) && (
        <p className="muted" style={{ marginTop: "5px" }}>
          {s.excludedFraction != null
            ? `${areaPct(s.excludedFraction)} legal exclusions`
            : "exclusions unavailable"}
          {s.steepFraction != null
            ? ` · ${areaPct(s.steepFraction)} too steep`
            : ""}
          {ctx.windfarms.overlapFraction > 0
            ? ` · ${areaPct(ctx.windfarms.overlapFraction)} overlaps existing wind farms`
            : ""}
        </p>
      )}
      {s.assumptions.length > 0 && (
        <ul className="tight muted">
          {s.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExclusionsCard({ ctx }: { ctx: ContextData }) {
  const ex = ctx.exclusions;
  if (!ex) return <Unavailable label="Exclusion zones" />;
  const any =
    ex.redFraction > 0 || ex.amberFraction > 0 || ex.categories.length > 0;
  return (
    <Card title="Exclusion zones">
      {!any ? (
        <p className="muted">No exclusion zones intersect this area.</p>
      ) : (
        <>
          <p>
            <strong className="neg">{areaPct(ex.redFraction)}</strong> hard
            (no-go)
            {ex.amberFraction > 0 ? (
              <>
                {" "}
                · <strong>{areaPct(ex.amberFraction)}</strong>{" "}
                verify-before-use
              </>
            ) : null}{" "}
            of area
          </p>
          {ex.categories.length > 0 && (
            <table className="tbl" style={{ marginTop: "4px" }}>
              <tbody>
                {ex.categories.map((c) => (
                  <tr key={`${c.cls}:${c.layerCode}`}>
                    <td>
                      <span className={c.cls === "red" ? "neg" : ""}>
                        {c.cls === "red" ? "● " : "○ "}
                      </span>
                      {c.layerCode}
                    </td>
                    <td className="num">{areaPct(c.fraction)}</td>
                    <td className="num muted">{c.km2.toFixed(1)} km²</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: "4px" }}>
            Kinds can overlap and may sum to more than the totals; only hard
            (red) zones are removed from the developable area.
          </p>
        </>
      )}
    </Card>
  );
}

function InventoryCard({
  ctx,
  mastCount,
}: {
  ctx: ContextData;
  mastCount: number;
}) {
  const t = ctx.turbines;
  const turbineCount = t?.count ?? 0;
  if (turbineCount === 0 && mastCount === 0) return null;
  return (
    <Card title="On-site inventory">
      {t && turbineCount > 0 ? (
        <p>
          <strong>{int(turbineCount)}</strong> wind turbine
          {turbineCount === 1 ? "" : "s"} inside this area
          {t.ratedMw != null ? (
            <span className="muted">
              {" "}
              · ~{int(t.ratedMw)} MW rated
              {t.ratedCount < turbineCount
                ? ` (${t.ratedCount} of ${turbineCount} tagged)`
                : ""}
            </span>
          ) : null}
        </p>
      ) : null}
      {mastCount > 0 ? (
        <p>
          {mastCount} measurement mast{mastCount === 1 ? "" : "s"} inside this
          area
        </p>
      ) : null}
    </Card>
  );
}

function NearbyCard({ nearby }: { nearby: NearbySiteResult | null }) {
  if (!nearby) {
    return (
      <Card title="Nearby better site">
        <p className="muted">Nearby-site search was not run for this report.</p>
      </Card>
    );
  }
  if (!nearby.found || !nearby.candidate) {
    return (
      <Card title="Nearby better site">
        <p>
          No strictly better site nearby — {nearby.reason ?? "none found"}. The
          selected AOI is the best screened option at this scale.
        </p>
      </Card>
    );
  }
  const c = nearby.candidate;
  const d = nearby.deltas ?? {};
  const delta = (
    v: number | undefined,
    fmt: (x: number) => string = (x) => x.toFixed(1),
  ) => (v == null ? "" : ` (${v > 0 ? "+" : ""}${fmt(v)})`);
  return (
    <Card title="Nearby better site">
      <p>
        A higher-scoring site sits <strong>{km(c.distanceKm)}</strong> away.
        Values below are the candidate, with the change vs the selected site.
      </p>
      <table className="tbl" style={{ marginTop: "4px" }}>
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">Candidate (Δ vs selected)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Screening score</td>
            <td className="num">
              {c.score.toFixed(0)}
              <span className="pos">{delta(d.score, (x) => x.toFixed(0))}</span>
            </td>
          </tr>
          <tr>
            <td>Mean wind @100 m</td>
            <td className="num">
              {c.ws.toFixed(2)} m/s
              <span className="pos">{delta(d.ws, (x) => x.toFixed(2))}</span>
            </td>
          </tr>
          <tr>
            <td>Capacity factor</td>
            <td className="num">
              {dash(c.cuf, (v) => `${(v * 100).toFixed(1)}%`)}
              <span className="pos">
                {delta(d.cuf, (x) => `${(x * 100).toFixed(1)}pp`)}
              </span>
            </td>
          </tr>
          <tr>
            <td>Equity IRR</td>
            <td className="num">
              {pctOrDash(c.equityIrr)}
              <span className="pos">
                {delta(d.equityIrr, (x) => `${(x * 100).toFixed(1)}pp`)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

export function Page3Context({ model }: { model: ReportModel }) {
  const { sections } = model.analysis;
  const grid = sections.grid.status === "ok" ? sections.grid.data : null;
  const ctx = sections.context.status === "ok" ? sections.context.data : null;
  const validation =
    sections.validation.status === "ok" ? sections.validation.data : null;

  return (
    <Page kicker="Site context" title="Grid, sizing & constraints">
      {grid ? <GridCard grid={grid} /> : <Unavailable label="Grid proximity" />}
      {ctx ? <SizingCard ctx={ctx} /> : <Unavailable label="Site sizing" />}
      {ctx ? <ExclusionsCard ctx={ctx} /> : null}
      {ctx ? (
        <InventoryCard ctx={ctx} mastCount={validation?.mastCountInAoi ?? 0} />
      ) : null}
      <NearbyCard nearby={model.nearbySite} />
    </Page>
  );
}
