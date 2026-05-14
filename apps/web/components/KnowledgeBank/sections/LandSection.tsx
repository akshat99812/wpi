"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import { SectionHeader } from '../WindCards';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

// Authoritative public datasets surfaced on the Land tab. Land is an
// India-only tab — there is no per-state variant.
type LandSource = { title: string; description: string; url: string };

const LAND_SOURCES: LandSource[] = [
  {
    title: 'ISRO Bhuvan — Thematic Services',
    description: 'LULC, slope, geomorphology for India.',
    url: 'https://bhuvan.nrsc.gov.in/',
  },
  {
    title: 'Forest Survey of India — ISFR',
    description: 'Canopy density & forest cover layers.',
    url: 'https://fsi.nic.in/isfr-2021',
  },
  {
    title: 'MoEF&CC — Protected Area Network',
    description: 'Wildlife sanctuaries, national parks, ESZ.',
    url: 'https://moef.gov.in/',
  },
  {
    title: 'Global Wind Atlas',
    description: 'Independent wind resource layer (DTU / IFC).',
    url: 'https://globalwindatlas.info/',
  },
  {
    title: 'OpenStreetMap — India',
    description: 'Roads, settlements, infrastructure.',
    url: 'https://www.openstreetmap.org/relation/304716',
  },
  {
    title: 'NIWE Wind Resource Portal',
    description: 'Authoritative Indian wind resource.',
    url: 'https://maps.niwe.res.in/',
  },
];

export default function LandSection(_props: Props) {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="Land & Permitting"
        title="National — Land & Site Resources"
        delay={0}
      />

      {/* Lead-in card */}
      <div
        className="wpi-card-in relative overflow-hidden rounded-2xl border border-[#1f2c44]
                   bg-gradient-to-br from-[#0f1424] via-[#0a0f1c] to-[#0a0f1c] p-5"
        style={{ ['--wpi-delay' as string]: '60ms' }}
      >
        <div
          className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full
                     bg-[#4cc87a]/10 blur-3xl"
        />
        <div className="relative flex items-start gap-3">
          <div
            className="flex-shrink-0 grid place-items-center h-9 w-9 rounded-lg
                       bg-[#4cc87a]/12 border border-[#4cc87a]/25 text-[#4cc87a]"
          >
            <MapIcon />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#4cc87a]/85">
              Land &amp; Site Resources
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-text/80">
              The portal links directly to the authoritative terrain, land-use,
              forest-cover, protected-area, and wind-resource datasets.
            </p>
          </div>
        </div>
      </div>

      {/* Source cluster */}
      <div
        className="wpi-card-in"
        style={{ ['--wpi-delay' as string]: '120ms' }}
      >
        <div className="flex items-center gap-2 mb-2.5">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#1f2c44] to-transparent" />
          <span className="text-[9.5px] uppercase tracking-[0.16em] font-bold text-muted/60">
            Authoritative public sources
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#1f2c44] to-transparent" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {LAND_SOURCES.map((s, i) => (
            <LandSourceCard key={s.title} source={s} delay={i * 40} />
          ))}
        </div>
      </div>

      {/* Footer source line */}
      <div
        className="wpi-card-in text-[10.5px] text-muted/70 leading-relaxed pt-1"
        style={{ ['--wpi-delay' as string]: '360ms' }}
      >
        <span className="font-bold text-muted/85">Sources:&nbsp;</span>
        Bhuvan / NRSC / ISRO · FSI · Global Wind Atlas
      </div>
    </div>
  );
}

// ── Single source card ────────────────────────────────────────────────────
function LandSourceCard({ source, delay }: { source: LandSource; delay: number }) {
  const ACCENT = '#4cc87a';
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group wpi-card-in relative flex flex-col gap-1.5 rounded-xl
                 border border-[#1f2c44] bg-[#0a0f1c]/70 p-3.5
                 hover:bg-[#0f1424] hover:-translate-y-px
                 transition-all duration-200"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full opacity-70
                   group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: ACCENT }}
      />

      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-bold text-text/95 leading-snug pr-1">
          {source.title}
        </span>
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

const MapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3l-6 3v15l6-3 6 3 6-3V3l-6 3z M9 3v15 M15 6v15" />
  </svg>
);
