import React from 'react';
import type { Turbine } from '../types';
import { fmtCoords, fmtGrouped } from '../utils/format';

/**
 * "Turbine data" — Pro-map sidebar tool for an individual wind turbine.
 *
 * Renders the currently-selected turbine's attributes (OSM / OpenInfraMap
 * power=generator + generator:source=wind, fetched per-click via
 * GET /api/turbine/:id). OSM rarely carries turbine specs (rated power, hub
 * height, model, …), so the card shows only the fields we reliably have —
 * name/operator + coordinates + the OSM link — plus, when the turbine sits
 * inside a recorded WT-MARUT wind-farm district, that district cluster's
 * installed capacity + turbine (WEG) count. Handles loading / error / loaded /
 * empty states, like the mast card.
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

      {/* OSM rarely carries turbine specs (rated power, hub height, model, …),
          so we show only the fields we reliably have rather than a wall of "—". */}
      <dl className="divide-y divide-slate-800 text-sm">
        <Row label="Coordinates" value={fmtCoords(selected.lat, selected.lon)} />
      </dl>

      {/* Which WT-MARUT wind-farm cluster this turbine belongs to. */}
      <WindFarmSection turbine={selected} />

      <a
        href={osmUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 hover:underline"
      >
        View on OpenStreetMap <span aria-hidden>↗</span>
      </a>
    </div>
  );
}

/**
 * Wind-farm attribution block. The turbine was point-in-polygon matched to a
 * WT-MARUT (NIWE/MNRE) district on the server; the capacity + WEG figures are
 * that ENTIRE district cluster's registry totals, so the copy is explicit that
 * they are not counts for this single turbine. When the turbine falls outside
 * every recorded district, we say so plainly rather than guess a nearest farm.
 */
function WindFarmSection({ turbine }: { turbine: Turbine }) {
  const district = turbine.farm_district;
  const capacity = fmtGrouped(turbine.farm_capacity_mw, 1);
  const weg = fmtGrouped(turbine.farm_weg, 0);

  return (
    <section className="mt-4 rounded-lg border border-slate-700/70 bg-slate-800/40 p-3">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300/80">
        Wind farm
        <span className="rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-sky-300">
          WT-MARUT
        </span>
      </p>

      {district ? (
        <>
          <h4 className="mt-1.5 text-base font-semibold leading-tight text-white">
            {district}
          </h4>
          <p className="mt-0.5 text-xs text-slate-400">
            {turbine.farm_state ? `${turbine.farm_state} · ` : ''}wind-farm district
          </p>
          <dl className="mt-2 divide-y divide-slate-800/80 text-sm">
            <Row
              label="Installed capacity"
              value={capacity ? `${capacity} MW` : null}
            />
            <Row label="Registered turbines (WEGs)" value={weg} />
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-slate-400">
            Whole-district totals from the WT-MARUT / NIWE registry (installations
            registered since FY&nbsp;2015-16) — not this single turbine; older
            pre-2015 wind farms may not be counted.
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-xs leading-snug text-slate-400">
          Not inside a recorded WT-MARUT wind-farm district.
        </p>
      )}
    </section>
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

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-100">{value || '—'}</dd>
    </div>
  );
}
