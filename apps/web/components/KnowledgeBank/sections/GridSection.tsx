"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import { SectionHeader } from '../WindCards';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

// ── Per-state authoritative grid sources ──────────────────────────────────
// Each state lists exactly ONE entry — the state transmission utility
// (Transco) — followed downstream by the shared national authorities.
// Naming matches the user-supplied copy exactly.
type GridKind = 'transco' | 'national';
type GridSource = { title: string; description: string; url: string; kind: GridKind };

const KIND_META: Record<GridKind, { label: string; accent: string }> = {
  transco:  { label: 'STATE TRANSCO', accent: '#ff8a1f' },
  national: { label: 'NATIONAL',      accent: '#7bc4e2' },
};

const STATE_GRID_SOURCES: Record<string, GridSource[]> = {
  'Andhra Pradesh': [
    { kind: 'transco', title: 'Transmission Corp. of Andhra Pradesh (APTRANSCO)', description: 'State transmission utility (authoritative).', url: 'https://www.aptransco.gov.in/' },
  ],
  'Gujarat': [
    { kind: 'transco', title: 'Gujarat Energy Transmission Corp. (GETCO)',        description: 'State transmission utility (authoritative).', url: 'https://www.getcogujarat.com/' },
  ],
  'Karnataka': [
    { kind: 'transco', title: 'Karnataka Power Transmission Corp. (KPTCL)',       description: 'State transmission utility (authoritative).', url: 'https://kptcl.karnataka.gov.in/' },
  ],
  'Kerala': [
    { kind: 'transco', title: 'Kerala State Electricity Board (KSEB)',            description: 'State transmission utility (authoritative).', url: 'https://www.kseb.in/' },
  ],
  'Madhya Pradesh': [
    { kind: 'transco', title: 'MP Power Transmission Co. (MPPTCL)',               description: 'State transmission utility (authoritative).', url: 'https://www.mpptcl.com/' },
  ],
  'Maharashtra': [
    { kind: 'transco', title: 'Maharashtra State Electricity Transmission Co. (MSETCL)', description: 'State transmission utility (authoritative).', url: 'https://www.mahatransco.in/' },
  ],
  'Rajasthan': [
    { kind: 'transco', title: 'Rajasthan Rajya Vidyut Prasaran Nigam (RVPN)',     description: 'State transmission utility (authoritative).', url: 'https://energy.rajasthan.gov.in/rvpn' },
  ],
  'Tamil Nadu': [
    { kind: 'transco', title: 'Tamil Nadu Transmission Corp. (TANTRANSCO)',       description: 'State transmission utility (authoritative).', url: 'https://www.tantransco.tn.gov.in/' },
  ],
};

// Common (national) grid authorities — always shown.
const NATIONAL_GRID_SOURCES: GridSource[] = [
  { kind: 'national', title: 'CEA — Transmission Planning',           description: 'Central Electricity Authority — long-term inter-state transmission planning.', url: 'https://cea.nic.in/transmission-planning-wing/' },
  { kind: 'national', title: 'CEA — Transmission GIS / National Map', description: 'GIS-based national transmission infrastructure map.',                            url: 'https://cea.nic.in/' },
  { kind: 'national', title: 'Power Grid Corp. of India (PGCIL)',     description: 'Inter-state grid owner & RE bid coordinator.',                                   url: 'https://www.powergrid.in/' },
  { kind: 'national', title: 'Grid Controller of India (Grid-India)', description: 'National real-time grid operations (formerly POSOCO).',                          url: 'https://grid-india.in/' },
];

