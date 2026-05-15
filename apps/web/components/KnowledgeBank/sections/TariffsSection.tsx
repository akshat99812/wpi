"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  InfoCard, Prose,
  SectionHeader, SourceLinks,
} from '../WindCards';
import { useTariffsData } from '@/hooks/useApi';
import { STATE_PROFILES } from '../stateProfiles';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

// ── Render shape for a single discovered-tariff row. Rows are derived live
// from `bundle.tariffOrders` (Mercom / SolarQuarter / SECI / Renewable Watch
// / NREDCAP / TSREDCO crawler payloads) — no hardcoded list lives here.
interface StateTariffEvent {
  date:   string;
  source: string;
  title:  string;
  tariff: string;
  meta:   string;
  url:    string;
  state?: string;
}

type BundleTariff = WpiBundle['tariffOrders'][number];

function mapTariffRow(t: BundleTariff): StateTariffEvent {
  const date =
    t.dateLabel ??
    (t.effectiveDate
      ? new Date(t.effectiveDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      : '');

  const tariff =
    t.tariffLabel ??
    (typeof t.tariff_inr === 'number' ? `₹${t.tariff_inr.toFixed(2)}/kWh` : '—');

  return {
    date,
    source: t.regulator,
    title:  t.title ?? '',
    tariff,
    meta:   t.meta ?? '',
    url:    t.url ?? '#',
    state:  t.state,
  };
}


const SOURCES = [
  { label: 'SECI Auction Results', url: 'https://www.seci.co.in/' },
  { label: 'CERC Tariff Orders',   url: 'https://cercind.gov.in/' },
  { label: 'MERC / GERC / KERC',   url: 'https://forumofregulators.gov.in/' },
];

export default function TariffsSection({ bundle: _bundle, selectedState }: Props) {
  const { data, loading, refetch } = useTariffsData();

  const allTariffEvents = (data?.tariffOrders ?? []).map(mapTariffRow);
  const stateTariffEvents = selectedState
    ? allTariffEvents.filter(ev => ev.state === selectedState)
    : [];

  if (loading) {
    return (
      <div className="flex flex-col gap-3.5">
        <SectionHeader eyebrow="Discovered Tariffs" title="Tariffs" delay={0} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2].map(i => (
            <div key={i} className="bg-[#0f1424] border border-[#2a3a54] rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-[#1f2c44] rounded w-20 mb-3" />
              <div className="h-8 bg-[#1f2c44] rounded w-32 mb-2" />
              <div className="h-3 bg-[#1f2c44] rounded w-full" />
            </div>
          ))}
        </div>
        <div className="bg-[#0f1424] border border-[#2a3a54] rounded-xl p-4 animate-pulse h-40" />
      </div>
    );
  }

  const profile = selectedState ? STATE_PROFILES[selectedState] ?? null : null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-2">
        <SectionHeader
          eyebrow="Discovered Tariffs"
          title={selectedState ? `Tariffs — ${selectedState}` : 'Tariffs'}
          delay={0}
        />
        <button
          onClick={refetch}
          className="flex-shrink-0 mt-1 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md border border-[#1f2c44] text-muted/50 hover:text-text hover:border-[#2a3a54] transition-all"
          title="Refresh tariffs"
        >
          ↻ Refresh
        </button>
      </div>

      {/* State-specific tariff context — collapsed by default so the Tariffs
          tab leads with the live tariff events feed, not the static blurb. */}
      {profile && (
        <InfoCard
          title={`${selectedState} — utilities & procurement context`}
          delay={30}
          icon={<GavelIcon />}
          accent="#ff8a1f"
        >
          {profile.sectorProfile.map((para, i) => (
            <Prose key={i}>{para}</Prose>
          ))}
        </InfoCard>
      )}

      {/* State-specific tariff events — pulled live from the bundle */}
      {selectedState && stateTariffEvents.length > 0 && (
        <InfoCard
          title={`${selectedState} wind tariffs — recent events`}
          delay={60}
          defaultOpen
          icon={<TimelineIcon />}
          accent="#7bc4e2"
        >
          <div className="flex flex-col gap-2 mt-1">
            {stateTariffEvents.map((ev, i) => (
              <StateTariffEventRow key={`${ev.title}-${i}`} event={ev} delay={i * 40} />
            ))}
          </div>
        </InfoCard>
      )}

      {/* India overview — full multi-source feed straight from the bundle */}
      {!selectedState && (
        <InfoCard
          title="Wind tariffs — recent events (all sources)"
          delay={60}
          defaultOpen
          icon={<TimelineIcon />}
          accent="#7bc4e2"
        >
          <div className="flex flex-col gap-2 mt-1">
            {allTariffEvents.map((ev, i) => (
              <StateTariffEventRow key={`${ev.title}-${i}`} event={ev} delay={i * 30} />
            ))}
          </div>
        </InfoCard>
      )}

      <SourceLinks sources={SOURCES} delay={300} />
    </div>
  );
}

const ExternalLinkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const GavelIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4l6 6M9 9l6 6M3 21l6-6M11 5l4-1 5 5-1 4z" />
  </svg>
);
const TimelineIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8v4l3 3" />
    <circle cx="12" cy="12" r="10" />
  </svg>
);

function StateTariffEventRow({
  event, delay,
}: {
  event: StateTariffEvent; delay: number;
}) {
  return (
    <div
      className="wpi-card-in bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3
                 hover:border-[#7bc4e2]/40 transition-colors flex flex-col gap-1"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      {/* Date · State · Source */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono font-bold text-muted/75 tabular-nums">
          {event.date}
        </span>
        {event.state && (
          <span className="text-[10px] font-bold text-text/80">
            · {event.state}
          </span>
        )}
        <span className="text-[9px] uppercase tracking-wider font-bold text-[#7bc4e2]/85
                         px-1.5 py-0.5 bg-[#7bc4e2]/10 border border-[#7bc4e2]/20 rounded">
          {event.source}
        </span>
      </div>

      {/* Title */}
      <div className="text-[12.5px] font-bold text-text/90 leading-snug mt-0.5">
        {event.title}
      </div>

      {/* Tariff highlight */}
      <div className="text-[12px] font-mono text-[#ffd0a0] font-bold tabular-nums">
        {event.tariff}
      </div>

      {/* Meta + open source */}
      <div className="flex items-center justify-between gap-2 flex-wrap mt-0.5">
        <span className="text-[10px] text-muted/70 leading-snug">
          {event.meta}
        </span>
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-semibold
                     text-[#7bc4e2]/85 hover:text-[#7bc4e2] transition-colors"
        >
          open source
          <ExternalLinkIcon />
        </a>
      </div>
    </div>
  );
}
