/**
 * Page 1 — Cover (plan §3.2). Brand mark, site identity, the headline screening
 * score with its composition, and the street map as the hero image. Reads only
 * the model; no computation here (decision D4 keeps that in buildReportModel).
 */

import type { AnalysisScore, ScoreRating } from "../../../analysis/types";
import { BandMeter, ScoreComposition } from "../charts/ScoreCharts";
import { BRAND } from "../brand";
import { formatCoords, formatDateTime, pct } from "../format";
import { MapFrame } from "../primitives";
import type { ReportModel } from "../../reportModel";

/** One-line plain-language verdict keyed to the §A3 rating band. */
const VERDICT: Record<ScoreRating, string> = {
  Excellent: "A strong wind resource with favourable screening economics.",
  Good: "A promising site; resource and grid screen well for early-stage development.",
  Moderate: "A workable site with trade-offs — confirm resource and offtake before committing.",
  Marginal: "A weak screening result; resource or grid constraints limit viability.",
  Poor: "Screening indicates this site is not attractive on current assumptions.",
};

function pointsFor(score: AnalysisScore, key: "resource" | "grid") {
  const c = score.components.find((x) => x.key === key);
  return {
    points: c?.points ?? 0,
    weight: c?.weight ?? (key === "resource" ? 72 : 28),
  };
}

export function Page1Cover({ model }: { model: ReportModel }) {
  const { analysis, aoi, mapImages, meta } = model;
  const { score } = analysis;
  const resource = pointsFor(score, "resource");
  const grid = pointsFor(score, "grid");

  return (
    <section className="page">
      <div className="cover-head">
        <div className="cover-brand">
          {BRAND.product}
          <small>{BRAND.tagline}</small>
        </div>
        <dl className="kv" style={{ textAlign: "right" }}>
          <dt>Report</dt>
          <dd>{BRAND.reportTitle}</dd>
          <dt>Generated</dt>
          <dd>{formatDateTime(meta.generatedAt)}</dd>
        </dl>
      </div>

      <div style={{ marginTop: "6px" }}>
        <p className="page-kicker">Site screening summary</p>
        <h1 className="page-title">{formatCoords(aoi.centroid)}</h1>
        <dl className="kv" style={{ marginTop: "4px" }}>
          <dt>Area of interest</dt>
          <dd>
            {aoi.areaKm2.toFixed(1)} km²
            {aoi.isPointMode ? " · 5×5 km point analysis" : ""}
          </dd>
          <dt>Confidence</dt>
          <dd style={{ textTransform: "capitalize" }}>
            {score.confidence} (met-mast validation)
          </dd>
        </dl>
      </div>

      <div className="card">
        <div className="cover-score">
          <div className="score-num">
            {score.value}
            <small> / 100</small>
          </div>
          <div style={{ flex: 1 }}>
            <div className="badge-row">
              <span className="badge">{score.rating}</span>
              {score.cuf != null ? (
                <span className="badge">CUF {pct(score.cuf)}</span>
              ) : null}
            </div>
            <BandMeter score={score.value} width={360} />
          </div>
        </div>
        <p className="lead" style={{ marginTop: "6px" }}>
          {VERDICT[score.rating]}
        </p>
        <div style={{ marginTop: "4px" }}>
          <ScoreComposition
            resourcePoints={resource.points}
            gridPoints={grid.points}
            resourceWeight={resource.weight}
            gridWeight={grid.weight}
            width={360}
          />
        </div>
      </div>

      <MapFrame src={mapImages.street} caption="Site location — base map" />

      <p className="muted" style={{ marginTop: "auto" }}>
        {BRAND.product} · {BRAND.reportTitle}. A screening estimate for
        early-stage site comparison — not a bankable energy assessment. See the
        methodology &amp; disclaimer on the final page.
      </p>
    </section>
  );
}