export default function GridSection({ selectedState }: Props) {
  const stateSources = selectedState ? STATE_GRID_SOURCES[selectedState] ?? [] : [];

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={selectedState ? `${selectedState} · Transmission` : 'Grid Integration'}
        title={selectedState ? `${selectedState} — Grid & Evacuation` : 'National — Grid & Evacuation'}
        delay={0}
      />

      {/* Lead-in card with intent */}
      <div
        className="wpi-card-in relative overflow-hidden rounded-2xl border border-[#1f2c44]
                   bg-gradient-to-br from-[#0f1424] via-[#0a0f1c] to-[#0a0f1c] p-5"
        style={{ ['--wpi-delay' as string]: '60ms' }}
      >
        <div
          className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full
                     bg-[#a5b4fc]/10 blur-3xl"
        />
        <div className="relative flex items-start gap-3">
          <div
            className="flex-shrink-0 grid place-items-center h-9 w-9 rounded-lg
                       bg-[#a5b4fc]/12 border border-[#a5b4fc]/25 text-[#a5b4fc]"
          >
            <BookIcon />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#a5b4fc]/85">
              Grid &amp; Evacuation
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-text/80">
              The portal links directly to the relevant transmission utility
              and CEA&nbsp;/ PGCIL&nbsp;/ Grid-India sources for authentic grid
              information.
            </p>
          </div>
        </div>
      </div>

      {/* State authorities (only when a state is picked) */}
      {selectedState && stateSources.length > 0 && (
        <SourceCluster
          delay={120}
          eyebrow={`${selectedState} · state authorities`}
          sources={stateSources}
        />
      )}

      {/* National authorities — always shown */}
      <SourceCluster
        delay={selectedState ? 240 : 120}
        eyebrow="National authorities"
        sources={NATIONAL_GRID_SOURCES}
      />

      {selectedState && stateSources.length === 0 && (
        <div
          className="wpi-card-in rounded-xl border border-dashed border-[#1f2c44]
                     bg-[#0a0f1c]/60 p-4 text-[11.5px] text-muted/70"
          style={{ ['--wpi-delay' as string]: '180ms' }}
        >
          State-specific transmission authority for <b>{selectedState}</b> is
          not yet curated — refer to the national authorities above.
        </div>
      )}

      {/* "Sources:" footer — matches the requested copy exactly:
          State view → "<State Transco> · CEA · PGCIL"
          India view → "CEA · PGCIL · Grid-India". */}
      <div
        className="wpi-card-in text-[10.5px] text-muted/70 leading-relaxed pt-1"
        style={{ ['--wpi-delay' as string]: '360ms' }}
      >
        <span className="font-bold text-muted/85">Sources:&nbsp;</span>
        {stateSources.length > 0
          ? `${stateSources[0]!.title} · CEA · PGCIL`
          : 'CEA · PGCIL · Grid-India (Grid Controller of India)'}
      </div>
    </div>
  );
}

// ── Visual cluster of source cards under a labeled eyebrow ─────────────────
function SourceCluster({
  eyebrow, sources, delay,
}: {
  eyebrow: string; sources: GridSource[]; delay: number;
}) {
  return (
    <div
      className="wpi-card-in"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#1f2c44] to-transparent" />
        <span className="text-[9.5px] uppercase tracking-[0.16em] font-bold text-muted/60">
          {eyebrow}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#1f2c44] to-transparent" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {sources.map((s, i) => (
          <GridSourceCard key={s.title} source={s} delay={i * 40} />
        ))}
      </div>
    </div>
  );
}

// ── Single source card — title, category badge, description, external link ─
function GridSourceCard({ source, delay }: { source: GridSource; delay: number }) {
  const meta = KIND_META[source.kind];
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group wpi-card-in relative flex flex-col gap-1.5 rounded-xl
                 border border-[#1f2c44] bg-[#0a0f1c]/70 p-3.5
                 hover:bg-[#0f1424] hover:-translate-y-px
                 transition-all duration-200"
      style={{
        ['--wpi-delay' as string]: `${delay}ms`,
        borderColor: undefined,
      }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full opacity-70
                   group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: meta.accent }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <span
            className="text-[9px] font-bold uppercase tracking-[0.14em]
                       px-1.5 py-0.5 rounded self-start"
            style={{
              color: meta.accent,
              backgroundColor: `${meta.accent}15`,
              border: `1px solid ${meta.accent}33`,
            }}
          >
            {meta.label}
          </span>
          <span className="text-[12.5px] font-bold text-text/95 leading-snug truncate">
            {source.title}
          </span>
        </div>
        <span className="flex-shrink-0 text-muted/55 group-hover:text-text/85 transition-colors mt-0.5">
          <ExternalLinkIcon />
        </span>
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted/75">
        {source.description}
      </p>
    </a>
  );
}

// ── Inline icons ───────────────────────────────────────────────────────────
const ExternalLinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const BookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
