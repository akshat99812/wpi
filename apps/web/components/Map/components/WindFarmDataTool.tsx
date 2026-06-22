import React from "react";
import type { WindFarmProps } from "../utils/windFarms";
import { fmtCoords } from "../utils/format";

/**
 * "Wind farm data" — Pro-map sidebar card for a clicked wind-farm circle.
 *
 * Shows the district-level aggregate the circle represents (WT-MARUT / NIWE
 * installed-capacity data): location, number of WEGs (turbines), and installed
 * capacity (MW). Mirrors the mast / turbine cards. Data is already in hand from
 * the GeoJSON the circles are drawn from — no per-click fetch, so there is no
 * loading/error state.
 */

export const WindFarmIcon = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    {/* clustered circles = a farm of turbines */}
    <circle cx="8" cy="13" r="3.2" />
    <circle cx="16" cy="10" r="2.3" />
    <circle cx="15.5" cy="16" r="1.6" />
  </svg>
);

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  selected: WindFarmProps | null;
}

export function WindFarmDataTool({ selected }: Props) {
  if (!selected) return <EmptyState />;

  const title = selected.district ? titleCase(selected.district) : "Wind farm";

  return (
    <div className="px-4 py-4">
      {/* ── Header ── */}
      <header>
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300/80">
          Wind farm
          <span className="rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-sky-300">
            WT-MARUT
          </span>
        </p>
        <h3 className="mt-1 text-lg font-semibold leading-tight tracking-tight text-white">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-slate-400">District-level installed capacity</p>
      </header>

      <div className="my-3 h-px bg-slate-700/70" />

      <dl className="divide-y divide-slate-800 text-sm">
        <Row label="Location" value={title} />
        <Row label="Turbines (WEG)" value={selected.weg.toLocaleString()} />
        <Row
          label="Capacity"
          value={`${selected.capacityMW.toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })} MW`}
        />
        <Row label="Coordinates" value={fmtCoords(selected.lat, selected.lon)} />
      </dl>

      <p className="mt-3 text-[10px] leading-snug text-slate-500">
        Aggregated across financial years. Zoom in for the individual turbines.
        Source: WT-MARUT (NIWE/MNRE); centroid: GADM.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <WindFarmIcon className="h-8 w-8 text-slate-600" />
      <p className="text-sm text-slate-400">
        Click a wind-farm circle on the map to view its details.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-100">{value || "—"}</dd>
    </div>
  );
}
