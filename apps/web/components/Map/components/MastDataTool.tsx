import React from 'react';
import type { Windmill } from '../types';
import { fmtCoords, fmtDate, fmtNum } from '../utils/format';

/**
 * "Mast data" — the first Pro-map sidebar tool.
 *
 * Renders the currently-selected wind-monitoring mast's full attributes
 * (relocated here from the old floating top-left card). Handles the four
 * states the parent page tracks: loading a detail fetch, an error, a loaded
 * mast, and the empty state when nothing is selected yet.
 */

export const MastIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    className={className} aria-hidden
  >
    {/* guyed lattice mast: narrow top → wide base, with cross-braces + sensor */}
    <path d="M12 21V5" />
    <path d="M9 21l3-16 3 16" />
    <path d="M10.2 9h3.6M9.6 13h4.8M9 17h6" />
    <circle cx="12" cy="4" r="1.3" />
  </svg>
);

interface Props {
  selected: Windmill | null;
  loading: boolean;
  error: string | null;
}

export function MastDataTool({ selected, loading, error }: Props) {
  if (loading) {
    return <p className="px-4 py-4 text-sm text-slate-300">Loading…</p>;
  }
  if (error) {
    return <p className="px-4 py-4 text-sm text-rose-300">{error}</p>;
  }
  if (!selected) {
    return <EmptyState />;
  }

  // Private-inventory pins are coordinate-keyed with a "private:" id prefix
  // (set in pro-map page.tsx); everything else comes from the NIWE dataset.
  const isPrivateMast = selected.id.startsWith('private:');

  return (
    <div className="px-4 py-4">
      {/* ── Header ── */}
      <header>
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-400/80">
          Wind monitoring mast
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${
              isPrivateMast
                ? 'border border-amber-400/30 bg-amber-400/10 text-amber-300'
                : 'border border-sky-400/30 bg-sky-400/10 text-sky-300'
            }`}
          >
            {isPrivateMast ? 'PVT' : 'NIWE'}
          </span>
        </p>
        <h3 className="mt-1 text-lg font-semibold leading-tight tracking-tight text-white">
          {selected.station || 'Unnamed mast'}
        </h3>
        {(selected.district || selected.state) && (
          <p className="mt-0.5 text-xs text-slate-400">
            {[selected.district, selected.state].filter(Boolean).join(', ')}
          </p>
        )}
      </header>

      <div className="my-3 h-px bg-slate-700/70" />

      {/* ── Headline wind-resource stats ── */}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Mean wind speed" value={fmtNum(selected.maws_ms, 'm/s', 2)} />
        <Stat label="Wind power density" value={fmtNum(selected.mawpd_wm2, 'W/m²', 1)} />
      </div>

      {/* ── Detail grid ── */}
      <dl className="mt-3 divide-y divide-slate-800 text-sm">
        <Row label="Mast height" value={fmtNum(selected.mast_height_m, 'm', 1)} />
        <Row label="Elevation" value={fmtNum(selected.elevation_masl, 'm a.s.l.', 1)} />
        <Row label="Commenced" value={fmtDate(selected.date_commence)} />
        <Row label="Closed" value={fmtDate(selected.date_close)} />
        <Row label="Coordinates" value={fmtCoords(selected.lat, selected.lon)} />
      </dl>

      {selected.coord_complete === false && (
        <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[11px] leading-snug text-amber-300/90">
          Position is approximate
        </p>
      )}

      <p className="mt-3 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">
        For measured mast data, contact{' '}
        <a
          href="mailto:info@cecl.in?subject=Mast%20data%20request"
          className="text-slate-300 underline decoration-slate-600 underline-offset-2 hover:text-white"
        >
          CECL
        </a>
        .
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <MastIcon className="h-8 w-8 text-slate-600" />
      <p className="text-sm text-slate-400">
        Select a mast on the map to view its wind-resource data.
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
