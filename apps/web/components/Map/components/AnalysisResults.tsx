"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useState } from "react";
import LogisticsPlanner from "@/components/logistics/LogisticsPlanner";
import {
  readLogisticsSnapshot,
  patchLogisticsSnapshot,
} from "@/lib/logisticsPlannerStore";
import type {
  AnalysisResponse,
  Confidence,
  ContextData,
  IrrBand,
  ResourceData,
  ScoreComponent,
  ScoreRating,
  WindFinancials,
} from "@/lib/analysis/types";
import {
  LAYER_LABELS,
  fetchExclusionSources,
  type ExclusionSource,
} from "@/components/Map/utils/exclusions";
import { exportReport, type ExportPhase } from "@/components/Map/report/exportReport";
import { useSavedSites, saveSite } from "@/lib/savedSitesStore";
import { buildSavedSitePayload, SavedSiteLimitError } from "@/lib/savedSites";

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
  /** Committed AOI ring (lon/lat) — enables the PDF report export. */
  committedRing?: [number, number][] | null;
  /** Optional click-through from the nearest-mast row to the mast detail. */
  onMastSelect?: (mastId: string) => void;
  /** Pre-fill the logistics planner's turbine count (uploaded layout / single). */
  logisticsTurbineCount?: number;
  /** Override the logistics delivery-site label (layout / single turbine). */
  logisticsSiteName?: string | null;
  /** Remounts the logistics planner when the layout/turbine context changes. */
  logisticsContextKey?: string;
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
  resource: "Wind resource (CUF)",
  grid: "Grid access",
};

/**
 * Plain-language breakpoints shown in the methodology popover. These MIRROR
 * the server sub-scores in
 * apps/api/src/services/analysis/windScoring.ts — keep both in sync if either moves.
 */
const COMPONENT_METHOD: Record<ScoreComponent["key"], string> = {
  resource:
    "Capacity factor from @100 m wind speed (modern 120–140 m hub), scored via the anchor table — 0.34 CUF earns 0.42, rising to full credit at 0.46 CUF.",
  grid: "Line + substation distance — line full ≤2 km (0 at 40 km), substation full ≤5 km (0 at 80 km), blended 60/40. A missing distance scores 0.15.",
};

