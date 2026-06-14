import React from 'react';
import type { Turbine } from '../types';
import { fmtCoords, fmtNum } from '../utils/format';

/**
 * "Turbine data" — Pro-map sidebar tool for an individual wind turbine.
 *
 * Renders the currently-selected turbine's attributes (OSM / OpenInfraMap
 * power=generator + generator:source=wind, fetched per-click via
 * GET /api/turbine/:id). Parallels MastDataTool but with turbine-specific
 * fields: rated power, hub height, rotor diameter, manufacturer, model.
 * Handles loading / error / loaded / empty states, like the mast card.
 */

export const TurbineIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    className={className} aria-hidden
  >
    {/* three-blade rotor on a hub + tapered tower */}
    <circle cx="12" cy="9" r="1.4" />
    <path d="M12 7.6V3" />
    <path d="M13.2 9.7l3.9 2.3" />
    <path d="M10.8 9.7l-3.9 2.3" />
    <path d="M11 10.3 11 21h2l-1-10.7" />
    <path d="M9.5 21h5" />
  </svg>
);

interface Props {
  selected: Turbine | null;
  loading: boolean;
  error: string | null;
}

/** Rated power in the most readable unit: ≥1 MW shows MW, else kW. */
function fmtRatedPower(kw: Turbine['rated_power_kw']): string | null {
  if (kw == null || kw === '') return null;
  const v = typeof kw === 'number' ? kw : Number(kw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v >= 1000 ? fmtNum(v / 1000, 'MW', 2) : fmtNum(v, 'kW', 0);
}

export function TurbineDataTool({ selected, loading, error }: Props) {
  if (loading) {
    return <p className="px-4 py-4 text-sm text-slate-300">Loading…</p>;
  }
  if (error) {
    return <p className="px-4 py-4 text-sm text-rose-300">{error}</p>;
  }
  if (!selected) {
    return <EmptyState />;
  }

  const title =
    selected.name ||
    (selected.ref ? `Turbine ${selected.ref}` : 'Wind turbine');
  const osmUrl = `https://www.openstreetmap.org/${selected.osm_type}/${selected.osm_id}`;

  return (
    <div className="px-4 py-4">
      {/* ── Header ── */}
      <header>
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300/80">
          Wind turbine
          <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-300">
            OSM
          </span>
        </p>
        <h3 className="mt-1 text-lg font-semibold leading-tight tracking-tight text-white">
          {title}
        </h3>
        {selected.operator && (
          <p className="mt-0.5 text-xs text-slate-400">{selected.operator}</p>
        )}
      </header>

      <div className="my-3 h-px bg-slate-700/70" />

      {/* ── Headline stats ── */}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Rated power" value={fmtRatedPower(selected.rated_power_kw)} />
        <Stat label="Hub height" value={fmtNum(selected.hub_height_m, 'm', 1)} />
      </div>

      {/* ── Detail grid ── */}
      <dl className="mt-3 divide-y divide-slate-800 text-sm">
        <Row label="Manufacturer" value={selected.manufacturer} />
        <Row label="Model" value={selected.model} />
        <Row label="Rotor diameter" value={fmtNum(selected.rotor_diameter_m, 'm', 1)} />
        <Row label="Commissioned" value={selected.start_date} />
        <Row label="Elevation" value={fmtNum(selected.ele_m, 'm a.s.l.', 0)} />
        <Row label="Coordinates" value={fmtCoords(selected.lat, selected.lon)} />
      </dl>

      <a
        href={osmUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 hover:underline"
      >
        View on OpenStreetMap ↗
      </a>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <TurbineIcon className="h-8 w-8 text-slate-600" />
      <p className="text-sm text-slate-400">
        Select a wind turbine on the map to view its details.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-800/40 px-3 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-white">{value || '—'}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-100">{value || '—'}</dd>
    </div>
  );
}
