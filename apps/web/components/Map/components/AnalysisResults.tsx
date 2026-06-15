"use client";

import Image from "next/image";
import React, { useMemo, useState } from "react";
import type {
  AnalysisResponse,
  Confidence,
  ResourceData,
  ScoreComponent,
} from "@/lib/analysis/types";

/**
 * Results panel for a completed site analysis (plan §4 Phase 4 layout):
 * score header → stat grid → badges → charts → per-section placeholders →
 * assumptions + attribution footer. Sections that arrived "unavailable"
 * render an explicit placeholder, never an empty hole.
 *
 * The "90% of site area exceeds X m/s" figure is a STAT LINE by design —
 * never charted (plan hard rule).
 */

interface Props {
  analysis: AnalysisResponse;
  /** Optional click-through from the nearest-mast row to the mast detail. */
  onMastSelect?: (mastId: string) => void;
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  low: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

const SITE_CLASS_STYLE: Record<string, string> = {
  excellent: "bg-red-500/15 text-red-300 border-red-500/40",
  good: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  moderate: "bg-yellow-500/15 text-yellow-200 border-yellow-500/40",
  marginal: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

const COMPONENT_LABEL: Record<ScoreComponent["key"], string> = {
  resource: "Wind resource",
  cf: "Capacity factor",
  grid: "Grid access",
  terrain: "Terrain",
};

/**
 * Plain-language breakpoints shown in the methodology popover. These MIRROR
 * the server normalization ramps in
 * apps/api/src/services/analysis/score.ts — keep both in sync if either moves.
 */
const COMPONENT_METHOD: Record<ScoreComponent["key"], string> = {
  resource: "Mean wind speed @100 m — 0 pts at ≤4.5 m/s, rising to full at ≥7.5 m/s.",
  cf: "IEC-III capacity factor — 0 pts at ≤0.12, rising to full at ≥0.38.",
  grid: "Distance to EHV grid — full credit at ≤10 km, falling to 0 at ≥50 km.",
  terrain: "90th-percentile slope — full credit at ≤5°, falling to 0 at ≥20°.",
};

export function AnalysisResults({ analysis, onMastSelect }: Props) {
  const { score, sections, aoi } = analysis;
  const resource = sections.resource.status === "ok" ? sections.resource.data : null;
  const validation = sections.validation.status === "ok" ? sections.validation.data : null;
  const grid = sections.grid.status === "ok" ? sections.grid.data : null;
  const context = sections.context.status === "ok" ? sections.context.data : null;

  return (
    <div className="flex flex-col gap-3">
      <ScoreHeader value={score.value} confidence={score.confidence} components={score.components} />

      <p className="text-[11px] text-slate-500">
        {aoi.areaKm2.toFixed(1)} km²
        {aoi.isPointMode ? " · 5×5 km point analysis" : ""}
      </p>

      {resource ? (
        <ResourceBlock resource={resource} />
      ) : (
        <UnavailableNote label="Wind resource" />
      )}

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {resource && (
          <Badge className={SITE_CLASS_STYLE[resource.siteClass]}>
            {resource.siteClass} site
          </Badge>
        )}
        {grid && (
          <Badge
            className={
              grid.ehvWithin25Km
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                : "bg-slate-500/15 text-slate-300 border-slate-500/40"
            }
          >
            {grid.ehvWithin25Km ? "EHV grid ≤ 25 km" : "no EHV within 25 km"}
          </Badge>
        )}
        {context && context.windfarms.count > 0 && (
          <Badge className="bg-sky-500/15 text-sky-300 border-sky-500/40">
            {context.windfarms.count} farm{context.windfarms.count > 1 ? "s" : ""} already here
          </Badge>
        )}
        {validation && (
          <Badge className={CONFIDENCE_STYLE[validation.confidence]}>
            validation: {validation.confidence}
          </Badge>
        )}
      </div>

      {resource?.weibull && (
        <WeibullChart A={resource.weibull.A} k={resource.weibull.k} mean={resource.meanSpeed} />
      )}

      {resource && <SpatialSpreadChart resource={resource} />}

      {/* Validation row */}
      {validation?.nearestMast && (
        <button
          type="button"
          onClick={
            onMastSelect ? () => onMastSelect(validation.nearestMast!.id) : undefined
          }
          disabled={!onMastSelect}
          className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-left text-xs text-slate-300 transition-colors enabled:hover:border-sky-500/40 enabled:hover:bg-slate-800"
        >
          <span className="font-medium text-slate-200">
            {validation.nearestMast.station}
          </span>{" "}
          mast · {validation.nearestMast.distanceKm.toFixed(1)} km ·{" "}
          {validation.nearestMast.maws.toFixed(2)} m/s @{" "}
          {validation.nearestMast.heightM} m
          {validation.modelDeltaPct != null && (
            <span className="mt-0.5 block text-slate-400">
              Model runs {validation.modelDeltaPct > 0 ? "+" : ""}
              {validation.modelDeltaPct.toFixed(1)}% vs measurement near this site
            </span>
          )}
        </button>
      )}

      {/* Grid row */}
      {grid && (
        <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
          {grid.nearestSubstation ? (
            <p>
              Nearest substation:{" "}
              <span className="text-slate-100">
                {grid.nearestSubstation.name ?? "unnamed"}
              </span>{" "}
              ({grid.nearestSubstation.voltageKv != null ? `${grid.nearestSubstation.voltageKv} kV` : "unknown kV"}) ·{" "}
              {grid.nearestSubstation.distanceKm.toFixed(1)} km
            </p>
          ) : (
            <p>No substation found within search range.</p>
          )}
          {grid.nearestLine && (
            <p className="mt-0.5">
              Nearest line:{" "}
              {grid.nearestLine.voltageKv != null ? `${grid.nearestLine.voltageKv} kV` : "unknown kV"} ·{" "}
              {grid.nearestLine.distanceKm.toFixed(1)} km
            </p>
          )}
          <p className="mt-1 text-[10px] text-slate-500">{grid.dataNote}</p>
        </div>
      )}

      {/* Sizing */}
      {context && (
        <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
          <p className="text-slate-100">
            Indicative sizing: ~{Math.round(context.sizing.capacityMw)} MW ·{" "}
            ~{Math.round(context.sizing.energyGwh)} GWh/yr
          </p>
          {context.windfarms.overlapFraction > 0 && (
            <p className="mt-0.5">
              {(context.windfarms.overlapFraction * 100).toFixed(0)}% of the
              area overlaps existing wind farms (excluded from sizing).
            </p>
          )}
          <ul className="mt-1 list-inside list-disc text-[10px] text-slate-500">
            {context.sizing.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Explicit placeholders for whatever didn't arrive */}
      {sections.climate.status === "unavailable" && <UnavailableNote label="Wind climate (rose, seasonality)" />}
      {sections.validation.status === "unavailable" && <UnavailableNote label="Mast validation" />}
      {sections.grid.status === "unavailable" && <UnavailableNote label="Grid proximity" />}
      {sections.context.status === "unavailable" && <UnavailableNote label="Site context & sizing" />}

      <ReportDisclaimer />
    </div>
  );
}

// ── Report disclaimer + CECL contact card ────────────────────────────────────

function ReportDisclaimer() {
  return (
    <div className="mt-1 space-y-3 rounded-lg border border-slate-700/60 bg-slate-800/30 px-3 py-3">
      <div className="flex items-center gap-2.5">
        <Image
          src="/logo.png"
          alt="CECL"
          width={36}
          height={36}
          className="h-9 w-9 flex-shrink-0 object-contain"
        />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-200">CECL Advisory</p>
          <p className="text-[10px] text-slate-500">
            Consolidated Energy Consultants Limited
          </p>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        Screening estimate for early-stage site comparison only — not a bankable
        energy assessment. Contact CECL for bankable reports.
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
        <dt className="text-slate-500">Email</dt>
        <dd>
          <a
            href="mailto:info@cecl.in"
            className="text-slate-300 underline decoration-slate-600 underline-offset-2 hover:text-white"
          >
            info@cecl.in
          </a>
        </dd>

        <dt className="text-slate-500">Alt. Email</dt>
        <dd>
          <a
            href="mailto:conenergy@gmail.com"
            className="text-slate-300 underline decoration-slate-600 underline-offset-2 hover:text-white"
          >
            conenergy@gmail.com
          </a>
        </dd>

        <dt className="text-slate-500">Phone</dt>
        <dd>
          <a href="tel:+9107552600241" className="text-slate-300 hover:text-white">
            +91-0755-2600241
          </a>
        </dd>

        <dt className="text-slate-500">Phone</dt>
        <dd>
          <a href="tel:+9107554058931" className="text-slate-300 hover:text-white">
            +91-0755-4058931
          </a>
        </dd>

        <dt className="text-slate-500">Office</dt>
        <dd className="text-slate-400">
          ‘Energy Tower’, 64-B Sector, Kasturba Nagar, Bhopal 462023, Madhya
          Pradesh, India
        </dd>
      </dl>
    </div>
  );
}

// ── Score header ─────────────────────────────────────────────────────────────

function ScoreHeader({
  value,
  confidence,
  components,
}: {
  value: number;
  confidence: Confidence;
  components: ScoreComponent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-baseline gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className="text-3xl font-semibold tracking-tight text-white">
            {value}
          </span>
          <span className="text-xs text-slate-400">/ 100 screening score</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMethod((v) => !v)}
            className={
              "grid h-5 w-5 place-items-center rounded-full border text-[11px] font-semibold italic transition " +
              (showMethod
                ? "border-sky-400/70 text-sky-300"
                : "border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200")
            }
            aria-expanded={showMethod}
            aria-label="How the screening score is calculated"
            title="How the screening score is calculated"
          >
            i
          </button>
          <span
            className={
              "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
              CONFIDENCE_STYLE[confidence]
            }
          >
            {confidence}
          </span>
        </div>
      </div>
      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-slate-700/60 pt-2">
          {components.map((c) => (
            <li key={c.key} className="flex items-center justify-between text-xs">
              <span className="text-slate-400">
                {COMPONENT_LABEL[c.key]}
                <span className="ml-1 text-slate-600">w{c.weight}</span>
              </span>
              <span className="font-mono text-slate-200">
                {c.points.toFixed(1)} pts
                {c.raw == null && (
                  <span className="ml-1 text-slate-500">(no data)</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showMethod && <ScoreMethodology components={components} />}
    </div>
  );
}

/**
 * "How the score works" popover (toggled by the ⓘ button). Explains the
 * weighted-sum formula and the per-factor breakpoints (COMPONENT_METHOD,
 * which mirrors the server ramps), and clarifies that the confidence chip
 * never feeds the score.
 */
function ScoreMethodology({ components }: { components: ScoreComponent[] }) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-700/60 pt-2 text-[11px] leading-relaxed text-slate-400">
      <p>
        A 0–100 screening score. Each factor is scored 0–1 on a linear ramp
        between the breakpoints below, multiplied by its weight, then summed.
      </p>
      <ul className="space-y-1.5">
        {components.map((c) => (
          <li key={c.key}>
            <span className="font-medium text-slate-300">
              {COMPONENT_LABEL[c.key]}
            </span>
            <span className="ml-1 text-slate-500">· weight {c.weight}</span>
            <div className="text-slate-400">{COMPONENT_METHOD[c.key]}</div>
          </li>
        ))}
      </ul>
      <p className="text-slate-500">
        Breakpoints are calibrated to India&apos;s wind distribution, so the
        windiest ~2% of sites approach a full resource score. The confidence
        chip reflects met-mast validation only and never affects the score.
      </p>
    </div>
  );
}

// ── Resource stat grid ───────────────────────────────────────────────────────

function ResourceBlock({ resource }: { resource: ResourceData }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Mean wind @100 m" value={`${resource.meanSpeed.toFixed(2)} m/s`} />
        <Stat
          label="Capacity factor (IEC-III)"
          value={
            resource.cfIec3 != null
              ? `${(resource.cfIec3 * 100).toFixed(1)}%`
              : "—"
          }
          sub={
            resource.cfIec2 != null
              ? `IEC-II: ${(resource.cfIec2 * 100).toFixed(1)}%`
              : undefined
          }
        />
        <Stat
          label="Power density (corrected)"
          value={
            resource.powerDensity != null
              ? `${Math.round(resource.powerDensity)} W/m²`
              : "—"
          }
          sub={
            resource.powerDensityRaw != null
              ? `raw ${Math.round(resource.powerDensityRaw)} · ρ ${resource.airDensity.toFixed(3)}`
              : undefined
          }
        />
        <Stat label="Shear α" value={resource.shearAlpha.toFixed(2)} />
        <Stat
          label="Speed spread (p25–p75)"
          value={`${resource.p25Speed.toFixed(1)}–${resource.p75Speed.toFixed(1)} m/s`}
          sub={`median ${resource.p50Speed.toFixed(1)} · range ${resource.minSpeed.toFixed(1)}–${resource.maxSpeed.toFixed(1)}`}
        />
        <Stat
          label="Area coverage"
          value={`90% > ${resource.areaExceedance90.toFixed(1)} m/s`}
          sub="of site area exceeds this speed"
        />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-[13px] text-slate-100">{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={
        "rounded-full border px-2 py-0.5 text-[10px] font-medium " + (className ?? "")
      }
    >
      {children}
    </span>
  );
}

function UnavailableNote({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700/70 px-3 py-2 text-[11px] text-slate-500">
      {label}: unavailable for this run.
    </div>
  );
}

// ── Weibull speed-distribution curve (pure SVG) ──────────────────────────────

const CHART_W = 272;
const CHART_H = 96;
const CHART_PAD = 8;
const WEIBULL_X_MAX_MS = 20;

function weibullPdf(v: number, A: number, k: number): number {
  if (v < 0 || A <= 0 || k <= 0) return 0;
  return (k / A) * Math.pow(v / A, k - 1) * Math.exp(-Math.pow(v / A, k));
}

function WeibullChart({ A, k, mean }: { A: number; k: number; mean: number }) {
  const { path, meanX } = useMemo(() => {
    const n = 80;
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) {
      ys.push(weibullPdf((i / n) * WEIBULL_X_MAX_MS, A, k));
    }
    const yMax = Math.max(...ys, 1e-9);
    const pts = ys.map((y, i) => {
      const x = CHART_PAD + (i / n) * (CHART_W - 2 * CHART_PAD);
      const yy = CHART_H - CHART_PAD - (y / yMax) * (CHART_H - 2 * CHART_PAD);
      return `${x.toFixed(1)},${yy.toFixed(1)}`;
    });
    return {
      path: `M${pts.join(" L")}`,
      meanX:
        CHART_PAD + (Math.min(mean, WEIBULL_X_MAX_MS) / WEIBULL_X_MAX_MS) * (CHART_W - 2 * CHART_PAD),
    };
  }, [A, k, mean]);

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-2.5 py-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
        Wind speed distribution (Weibull A={A.toFixed(1)}, k={k.toFixed(2)})
      </p>
      <svg width={CHART_W} height={CHART_H} className="max-w-full" role="img"
        aria-label={`Weibull wind speed distribution, mean ${mean.toFixed(1)} m/s`}>
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.8" />
        <line
          x1={meanX} y1={CHART_PAD} x2={meanX} y2={CHART_H - CHART_PAD}
          stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 2"
        />
        <text
          x={Math.min(meanX + 4, CHART_W - 56)} y={CHART_PAD + 10}
          fill="#f59e0b" fontSize="9"
        >
          mean {mean.toFixed(1)} m/s
        </text>
        <text x={CHART_PAD} y={CHART_H - 1} fill="#64748b" fontSize="8">0</text>
        <text x={CHART_W - CHART_PAD - 18} y={CHART_H - 1} fill="#64748b" fontSize="8">
          {WEIBULL_X_MAX_MS} m/s
        </text>
      </svg>
    </div>
  );
}

// ── Spatial speed-spread strip (pure SVG) ────────────────────────────────────

// Fixed m/s window so a tight LOW site reads as genuinely small near the left,
// never auto-zoomed to fill the card (which would make a poor site look healthy
// and identical to a wide-spread one). Keeps spreads comparable across AOIs.
const SPREAD_CHART_H = 88;
const SPREAD_AXIS_MIN = 3;
const SPREAD_AXIS_MAX = 12;
const SPREAD_MIN_BOX_PX = 6; // floor so a degenerate IQR (p25 ≈ p75) stays visible
const SPREAD_TIGHT_MS = 0.3; // (p75 − p25) below this ⇒ "tight spread"
const SPREAD_WIDE_MS = 1.0; //  (p75 − p25) ≥ this ⇒ "varies across site"
const SPREAD_AXIS_TICKS = [3, 6, 9];

/**
 * Horizontal box-and-whisker of the AOI's SPATIAL wind-speed spread — per-pixel
 * order statistics (min · p25–p75 IQR box · median · max whiskers) with a dashed
 * amber spatial-mean tick. Complements WeibullChart, which shows the modeled
 * TEMPORAL distribution from {A, k}: this shows how speed varies across the
 * site's area (micro-siting uniformity), a different question and data source.
 *
 * Fixed 3–12 m/s axis (never auto-zoomed) keeps magnitude honest. The
 * areaExceedance90 figure is intentionally NOT charted (plan hard rule — it is
 * a stat line only; see the file-header note).
 */
function SpatialSpreadChart({ resource }: { resource: ResourceData }) {
  const {
    minSpeed: min,
    p25Speed: p25,
    p50Speed: p50,
    p75Speed: p75,
    maxSpeed: max,
    meanSpeed: mean,
  } = resource;

  const geom = useMemo(() => {
    const plotLeft = CHART_PAD;
    const plotRight = CHART_W - CHART_PAD;
    const plotW = plotRight - plotLeft;
    const xOf = (v: number) => {
      const c = Math.min(SPREAD_AXIS_MAX, Math.max(SPREAD_AXIS_MIN, v));
      return plotLeft + ((c - SPREAD_AXIS_MIN) / (SPREAD_AXIS_MAX - SPREAD_AXIS_MIN)) * plotW;
    };
    // Guard out-of-order percentiles (bad data) without masking a real bug:
    // order the quartiles and clamp the median between them.
    const q1 = Math.min(p25, p75);
    const q3 = Math.max(p25, p75);
    const med = Math.min(q3, Math.max(q1, p50));
    const xP25 = xOf(q1);
    const xP75 = xOf(q3);
    const isFloored = xP75 - xP25 < SPREAD_MIN_BOX_PX;
    const xP50 = xOf(med);
    const iqr = q3 - q1;
    return {
      plotLeft,
      plotRight,
      xOf,
      xMin: xOf(min),
      xMax: xOf(max),
      xP50,
      xMean: xOf(mean),
      boxL: isFloored ? xP50 - SPREAD_MIN_BOX_PX / 2 : xP25,
      boxR: isFloored ? xP50 + SPREAD_MIN_BOX_PX / 2 : xP75,
      isFloored,
      verdict:
        iqr < SPREAD_TIGHT_MS
          ? '· tight spread'
          : iqr >= SPREAD_WIDE_MS
            ? '· varies across site'
            : '',
    };
  }, [min, p25, p50, p75, max, mean]);

  // Empty AOI ⇒ resource.ts writes NaN to these; show a note, not a broken SVG.
  if (![min, p25, p50, p75, max, mean].every(Number.isFinite)) {
    return <UnavailableNote label="Spatial speed spread" />;
  }

  const { plotLeft, plotRight, xOf, xMin, xMax, xP50, xMean, boxL, boxR, isFloored, verdict } = geom;
  const laneY = 30;
  const boxHalfH = 9;
  const capHalfH = 6;
  const axisY = 66;

  // Edge-aware anchor so the min/max numeric caps never clip the 272px card.
  // `preferred` lets near-colliding caps fan apart instead of stacking.
  const capAt = (
    x: number,
    preferred: 'start' | 'middle' | 'end' = 'middle',
  ): { x: number; anchor: 'start' | 'middle' | 'end' } =>
    x < plotLeft + 10
      ? { x: plotLeft, anchor: 'start' }
      : x > plotRight - 10
        ? { x: plotRight, anchor: 'end' }
        : { x, anchor: preferred };
  // A near-uniform AOI (min ≈ max) would stack the two numeric caps: collapse
  // to one centred label when they round equal, else fan them apart.
  const capsSameLabel = min.toFixed(1) === max.toFixed(1);
  const capsClose = !capsSameLabel && Math.abs(xMax - xMin) < 14;
  const minCap = capAt(xMin, capsClose ? 'end' : 'middle');
  const maxCap = capAt(xMax, capsClose ? 'start' : 'middle');
  const showMeanLabel = Math.abs(xMean - xP50) >= 14; // only when skew is visible
  const meanLabelX = Math.min(plotRight - 18, Math.max(plotLeft + 18, xMean));

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-2.5 py-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
        Spatial speed spread
        <span className="ml-1 normal-case text-slate-600">{verdict}</span>
      </p>
      <svg
        width={CHART_W}
        height={SPREAD_CHART_H}
        className="max-w-full"
        role="img"
        aria-label={`Spatial wind speed spread across the AOI: median ${p50.toFixed(1)} m/s, interquartile ${p25.toFixed(1)} to ${p75.toFixed(1)} m/s, range ${min.toFixed(1)} to ${max.toFixed(1)} m/s`}
      >
        {/* Axis baseline + fixed-domain ticks */}
        <line x1={plotLeft} y1={axisY} x2={plotRight} y2={axisY} stroke="#334155" strokeWidth="1" />
        {SPREAD_AXIS_TICKS.map((t) => (
          <g key={t}>
            <line x1={xOf(t)} y1={axisY} x2={xOf(t)} y2={axisY + 3} stroke="#475569" strokeWidth="1" />
            <text x={xOf(t)} y={axisY + 13} fill="#64748b" fontSize="8" textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <text x={plotRight} y={axisY + 13} fill="#64748b" fontSize="8" textAnchor="end">
          12 m/s
        </text>

        {/* Whisker spine (skip when zero-length) + end caps / clamp chevrons */}
        {xMax - xMin >= 0.05 && (
          <line x1={xMin} y1={laneY} x2={xMax} y2={laneY} stroke="#64748b" strokeWidth="1" />
        )}
        {min <= SPREAD_AXIS_MIN ? (
          <text x={xMin} y={laneY + 3.5} fill="#64748b" fontSize="10" textAnchor="middle">
            ‹
          </text>
        ) : (
          <line x1={xMin} y1={laneY - capHalfH} x2={xMin} y2={laneY + capHalfH} stroke="#64748b" strokeWidth="1" />
        )}
        {max >= SPREAD_AXIS_MAX ? (
          <text x={xMax} y={laneY + 3.5} fill="#64748b" fontSize="10" textAnchor="middle">
            ›
          </text>
        ) : (
          <line x1={xMax} y1={laneY - capHalfH} x2={xMax} y2={laneY + capHalfH} stroke="#64748b" strokeWidth="1" />
        )}

        {/* IQR box (dashed when floored to the minimum width) */}
        <rect
          x={boxL}
          y={laneY - boxHalfH}
          width={boxR - boxL}
          height={2 * boxHalfH}
          rx="2"
          fill="#38bdf8"
          fillOpacity="0.18"
          stroke="#38bdf8"
          strokeWidth="1.2"
          strokeDasharray={isFloored ? '3 2' : undefined}
        />
        {/* Median tick (brightest) */}
        <line x1={xP50} y1={laneY - boxHalfH} x2={xP50} y2={laneY + boxHalfH} stroke="#38bdf8" strokeWidth="2" />
        {/* Spatial-mean tick — amber dashed, matching WeibullChart's mean convention */}
        <line
          x1={xMean}
          y1={laneY - boxHalfH - 3}
          x2={xMean}
          y2={laneY + boxHalfH + 3}
          stroke="#f59e0b"
          strokeWidth="1"
          strokeDasharray="3 2"
        />

        {/* Min / max numeric caps (carry absolute magnitude). A near-uniform
            AOI collapses them to a single centred label. */}
        {capsSameLabel ? (
          <text x={(xMin + xMax) / 2} y={laneY - capHalfH - 4} fill="#64748b" fontSize="8" textAnchor="middle">
            {min.toFixed(1)}
          </text>
        ) : (
          <>
            <text x={minCap.x} y={laneY - capHalfH - 4} fill="#64748b" fontSize="8" textAnchor={minCap.anchor}>
              {min.toFixed(1)}
            </text>
            <text x={maxCap.x} y={laneY - capHalfH - 4} fill="#64748b" fontSize="8" textAnchor={maxCap.anchor}>
              {max.toFixed(1)}
            </text>
          </>
        )}
        {/* Mean label only when visibly separated from the median */}
        {showMeanLabel && (
          <text x={meanLabelX} y={52} fill="#f59e0b" fontSize="9" textAnchor="middle">
            mean {mean.toFixed(1)}
          </text>
        )}
      </svg>
    </div>
  );
}