/** §A3 rating-band chip styling. */
const RATING_STYLE: Record<ScoreRating, string> = {
  Excellent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  Good: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  Moderate: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  Marginal: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  Poor: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

export function AnalysisResults({
  analysis,
  committedRing,
  onMastSelect,
  logisticsTurbineCount,
  logisticsSiteName,
  logisticsContextKey,
}: Props) {
  const { score, financials, irrBand, sections, aoi } = analysis;
  const resource = sections.resource.status === "ok" ? sections.resource.data : null;
  const validation = sections.validation.status === "ok" ? sections.validation.data : null;
  const grid = sections.grid.status === "ok" ? sections.grid.data : null;
  const context = sections.context.status === "ok" ? sections.context.data : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Primary actions, pinned to the top: save, export PDF, plan logistics.
          Same gating as before — save/export need the committed ring (+ a real
          resource for export); logistics always available off the centroid. */}
      <div className="flex flex-col gap-1.5">
        {committedRing && committedRing.length > 0 && (
          <SaveSiteButton
            key={`${aoi.centroid[0]},${aoi.centroid[1]},${aoi.areaKm2}`}
            analysis={analysis}
            ring={committedRing}
          />
        )}
        {resource && committedRing && committedRing.length > 0 && (
          <ExportReportButton ring={committedRing} />
        )}
        <PlanLogisticsButton
          key={logisticsContextKey ?? "aoi"}
          centroid={aoi.centroid}
          siteName={
            logisticsSiteName ??
            (context?.states?.[0]?.name ? `${context.states[0].name} site` : null)
          }
          numTurbines={logisticsTurbineCount}
        />
      </div>

      <ScoreHeader
        value={score.value}
        rating={score.rating}
        cuf={score.cuf}
        confidence={score.confidence}
        components={score.components}
      />

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

      {/* On-site inventory — what already stands in this AOI. Wind-farm count
          lives in the header badge + sizing %, so it is not repeated here. */}
      {context && (
        <SiteInventoryBlock
          turbines={context.turbines}
          mastCount={validation?.mastCountInAoi ?? 0}
        />
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
          <p className="mt-0.5">
            ~{context.sizing.usableKm2.toFixed(1)} km² developable
            {" "}({(context.sizing.developableFraction * 100).toFixed(0)}% of area)
          </p>
          {(context.sizing.excludedFraction != null ||
            context.sizing.steepFraction != null) && (
            <p className="mt-0.5 text-slate-400">
              {context.sizing.excludedFraction != null
                ? `${(context.sizing.excludedFraction * 100).toFixed(0)}% legal exclusions`
                : "exclusions unavailable"}
              {context.sizing.steepFraction != null &&
                ` · ${(context.sizing.steepFraction * 100).toFixed(0)}% too steep`}
            </p>
          )}
          {context.windfarms.overlapFraction > 0 && (
            <p className="mt-0.5">
              {(context.windfarms.overlapFraction * 100).toFixed(0)}% of the
              area overlaps existing wind farms (excluded from sizing).
            </p>
          )}
          {/* Reductions are multiplicative + spatially independent; where they
              coincide the developable area is a conservative under-estimate. */}
          {(context.sizing.excludedFraction != null &&
          context.sizing.excludedFraction > 0
            ? 1
            : 0) +
            (context.sizing.steepFraction != null &&
            context.sizing.steepFraction > 0
              ? 1
              : 0) +
            (context.windfarms.overlapFraction > 0 ? 1 : 0) >=
            2 && (
            <p className="mt-0.5 text-slate-500">
              Reductions are applied independently; where they overlap on the
              ground the developable area is a conservative estimate.
            </p>
          )}
          <ul className="mt-1 list-inside list-disc text-[10px] text-slate-500">
            {context.sizing.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Exclusion-zone breakdown — how much of the AOI is excluded, and for what */}
      {context && <ExclusionsBlock exclusions={context.exclusions} />}

      {/* Explicit placeholders for whatever didn't arrive */}
      {sections.climate.status === "unavailable" && <UnavailableNote label="Wind climate (rose, seasonality)" />}
      {sections.validation.status === "unavailable" && <UnavailableNote label="Mast validation" />}
      {sections.grid.status === "unavailable" && <UnavailableNote label="Grid proximity" />}
      {sections.context.status === "unavailable" && <UnavailableNote label="Site context & sizing" />}

      {/* Financial screening (methodology PART B) — independent of the score,
          shown last as the commercial read-out for the site. */}
      {financials ? (
        <FinancialsBlock financials={financials} irrBand={irrBand} />
      ) : (
        <UnavailableNote label="Financial screening" />
      )}

      <ReportDisclaimer />
    </div>
  );
}

// ── Save site (up to 3, for comparison in the Saved sites tab) ────────────────

/**
 * Saves the current AOI + a compact metric snapshot to the user's account (max
 * 3). Prompts for a name (defaulting to the first state + "site"), surfaces the
 * server-enforced limit, and confirms with a "Saved" state. Remounted per AOI
 * (keyed by the caller) so it never shows a stale "saved" for a new analysis.
 */
function SaveSiteButton({
  analysis,
  ring,
}: {
  analysis: AnalysisResponse;
  ring: [number, number][];
}) {
  const { sites, max } = useSavedSites();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const context =
    analysis.sections.context.status === "ok"
      ? analysis.sections.context.data
      : null;
  const defaultName = context?.states?.[0]?.name
    ? `${context.states[0].name} site`
    : `Site ${sites.length + 1}`;
  const atLimit = sites.length >= max;

  const begin = () => {
    setName(defaultName);
    setErr(null);
    setEditing(true);
  };

  const commit = async () => {
    if (busy) return; // re-entrancy guard: repeated Enter must not double-save
    const finalName = name.trim() || defaultName;
    setBusy(true);
    setErr(null);
    try {
      await saveSite(buildSavedSitePayload(finalName, ring, analysis));
      setSavedName(finalName);
      setEditing(false);
    } catch (e) {
      setErr(
        e instanceof SavedSiteLimitError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not save site",
      );
    } finally {
      setBusy(false);
    }
  };

  if (savedName) {
    return (
      <div className="mt-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
        Saved “{savedName}” — open the{" "}
        <span className="font-medium">Saved sites</span> tab to compare.
      </div>
    );
  }

  if (editing) {
    return (
      <div className="mt-1 rounded-lg border border-slate-700 bg-slate-800/60 p-2">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
          Name this site
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={80}
          autoFocus
          disabled={busy}
          aria-label="Site name"
          className="w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500/60 disabled:opacity-60"
        />
        {err && <p className="mt-1 text-[10px] text-red-300">{err}</p>}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void commit()}
            disabled={busy}
            className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={begin}
        disabled={atLimit}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200 transition-colors enabled:hover:border-emerald-400/70 enabled:hover:bg-emerald-500/20 disabled:opacity-60"
      >
        <BookmarkIcon className="h-3.5 w-3.5" />
        {atLimit
          ? `Saved sites full (${sites.length}/${max})`
          : `Save site (${sites.length}/${max})`}
      </button>
      {atLimit && (
        <p className="mt-1 text-[10px] text-slate-500">
          Delete one in the Saved sites tab to save another.
        </p>
      )}
      {err && <p className="mt-1 text-[10px] text-red-300">{err}</p>}
    </div>
  );
}

function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

// ── PDF report export button ──────────────────────────────────────────────────

/**
 * Two-phase export: captures the three maps offscreen, POSTs the AOI + images,
 * then downloads the streamed PDF. Owns its own progress state and blocks a
 * double-submit while a render is in flight (plan §7.2).
 */
function ExportReportButton({ ring }: { ring: [number, number][] }) {
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const busy = phase === "capturing" || phase === "rendering";

  const onClick = async () => {
    if (busy) return;
    setErr(null);
    try {
      await exportReport({ ring, onPhase: setPhase });
      setPhase("idle");
    } catch (e) {
      setPhase("error");
      setErr(e instanceof Error ? e.message : "Export failed");
    }
  };

  const label =
    phase === "capturing"
      ? "Capturing maps…"
      : phase === "rendering"
        ? "Rendering report…"
        : "Export report (PDF)";

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 transition-colors enabled:hover:border-sky-400/70 enabled:hover:bg-sky-500/20 disabled:opacity-60"
      >
        {busy ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-300/40 border-t-sky-200" />
        ) : (
          <DownloadIcon className="h-3.5 w-3.5" />
        )}
        {label}
      </button>
      {err && <p className="mt-1 text-[10px] text-red-300">{err}</p>}
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ── Plan turbine logistics (deep-link into /logistics) ────────────────────────

/**
 * Hands the AOI centroid to the Turbine Logistics Planner as the delivery site,
 * so the user can price ODC transport for this exact location without
 * re-entering coordinates. `centroid` is [lon, lat] (GeoJSON order). Both pages
 * live in the (portal) route group, so this is a smooth in-app navigation.
 */
export function PlanLogisticsButton({
  centroid,
  siteName,
  numTurbines,
}: {
  centroid: [number, number];
  siteName: string | null;
  /** Pre-fill the planner's turbine count (uploaded layout / single turbine). */
  numTurbines?: number;
}) {
  const [lon, lat] = centroid;
  // Cache the panel state per planning context so a pro-map tab switch + back
  // restores the expanded planner (and its computed plan) instead of resetting.
  // Same site + count ⇒ same key (survives unmount); a new AOI ⇒ a fresh key.
  const persistKey =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lon.toFixed(5)},${lat.toFixed(5)}|${numTurbines ?? ""}`
      : null;
  const [open, setOpen] = useState(
    () => (persistKey ? readLogisticsSnapshot(persistKey)?.open : false) ?? false,
  );
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (persistKey) patchLogisticsSnapshot(persistKey, { open: next });
  };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !persistKey) return null;
  const name = siteName ?? "Selected site";
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="logistics-inline"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-orange/40 bg-orange/10 px-3 py-2 text-xs font-medium text-orange transition-colors hover:border-orange/70 hover:bg-orange/20"
      >
        <TruckIcon className="h-3.5 w-3.5" />
        Plan turbine logistics
        <span aria-hidden className="ml-0.5">{open ? "▾" : "▸"}</span>
      </button>
      {!open && (
        <p className="mt-1 text-[10px] text-slate-500">
          ODC transport + cost for this site; routes plot on the map.
        </p>
      )}
      {open && (
        <div
          id="logistics-inline"
          className="mt-2 overflow-hidden rounded-lg border border-[#1f2c44] bg-[#0b0f19]"
        >
          <LogisticsPlanner
            initialDestination={{ lat, lon, name }}
            initialNumTurbines={numTurbines}
            embedded
            persistKey={persistKey}
            onRequestClose={() => {
              setOpen(false);
              patchLogisticsSnapshot(persistKey, { open: false });
            }}
          />
        </div>
      )}
    </div>
  );
}

function TruckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 17h4V5H2v12h3" />
      <path d="M14 9h4l3 3v5h-3" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
    </svg>
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
  rating,
  cuf,
  confidence,
  components,
}: {
  value: number;
  rating: ScoreRating;
  cuf: number | null;
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
          <span
            className={
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold " +
              RATING_STYLE[rating]
            }
          >
            {rating}
          </span>
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
          {cuf != null && (
            <li className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Capacity factor (CUF)</span>
              <span className="font-mono text-slate-200">
                {(cuf * 100).toFixed(1)}%
              </span>
            </li>
          )}
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

// ── Financial screening (methodology PART B) ─────────────────────────────────

/** Fraction → percent string; null → em dash (irr() returns null, never 0). */
const pct = (x: number | null): string =>
  x == null ? "—" : `${(x * 100).toFixed(1)}%`;

/** Area fraction → percent: keep one decimal for slivers (<1%) so a real but
 *  small exclusion never rounds to a misleading "0%". */
function areaPct(frac: number): string {
  const p = frac * 100;
  if (p <= 0) return "0%";
  if (p < 1) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

// ── Small "i" info toggle (inline disclosure) ────────────────────────────────

/** A small circled "i" that toggles an inline disclosure. Inline (not a
 *  floating popover) so it can never be clipped by the scrolling results panel. */
function InfoDot({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
      className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border text-[8px] font-bold italic leading-none transition-colors ${
        open
          ? "border-sky-400/60 bg-sky-400/10 text-sky-200"
          : "border-slate-500 text-slate-400 hover:border-slate-300 hover:text-slate-200"
      }`}
    >
      i
    </button>
  );
}

