"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  HeadlineMetric, InfoCard, Prose, ChipRow,
  SectionHeader, EmptyState, SourceLinks,
} from '../WindCards';
import { STATE_PROFILES } from '../stateProfiles';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const SOURCES = [
  { label: 'POSOCO Daily Generation Report', url: 'https://posoco.in/' },
  { label: 'NLDC Real-time Dashboard',       url: 'https://nldc.in/' },
  { label: 'CEA Daily Report',               url: 'https://cea.nic.in/dailyreports/' },
  { label: 'Grid-India',                     url: 'https://grid-india.in/' },
];

// ── Per-state transmission utility lookup ─────────────────────────────────
// The state Transco is the authoritative reference for intra-state evacuation
// and OPGW / 220-400 kV substation status.
const STATE_TRANSCO: Record<string, { short: string; long: string; url: string }> = {
  'Andhra Pradesh':   { short: 'APTRANSCO',  long: 'AP Transmission Corporation',                  url: 'https://www.aptransco.gov.in/' },
  'Gujarat':          { short: 'GETCO',      long: 'Gujarat Energy Transmission Corporation',      url: 'https://www.getcogujarat.com/' },
  'Himachal Pradesh': { short: 'HPPTCL',     long: 'HP Power Transmission Corporation',            url: 'https://hpptcl.in/' },
  'Karnataka':        { short: 'KPTCL',      long: 'Karnataka Power Transmission Corporation',     url: 'https://kptcl.karnataka.gov.in/' },
  'Kerala':           { short: 'KSEBL',      long: 'Kerala State Electricity Board Ltd.',          url: 'https://www.kseb.in/' },
  'Madhya Pradesh':   { short: 'MPPTCL',     long: 'MP Power Transmission Co.',                    url: 'https://www.mpptcl.com/' },
  'Maharashtra':      { short: 'MSETCL',     long: 'Maharashtra State Electricity Transmission',   url: 'https://www.mahatransco.in/' },
  'Odisha':           { short: 'OPTCL',      long: 'Odisha Power Transmission Corporation',        url: 'https://www.optcl.co.in/' },
  'Rajasthan':        { short: 'RVPN',       long: 'Rajasthan Rajya Vidyut Prasaran Nigam',        url: 'https://energy.rajasthan.gov.in/rvpn' },
  'Tamil Nadu':       { short: 'TANTRANSCO', long: 'Tamil Nadu Transmission Corporation',          url: 'https://www.tnebnet.org/' },
  'Telangana':        { short: 'TSTRANSCO',  long: 'Telangana State Transmission Corporation',     url: 'https://www.tstransco.in/' },
};

// Common (national) grid authorities — same for every state.
const NATIONAL_GRID_SOURCES = [
  { title: 'CEA — Transmission Planning',           description: 'Central Electricity Authority — long-term inter-state transmission planning.',                 url: 'https://cea.nic.in/transmission-planning-wing/' },
  { title: 'CEA — Transmission GIS / National Map', description: 'GIS-based national transmission infrastructure map.',                                            url: 'https://cea.nic.in/' },
  { title: 'Power Grid Corp. of India (PGCIL)',     description: 'Inter-state grid owner & RE bid coordinator.',                                                   url: 'https://www.powergrid.in/' },
  { title: 'Grid Controller of India (Grid-India)', description: 'National real-time grid operations (formerly POSOCO).',                                          url: 'https://grid-india.in/' },
];

