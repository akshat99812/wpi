"use client";

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

      {resource?.indiaPercentile != null && (
        <PercentileBar pct={resource.indiaPercentile} />
      )}

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
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
        aria-expanded={expanded}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-white">
            {value}
          </span>
          <span className="text-xs text-slate-400">/ 100 screening score</span>
        </div>
        <span
          className={
            "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
            CONFIDENCE_STYLE[confidence]
          }
        >
          {confidence}
        </span>
      </button>
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

// ── India percentile context bar ─────────────────────────────────────────────

function PercentileBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        vs. all of India
      </p>
      <div className="relative mt-1.5 h-2 rounded-full bg-slate-700/60">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500 to-orange-400"
          style={{ width: `${clamped}%` }}
        />
        <div
          className="absolute -top-0.5 h-3 w-0.5 rounded bg-white"
          style={{ left: `${clamped}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-300">
        Windier than {Math.round(clamped)}% of India&apos;s land area
      </p>
    </div>
  );
}