/** Plain-language summary of the PART B finance model (windFinance.ts). */
const FINANCE_METHODOLOGY: string[] = [
  "Levered project-finance pro-forma per 1 MW, CERC RE Tariff 2024 norms.",
  "Effective tariff = PPA floor + REC + TOD/merchant + carbon — the adders are what lift IRR above a bare PPA.",
  "75:25 debt:equity · 9.5% loan (15 yr) · 4.67%/yr depreciation (cap 90%) · MAT 17.47% → corporate 34.94% at year 20 · 8,766 h/yr.",
  "Equity IRR = levered post-tax return (headline); Project IRR = unlevered. Payback = first year cumulative equity cashflow ≥ 0.",
  "LCOE = (capex + discounted O&M) ÷ discounted energy — cost-side only, so it will not reconcile against the IRR.",
  "P10–P90 band = 4,000-run Monte Carlo over the published market spread (CAPEX/PPA/REC/TOD/CUF), not your edits.",
];

/** wce.source_registry.legal_tier → short label (migration 003). */
const LEGAL_TIER_LABEL: Record<number, string> = {
  1: "gazette",
  2: "official govt GIS",
  3: "official open data",
  4: "global third-party",
  5: "community / OSM",
  6: "derived buffer",
  7: "screening proxy",
};

