"use client";

import React from "react";
import type { PointReport } from "@/lib/analysis/types";
import type { TurbinePoint } from "@/lib/analysis/layout";
import type { PointUiState } from "@/components/Map/hooks/useAoiAnalysis";
import { LAYER_LABELS } from "@/components/Map/utils/exclusions";
import { PlanLogisticsButton } from "./AnalysisResults";

/**
 * Exact-point screening card for a single clicked turbine in an uploaded
 * micro-sited layout. Shows the wind resource, elevation, nearest mast, grid
 * proximity, and exclusion-zone status AT the turbine's coordinate (no area
 * averaging), plus a one-click logistics plan for that single turbine.
 *
 * The "← Back to site" control lives in AnalyzeTool's banner above this card.
 */

interface Props {
  turbine: TurbinePoint;
  report: PointReport | null;
  uiState: PointUiState;
  error: string | null;
}

export function TurbinePointCard({ turbine, report, uiState, error }: Props) {
  const label = turbine.name || "Turbine";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
        <p className="text-sm font-semibold text-slate-100">{label}</p>
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
          {turbine.lat.toFixed(5)}, {turbine.lon.toFixed(5)}
        </p>
      </div>

      {uiState === "loading" && (
        <div className="rounded-lg border border-slate-700/70 bg-slate-800/50 px-3 py-2.5">
          <p className="font-mono text-[12px] tabular-nums text-sky-200">
            SCREENING TURBINE…
          </p>
          <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-slate-500">
            WIND · GRID · MAST · EXCLUSIONS
          </p>
        </div>
      )}

      {uiState === "error" && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span className="mr-1.5 font-mono text-[10px] tracking-[0.18em] text-red-400">
            ▲ FAULT
          </span>
          {error ?? "Turbine analysis could not run."}
        </div>
      )}

      {uiState === "ok" && report && <PointBody report={report} />}

      {/* Plan ODC logistics for THIS single turbine (exact coordinate). */}
      <PlanLogisticsButton
        centroid={[turbine.lon, turbine.lat]}
        siteName={label}
        numTurbines={1}
      />
    </div>
  );
}

function PointBody({ report }: { report: PointReport }) {
  const { resource, validation, grid, exclusion } = report;
  return (
    <div className="flex flex-col gap-3">
      {resource ? (
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Mean wind @100 m" value={`${resource.meanSpeed.toFixed(2)} m/s`} />
          <Stat
            label="Capacity factor (IEC-III)"
            value={resource.cfIec3 != null ? `${(resource.cfIec3 * 100).toFixed(1)}%` : "—"}
            sub={resource.cfIec2 != null ? `IEC-II: ${(resource.cfIec2 * 100).toFixed(1)}%` : undefined}
          />
          <Stat
            label="Power density"
            value={resource.powerDensity != null ? `${Math.round(resource.powerDensity)} W/m²` : "—"}
            sub={
              resource.powerDensityRaw != null && resource.airDensity != null
                ? `raw ${Math.round(resource.powerDensityRaw)} · ρ ${resource.airDensity.toFixed(3)}`
                : undefined
            }
          />
          <Stat
            label="Shear α"
            value={resource.shearAlpha != null ? resource.shearAlpha.toFixed(2) : "—"}
            sub={
              resource.ws50 != null && resource.ws150 != null
                ? `${resource.ws50.toFixed(1)}–${resource.ws150.toFixed(1)} m/s (50–150 m)`
                : undefined
            }
          />
          <Stat
            label="Elevation"
            value={resource.elevationM != null ? `${resource.elevationM.toLocaleString()} m` : "—"}
          />
        </div>
      ) : (
        <Unavailable label="Wind resource" />
      )}

      {/* Nearest met mast */}
      {validation?.nearestMast ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
          <p>
            <span className="font-medium text-slate-200">{validation.nearestMast.station}</span>{" "}
            mast · {validation.nearestMast.distanceKm.toFixed(1)} km ·{" "}
            {validation.nearestMast.maws.toFixed(2)} m/s @ {validation.nearestMast.heightM} m
          </p>
          {validation.modelDeltaPct != null && (
            <p className="mt-0.5 text-slate-400">
              Model runs {validation.modelDeltaPct > 0 ? "+" : ""}
              {validation.modelDeltaPct.toFixed(1)}% vs measurement near this turbine
            </p>
          )}
        </div>
      ) : (
        <Unavailable label="Nearest mast" />
      )}

      {/* Grid proximity */}
      {grid ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
          {grid.nearestSubstation ? (
            <p>
              Nearest substation:{" "}
              <span className="text-slate-100">{grid.nearestSubstation.name ?? "unnamed"}</span>{" "}
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
          <p className="mt-1">
            <span
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                (grid.ehvWithin25Km
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-slate-500/15 text-slate-300 border-slate-500/40")
              }
            >
              {grid.ehvWithin25Km ? "EHV grid ≤ 25 km" : "no EHV within 25 km"}
            </span>
          </p>
          <p className="mt-1 text-[10px] text-slate-500">{grid.dataNote}</p>
        </div>
      ) : (
        <Unavailable label="Grid proximity" />
      )}

      {/* Exclusion-zone status at the exact point */}
      {exclusion ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Exclusion status
          </p>
          {!exclusion.inExclusion ? (
            <p className="mt-1 text-emerald-300">
              Clear — the turbine is not inside any mapped exclusion zone.
            </p>
          ) : (
            <>
              <p className="mt-1">
                {exclusion.hardHit ? (
                  <span className="font-medium text-red-300">Inside a hard (no-go) exclusion.</span>
                ) : (
                  <span className="font-medium text-amber-300">
                    Inside a verify-before-use exclusion.
                  </span>
                )}
              </p>
              <ul className="mt-1.5 space-y-1">
                {exclusion.hits.map((h) => (
                  <li key={`${h.cls}:${h.layerCode}`} className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 flex-shrink-0 rounded-full ${
                        h.cls === "red" ? "bg-red-500" : "bg-amber-500"
                      }`}
                    />
                    <span className="flex-1 text-slate-300">
                      {LAYER_LABELS[h.layerCode] ?? h.layerCode}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <Unavailable label="Exclusion zones" />
      )}
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

function Unavailable({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700/70 px-3 py-2 text-[11px] text-slate-500">
      {label}: unavailable for this turbine.
    </div>
  );
}
