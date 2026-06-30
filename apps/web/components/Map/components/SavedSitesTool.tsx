"use client";

import React, { useEffect, useState } from "react";
import { useSavedSites, removeSite, renameSite } from "@/lib/savedSitesStore";
import {
  useShownSavedSites,
  toggleShownSavedSite,
  hideShownSavedSite,
  clearShownSavedSites,
  reconcileShownSavedSites,
} from "@/lib/savedSitesMapStore";
import type { SavedSite, SavedSiteSummary } from "@/lib/savedSites";

/**
 * "Saved sites" tool tab for the Pro map. Lists the user's saved AOIs (max 3),
 * lets them open one back onto the map (re-runs the analysis), rename or delete
 * it, and — the headline feature — compares all saved sites side-by-side in a
 * metric table with the best value per row highlighted.
 *
 * All data comes from the shared savedSitesStore (one fetch, shared with the
 * "Save site" button in the analysis results).
 */

export function SavedSitesTool({
  onOpenSite,
}: {
  /** Load a saved site's ring back onto the map + re-run its analysis. */
  onOpenSite: (site: SavedSite) => void;
}) {
  const { sites, max, loading, error, refresh } = useSavedSites();
  const shown = useShownSavedSites();
  const shownIds = new Set(shown.map((s) => s.id));

  // Keep the on-map overlay in sync with the list: drop outlines for deleted
  // sites and refresh renamed labels.
  useEffect(() => {
    reconcileShownSavedSites(sites);
  }, [sites]);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.18em]">
        <span className="text-slate-500">SAVED SITES</span>
        <div className="flex items-center gap-2">
          {shown.length > 0 && (
            <button
              type="button"
              onClick={() => clearShownSavedSites()}
              className="rounded px-1 py-0.5 font-sans text-[10px] tracking-normal text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              Hide all ({shown.length})
            </button>
          )}
          <span className="text-slate-400">
            {sites.length}/{max}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-2 underline decoration-red-400/60 underline-offset-2 hover:text-red-200"
          >
            retry
          </button>
        </div>
      )}

      {loading && sites.length === 0 && (
        <p className="text-xs text-slate-400">
          <span className="font-mono text-sky-400/80">&gt; </span>Loading saved
          sites…
        </p>
      )}

      {!loading && !error && sites.length === 0 && (
        <p className="text-xs leading-relaxed text-slate-400">
          <span className="font-mono text-sky-400/80">&gt; </span>
          No saved sites yet. Screen a site (Point / Rectangle / Polygon), then
          press <span className="text-slate-200">Save site</span> in the results
          to keep up to {max} sites here for comparison.
        </p>
      )}

      {sites.length > 0 && (
        <div className="flex flex-col gap-2">
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              onOpen={onOpenSite}
              shown={shownIds.has(site.id)}
            />
          ))}
        </div>
      )}

      {sites.length >= 2 && <ComparisonTable sites={sites} />}
    </div>
  );
}

// ── One saved-site card (name, key metrics, open / rename / delete) ───────────

function SiteCard({
  site,
  onOpen,
  shown,
}: {
  site: SavedSite;
  onOpen: (site: SavedSite) => void;
  shown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = site.summary;

  const onRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === site.name) {
      setEditing(false);
      setName(site.name);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await renameSite(site.id, trimmed);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    setBusy(true);
    setErr(null);
    try {
      await removeSite(site.id);
      hideShownSavedSite(site.id); // drop its outline from the map overlay
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onRename();
                if (e.key === "Escape") {
                  setEditing(false);
                  setName(site.name);
                }
              }}
              maxLength={80}
              autoFocus
              className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900/80 px-1.5 py-0.5 text-xs text-slate-100 outline-none focus:border-sky-500/60"
              aria-label="Site name"
            />
            <button
              type="button"
              onClick={() => void onRename()}
              disabled={busy}
              className="rounded px-1 py-0.5 text-[11px] text-sky-300 hover:bg-white/5 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(site)}
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-100 hover:text-sky-200"
            title="Open on map"
          >
            {site.name}
          </button>
        )}
        {s && (
          <span className="shrink-0 rounded-full border border-slate-600/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
            {Math.round(s.scoreValue)}
          </span>
        )}
      </div>

      {s && (
        <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-400">
          <Metric label="wind" value={fmtSpeed(s.meanSpeedMs)} />
          <Metric label="CUF" value={fmtPct(s.cuf)} />
          <Metric label="MW" value={fmtInt(s.capacityMw)} />
          <Metric label="IRR" value={fmtPct(s.equityIrr)} />
          <Metric label="excl" value={fmtPct(s.redExclusionFraction)} />
          <Metric
            label="km²"
            value={site.areaKm2 != null ? site.areaKm2.toFixed(0) : "—"}
          />
        </div>
      )}

      {err && <p className="mt-1 text-[10px] text-red-300">{err}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => toggleShownSavedSite(site)}
          aria-pressed={shown}
          className={
            "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors " +
            (shown
              ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/70 hover:bg-emerald-500/20")
          }
        >
          {shown ? "Hide" : "Show on map"}
        </button>
        <button
          type="button"
          onClick={() => onOpen(site)}
          className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-200 transition-colors hover:border-sky-400/70 hover:bg-sky-500/20"
        >
          Analyze
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setName(site.name);
              setEditing(true);
            }}
            className="rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            Rename
          </button>
        )}
        <div className="ml-auto">
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void onDelete()}
                disabled={busy}
                className="rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              >
                Delete?
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                aria-label="Cancel delete"
                className="rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/5"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete site"
              className="rounded-md px-2 py-1 text-[11px] text-slate-500 transition-colors hover:bg-white/5 hover:text-red-300"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="truncate">
      <span className="text-slate-600">{label} </span>
      <span className="text-slate-200">{value}</span>
    </span>
  );
}