// ── On-site inventory (existing turbines / farms / masts in the AOI) ──────────

/** "What already stands here" — physical turbines (wind_turbines) and
 *  measurement masts inside the AOI. Renders nothing when the area is empty on
 *  both counts. (Existing wind-farm count is shown by the header badge + sizing
 *  %, so it is intentionally not repeated here.) */
function SiteInventoryBlock({
  turbines,
  mastCount,
}: {
  turbines: ContextData["turbines"];
  mastCount: number;
}) {
  const turbineCount = turbines?.count ?? 0;
  if (turbineCount === 0 && mastCount === 0) return null;
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        On-site inventory
      </p>
      {turbines && turbineCount > 0 && (
        <p className="mt-1">
          <span className="text-slate-100">{turbineCount.toLocaleString()}</span>{" "}
          wind turbine{turbineCount === 1 ? "" : "s"} inside this area
          {turbines.ratedMw != null && (
            <span className="text-slate-400">
              {" "}· ~{turbines.ratedMw.toLocaleString()} MW rated
              {turbines.ratedCount < turbineCount &&
                ` (${turbines.ratedCount} of ${turbineCount} tagged)`}
            </span>
          )}
        </p>
      )}
      {mastCount > 0 && (
        <p className="mt-0.5">
          {mastCount} measurement mast{mastCount === 1 ? "" : "s"} inside this area
        </p>
      )}
    </div>
  );
}