export default function GridSection({ bundle, selectedState }: Props) {
  const grid = bundle?.grid;
  const dailyMu      = grid?.daily_wind_gen_mu       ?? 305;
  const sharePct     = grid?.wind_grid_share_pct     ?? 5.4;
  const curtailPct   = grid?.curtailment_pct         ?? 1.8;
  const dateLabel    = grid?.date
    ? new Date(grid.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Indicative';

  const profile = selectedState ? STATE_PROFILES[selectedState] ?? null : null;

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow={selectedState ? `${selectedState} · Transmission` : 'Grid Integration'}
        title={selectedState ? `Grid — ${selectedState}` : `Grid — Wind in the System (${dateLabel})`}
        delay={0}
      />

      {/* State-specific transmission & evacuation context */}
      {profile && (
        <InfoCard
          title={`${selectedState} — transmission & evacuation`}
          delay={30}
          defaultOpen
          icon={<WaveIcon />}
          accent="#7bc4e2"
        >
          <Prose>{profile.gridTransmission}</Prose>
        </InfoCard>
      )}

      {/* State-specific grid sources — Transco + CEA / PGCIL / Grid-India */}
      {selectedState && (
        <InfoCard
          title={`${selectedState} — Grid & Evacuation`}
          delay={60}
          defaultOpen
          icon={<BookIcon />}
          accent="#a5b4fc"
        >
          <Prose>
            The portal links directly to the relevant transmission utility and
            CEA / PGCIL / Grid-India sources for authentic grid information.
          </Prose>

          <div className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-muted/55 mt-2 mb-0.5">
            Authoritative public sources for this tab
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {STATE_TRANSCO[selectedState] && (
              <GridSourceRow
                title={`${STATE_TRANSCO[selectedState].long} (${STATE_TRANSCO[selectedState].short})`}
                description="State transmission utility (authoritative)."
                url={STATE_TRANSCO[selectedState].url}
                accent="#ff8a1f"
              />
            )}
            {NATIONAL_GRID_SOURCES.map(s => (
              <GridSourceRow
                key={s.title}
                title={s.title}
                description={s.description}
                url={s.url}
              />
            ))}
          </div>
        </InfoCard>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeadlineMetric
          delay={60} emphasis accent="#7bc4e2"
          label="Daily Wind Gen"
          value={`${dailyMu} MU`}
          caption={`Pan-India · ${dateLabel}`}
        />
        <HeadlineMetric
          delay={120} emphasis accent="#4cc87a"
          label="Wind Grid Share"
          value={`${sharePct}%`}
          caption="Of total generation, daily basis"
        />
        <HeadlineMetric
          delay={180} emphasis
          accent={curtailPct > 5 ? '#f87171' : curtailPct > 2 ? '#ffb066' : '#4cc87a'}
          label="Curtailment"
          value={`${curtailPct}%`}
          caption={curtailPct > 5
            ? 'Elevated — congestion in TN/AP corridors'
            : curtailPct > 2
              ? 'Moderate — local pockets only'
              : 'Within normal operating envelope'}
        />
      </div>

      {/* Seasonal share chips */}
      <div
        className="wpi-card-in bg-[#0a0f1c]/40 border border-[#1f2c44] rounded-xl p-3.5"
        style={{ ['--wpi-delay' as string]: '240ms' }}
      >
        <span className="text-[9.5px] text-muted/55 uppercase tracking-[0.12em] font-bold">
          Seasonal grid share
        </span>
        <ChipRow chips={[
          { label: 'Monsoon Peak (Jul)', value: '12 – 14%', accent: '#7bc4e2' },
          { label: 'Pre-Monsoon (Apr)',  value: '6 – 8%',   accent: '#4cc87a' },
          { label: 'Winter Trough (Dec)',value: '2 – 3%',   accent: '#a5b4fc' },
          { label: 'Annual Avg',         value: '~5.4%' },
        ]} />
      </div>

      {/* Generation profile */}
      <InfoCard
        title="Generation profile & dispatch"
        delay={300}
        defaultOpen
        icon={<WaveIcon />}
        accent="#7bc4e2"
      >
        <Prose>
          Wind generation in India follows a strongly bimodal pattern —
          peaking during the south-west monsoon (Jun–Sep), troughing in
          November–February. On peak monsoon days the wind fleet has
          delivered up to <b className="text-[#7bc4e2]">14% of all-India
          generation</b>, with peninsular states (TN, KA) hitting 35–45% of
          their own state load.
        </Prose>
        <Prose>
          Wind is treated as <b className="text-[#ffd0a0]">must-run</b>
          under MoP&apos;s 2022 dispatch rules; thermal flexes down on high-wind
          intervals. Forecasting deviation settlement (FOR/DSM) penalises
          schedule mismatches, incentivising 96-block forecasts coordinated
          via QCAs (Qualified Coordinating Agencies).
        </Prose>
        <ChipRow chips={[
          { label: 'Must-run',       value: 'Yes (MoP 2022)',  accent: '#4cc87a' },
          { label: 'Forecast Block', value: '15-min · 96/day' },
          { label: 'DSM Tolerance',  value: '±10%' },
          { label: 'QCA Coverage',   value: 'GUVNL · TN · KA' },
        ]} />
        <div className="flex flex-wrap gap-3">
          <ViewSource href="https://posoco.in/reports/daily-reports/" label="POSOCO Daily Reports" accent="#7bc4e2" />
          <ViewSource href="https://www.nldc.in/" label="NLDC Dashboard" accent="#7bc4e2" />
        </div>
      </InfoCard>

      {/* Curtailment & congestion */}
      <InfoCard
        title="Curtailment & congestion hotspots"
        delay={360}
        icon={<AlertIcon />}
        accent="#ffb066"
      >
        <Prose>
          Wind curtailment is concentrated in three corridors —
          <b className="text-[#ffb066]"> Tirunelveli–Theni</b> (TN),
          <b className="text-[#ffb066]"> Anantapur–Kurnool</b> (AP), and
          <b className="text-[#ffb066]"> Jaisalmer–Bhadla</b> (RJ). Cause is
          mid-day solar + wind co-incidence on a finite ISTS evacuation
          envelope. PGCIL&apos;s Green Energy Corridor Phase-II (GEC-II)
          adds 8,500 ckm of 765 kV / 400 kV lines targeting these
          bottlenecks, COD-staggered through FY27.
        </Prose>
        <ChipRow chips={[
          { label: 'TN Corridor',    value: 'Tirunelveli–Theni',    accent: '#ffb066' },
          { label: 'AP Corridor',    value: 'Anantapur–Kurnool',    accent: '#ffb066' },
          { label: 'RJ Corridor',    value: 'Jaisalmer–Bhadla',     accent: '#ffb066' },
          { label: 'GEC-II',         value: '8,500 ckm by FY27',    accent: '#4cc87a' },
        ]} />
        <div className="flex flex-wrap gap-3">
          <ViewSource href="https://grid-india.in/" label="Grid India" accent="#ffb066" />
          <ViewSource href="https://cea.nic.in/dailyreports/" label="CEA Daily Reports" accent="#ffb066" />
        </div>
      </InfoCard>

      {/* Storage & FDRE */}
      <InfoCard
        title="Storage & firming"
        delay={420}
        icon={<BatteryIcon />}
        accent="#a5b4fc"
      >
        <Prose>
          FDRE tenders since 2023 explicitly require wind to be paired with
          BESS or pumped-hydro for evening peak coverage. SECI Tranche XII–XV
          set the benchmark — typically 4-hr BESS at ~20% of nameplate. The
          first FDRE plant (1,000 MW MSEDCL) is scheduled for COD in FY26.
        </Prose>
        <ChipRow chips={[
          { label: 'BESS Sizing',    value: '~20% nameplate · 4 hr', accent: '#a5b4fc' },
          { label: 'PHS Pipeline',   value: '~15 GW (PGCIL track)' },
          { label: 'First FDRE COD', value: 'FY26 (MSEDCL 1 GW)',    accent: '#4cc87a' },
        ]} />
        <div className="flex flex-wrap gap-3">
          <ViewSource href="https://www.seci.co.in/" label="SECI FDRE Tenders" accent="#a5b4fc" />
          <ViewSource href="https://www.pgcil.co.in/" label="PGCIL GEC-II" accent="#a5b4fc" />
        </div>
      </InfoCard>

      {!grid && (
        <EmptyState
          delay={480}
          message="No live POSOCO grid data in bundle — values shown are last-known indicative figures."
        />
      )}

      <SourceLinks sources={SOURCES} delay={540} />
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────
const ExternalLinkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// ── Single grid-source row ─────────────────────────────────────────────────
// Mirrors the format used by the Technology tab so authoritative sources
// across the app feel consistent.
function GridSourceRow({
  title, description, url, accent = '#7bc4e2',
}: {
  title: string; description: string; url: string; accent?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3
                 hover:border-opacity-60 transition-colors"
      style={{ borderColor: undefined }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-[12px] font-bold leading-snug transition-colors"
          style={{ color: 'rgba(232,237,247,0.92)' }}
        >
          <span style={{ color: accent }} className="mr-1">▸</span>
          {title}
        </span>
        <ExternalLinkIcon />
      </div>
      <p className="text-[10.5px] text-muted/70 leading-relaxed mt-1 pl-3.5">
        {description}
      </p>
    </a>
  );
}

function ViewSource({ href, label, accent = '#7bc4e2' }: { href: string; label: string; accent?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity"
      style={{ color: accent }}
    >
      {label}
      <ExternalLinkIcon />
    </a>
  );
}

// ── Inline icons ───────────────────────────────────────────────────────────
const WaveIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12c2 0 2-3 4-3s2 6 4 6 2-9 4-9 2 6 4 6 2-3 4-3" />
  </svg>
);
const AlertIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
  </svg>
);
const BatteryIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="18" height="10" rx="2" />
    <line x1="22" y1="11" x2="22" y2="13" />
    <line x1="6" y1="10" x2="6" y2="14" />
    <line x1="10" y1="10" x2="10" y2="14" />
  </svg>
);
const BookIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