// ── Side-by-side comparison table ─────────────────────────────────────────────

interface MetricRow {
  label: string;
  get: (site: SavedSite) => number | null;
  fmt: (v: number) => string;
  /** Which direction is "better" (drives the green highlight). */
  better?: "high" | "low";
}

const sm = (site: SavedSite): SavedSiteSummary | null => site.summary;

const METRIC_ROWS: MetricRow[] = [
  { label: "Score", get: (s) => sm(s)?.scoreValue ?? null, fmt: (v) => v.toFixed(0), better: "high" },
  { label: "Capacity factor", get: (s) => sm(s)?.cuf ?? null, fmt: pct1, better: "high" },
  { label: "Wind @100 m", get: (s) => sm(s)?.meanSpeedMs ?? null, fmt: (v) => `${v.toFixed(2)} m/s`, better: "high" },
  { label: "Power density", get: (s) => sm(s)?.powerDensity ?? null, fmt: (v) => `${Math.round(v)} W/m²`, better: "high" },
  { label: "Capacity", get: (s) => sm(s)?.capacityMw ?? null, fmt: (v) => `${Math.round(v)} MW`, better: "high" },
  { label: "Annual energy", get: (s) => sm(s)?.energyGwh ?? null, fmt: (v) => `${Math.round(v)} GWh`, better: "high" },
  { label: "Equity IRR", get: (s) => sm(s)?.equityIrr ?? null, fmt: pct1, better: "high" },
  { label: "LCOE", get: (s) => sm(s)?.lcoe ?? null, fmt: (v) => `₹${v.toFixed(2)}`, better: "low" },
  { label: "Payback", get: (s) => sm(s)?.payback ?? null, fmt: (v) => `${v} yr`, better: "low" },
  { label: "Red exclusions", get: (s) => sm(s)?.redExclusionFraction ?? null, fmt: pct0, better: "low" },
  { label: "Farm overlap", get: (s) => sm(s)?.farmOverlapFraction ?? null, fmt: pct0, better: "low" },
  { label: "Substation", get: (s) => sm(s)?.nearestSubstationKm ?? null, fmt: (v) => `${v.toFixed(1)} km`, better: "low" },
  { label: "Area", get: (s) => s.areaKm2, fmt: (v) => `${v.toFixed(0)} km²` },
];

interface TextRow {
  label: string;
  get: (site: SavedSite) => string;
}

const TEXT_ROWS: TextRow[] = [
  { label: "Rating", get: (s) => sm(s)?.scoreRating ?? "—" },
  { label: "Site class", get: (s) => sm(s)?.siteClass ?? "—" },
  { label: "Confidence", get: (s) => sm(s)?.confidence ?? "—" },
  { label: "EHV ≤25 km", get: (s) => boolLabel(sm(s)?.ehvWithin25Km) },
  { label: "State", get: (s) => sm(s)?.state ?? "—" },
];

/** Index of the best site for a metric row, or null when no clear winner
 *  (fewer than 2 values, or all equal). */
function bestIndex(values: (number | null)[], better?: "high" | "low"): number | null {
  if (!better) return null;
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null);
  if (present.length < 2) return null;
  const sorted = [...present].sort((a, b) =>
    better === "high" ? b.v - a.v : a.v - b.v,
  );
  const top = sorted[0]!;
  const next = sorted[1]!;
  if (top.v === next.v) return null; // tie → no single winner to highlight
  return top.i;
}

function ComparisonTable({ sites }: { sites: SavedSite[] }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 p-2">
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Compare ({sites.length})
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <caption className="sr-only">
            Saved-site metric comparison
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-slate-800/40 px-1 py-1 text-left font-medium text-slate-500"
              />
              {sites.map((site) => (
                <th
                  key={site.id}
                  scope="col"
                  className="max-w-[84px] truncate px-1.5 py-1 text-right font-semibold text-slate-200"
                  title={site.name}
                >
                  {site.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map((row) => {
              const vals = sites.map((s) => row.get(s));
              const best = bestIndex(vals, row.better);
              return (
                <tr key={row.label} className="border-t border-slate-700/40">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-slate-800/40 px-1 py-1 text-left font-normal text-slate-500"
                  >
                    {row.label}
                  </th>
                  {vals.map((v, i) => (
                    <td
                      key={sites[i]!.id}
                      className={
                        "px-1.5 py-1 text-right font-mono " +
                        (best === i ? "text-emerald-300" : "text-slate-200")
                      }
                    >
                      {v == null ? "—" : row.fmt(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {TEXT_ROWS.map((row) => (
              <tr key={row.label} className="border-t border-slate-700/40">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-slate-800/40 px-1 py-1 text-left font-normal text-slate-500"
                >
                  {row.label}
                </th>
                {sites.map((s) => (
                  <td key={s.id} className="px-1.5 py-1 text-right text-slate-300">
                    {row.get(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 px-1 text-[9px] leading-tight text-slate-500">
        Green = best of the saved sites for that metric. Values are the snapshot
        taken when each site was saved.
      </p>
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
function pct0(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(0)}%`;
}
function fmtSpeed(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}`;
}
function fmtInt(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}`;
}
function boolLabel(v: boolean | null | undefined): string {
  if (v == null) return "—";
  return v ? "Yes" : "No";
}

// ── Launcher icon (bookmark) ──────────────────────────────────────────────────

export function SavedSitesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}