// ── Exclusion-zone breakdown (how much of the AOI, and for what) ──────────────

/** Per-kind exclusion coverage of the AOI. Red = hard (no-go, drives the
 *  developable-area cut); amber = verify-before-use. Categories can overlap, so
 *  they may sum to more than the deduped red/amber totals — surfaced as a note. */
function ExclusionsBlock({ exclusions }: { exclusions: ContextData["exclusions"] }) {
  const [showSources, setShowSources] = useState(false);
  const [sources, setSources] = useState<ExclusionSource[] | null>(null);

  // Lazy-load the provenance registry only when the "i" is first opened.
  useEffect(() => {
    if (!showSources || sources !== null) return;
    let on = true;
    fetchExclusionSources()
      .then((rows) => on && setSources(rows))
      .catch(() => on && setSources([]));
    return () => {
      on = false;
    };
  }, [showSources, sources]);

  if (!exclusions) return <UnavailableNote label="Exclusion zones" />;

  const { redFraction, amberFraction, categories } = exclusions;
  const anyExcluded = redFraction > 0 || amberFraction > 0 || categories.length > 0;

  // Sources whose layer feeds a category present in this AOI; fall back to the
  // full registry if the layer_code mapping yields nothing.
  const presentCodes = new Set(categories.map((c) => c.layerCode));
  const relevantSources = (sources ?? []).filter(
    (s) => s.layer_code != null && presentCodes.has(s.layer_code),
  );
  const shownSources = relevantSources.length > 0 ? relevantSources : (sources ?? []);

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-xs text-slate-300">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Exclusion zones
        </p>
        <InfoDot
          open={showSources}
          onClick={() => setShowSources((v) => !v)}
          label="Exclusion data sources"
        />
      </div>
      {showSources && (
        <div className="mt-1.5 rounded-md border border-slate-700/60 bg-slate-900/50 p-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            Data sources
          </p>
          {sources === null ? (
            <p className="mt-1 text-[10px] text-slate-500">Loading sources…</p>
          ) : shownSources.length === 0 ? (
            <p className="mt-1 text-[10px] text-slate-500">
              Source registry unavailable.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {shownSources.map((s) => (
                <li key={s.source_id} className="leading-tight">
                  <span className="text-slate-300">
                    {s.authority ?? s.source_id}
                  </span>
                  <span className="text-slate-500">
                    {" "}· {LEGAL_TIER_LABEL[s.legal_tier] ?? `tier ${s.legal_tier}`} ·{" "}
                    {s.license}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!anyExcluded ? (
        <p className="mt-1 text-slate-400">No exclusion zones intersect this area.</p>
      ) : (
        <>
          <p className="mt-1">
            <span className="font-medium text-red-300">{areaPct(redFraction)}</span> hard (no-go)
            {amberFraction > 0 && (
              <>
                {" "}· <span className="font-medium text-amber-300">{areaPct(amberFraction)}</span>{" "}
                verify-before-use
              </>
            )}{" "}
            of area
          </p>
          {categories.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {categories.map((c) => (
                <li key={`${c.cls}:${c.layerCode}`} className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      c.cls === "red" ? "bg-red-500" : "bg-amber-500"
                    }`}
                  />
                  <span className="flex-1 text-slate-300">
                    {LAYER_LABELS[c.layerCode] ?? c.layerCode}
                  </span>
                  <span className="font-mono text-slate-400">{areaPct(c.fraction)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[10px] leading-tight text-slate-500">
            Kinds can overlap, so they may sum to more than the totals. Only hard
            (red) zones are removed from the developable area.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Per-MW pro-forma headline + Monte-Carlo IRR band. Independent of the score —
 * the two outputs share only the capacity factor (methodology rule §5). The
 * amber note flags that the tariff stack is placeholder config, not our terms.
 */
function FinancialsBlock({
  financials,
  irrBand,
}: {
  financials: WindFinancials;
  irrBand: IrrBand | null;
}) {
  const [showMethod, setShowMethod] = useState(false);
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            Financial screening · per MW
          </p>
          <InfoDot
            open={showMethod}
            onClick={() => setShowMethod((v) => !v)}
            label="Financial methodology"
          />
        </div>
        <p className="text-[10px] text-slate-500">
          tariff ₹{financials.effTariff.toFixed(2)}/kWh
        </p>
      </div>
      {showMethod && (
        <div className="mt-2 rounded-md border border-slate-700/60 bg-slate-900/50 p-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            How this is modelled
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-[10px] leading-snug text-slate-400">
            {FINANCE_METHODOLOGY.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat label="Equity IRR" value={pct(financials.irr)} sub="levered · headline" />
        <Stat label="Project IRR" value={pct(financials.projIrr)} sub="unlevered" />
        <Stat
          label="LCOE"
          value={financials.lcoe != null ? `₹${financials.lcoe.toFixed(2)}/kWh` : "—"}
        />
        <Stat
          label="Payback"
          value={financials.payback != null ? `${financials.payback} yr` : "—"}
        />
        <Stat label="NPV @10%" value={`₹${financials.npvCr.toFixed(2)} Cr`} />
        <Stat
          label="Annual energy"
          value={`${Math.round(financials.annualMwh).toLocaleString()} MWh`}
        />
      </div>
      {irrBand && (
        <div className="mt-2 border-t border-slate-700/60 pt-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Equity-IRR band · {irrBand.n.toLocaleString()} Monte-Carlo runs
          </p>
          <p className="mt-1 font-mono text-[12px] text-slate-200">
            P50 {pct(irrBand.p50)}
            <span className="ml-2 text-slate-400">
              likely {pct(irrBand.p25)}–{pct(irrBand.p75)}
            </span>
          </p>
          <p className="text-[10px] text-slate-500">
            envelope {pct(irrBand.p10)}–{pct(irrBand.p90)} (P10–P90)
          </p>
        </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-amber-300/80">
        Placeholder CERC-2024 tariff stack (PPA ₹3.50 + REC + TOD + carbon = ₹
        {financials.effTariff.toFixed(2)}). Ground in real PPA / offtake terms
        before quoting IRR.
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

