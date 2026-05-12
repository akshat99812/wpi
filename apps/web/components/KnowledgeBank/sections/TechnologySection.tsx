"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  InfoCard, Prose, SectionHeader, SourceLinks,
} from '../WindCards';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const SOURCES = [
  { label: 'MNRE ALMM (Wind)', url: 'https://mnre.gov.in/' },
  { label: 'NIWE — Type Certification', url: 'https://niwe.res.in/' },
];

const ALMM_PDF_URL =
  'https://mnre.gov.in/wp-content/uploads/2024/04/Revised-List-1-of-Models-and-Manufacturers-of-Wind-Turbines-RLMM.pdf';

export default function TechnologySection({ bundle: _bundle }: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow="OEM & Technology"
        title="MNRE ALMM (Wind)"
        delay={0}
      />

      <InfoCard
        title="Approved List of Models & Manufacturers"
        delay={60}
        defaultOpen
        icon={<CertificateIcon />}
        accent="#ff8a1f"
      >
        <Prose>
          The <b className="text-[#ffd0a0]">MNRE Approved List of Models &amp; Manufacturers (ALMM)</b> is
          the authoritative list of approved wind-turbine models and OEMs
          eligible for deployment under India&apos;s central schemes. Click the
          PDF link below for the full, current OEM roster published by MNRE.
        </Prose>

        <a
          href={ALMM_PDF_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-1 self-start
                     bg-gradient-to-r from-orange/20 to-orange/5
                     hover:from-orange/30 hover:to-orange/10
                     border border-orange/40 hover:border-orange/60
                     rounded-lg px-3.5 py-2 transition-all"
        >
          <PdfIcon />
          <span className="text-[11.5px] font-bold text-[#ffd0a0]">
            Open MNRE ALMM (Wind) — PDF
          </span>
          <ExternalLinkIcon />
        </a>
      </InfoCard>

      <InfoCard
        title="Authoritative sources for this tab"
        delay={120}
        icon={<BookIcon />}
        accent="#7bc4e2"
      >
        <div className="flex flex-col gap-2.5">
          <SourceRow
            title="MNRE — Approved List of Models & Manufacturers (ALMM) — Wind Turbines"
            description="Authoritative MNRE list of approved wind-turbine models & OEMs for deployment under government-supported schemes."
            href="https://mnre.gov.in/"
          />
          <SourceRow
            title="NIWE — Type Certification & Technology Regulation"
            description="Type-certification authority for wind turbines deployed in India."
            href="https://niwe.res.in/"
          />
        </div>
      </InfoCard>

      <SourceLinks sources={SOURCES} delay={180} />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────
function SourceRow({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3
                 hover:border-[#7bc4e2]/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-bold text-text/90 leading-snug group-hover:text-[#cfe7f4] transition-colors">
          {title}
        </span>
        <ExternalLinkIcon />
      </div>
      <p className="text-[10.5px] text-muted/70 leading-relaxed mt-1.5">
        {description}
      </p>
    </a>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────
const CertificateIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="6" />
    <path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5" />
  </svg>
);
const PdfIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange flex-shrink-0">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="15" x2="15" y2="15" />
    <line x1="9" y1="18" x2="13" y2="18" />
  </svg>
);
const BookIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
const ExternalLinkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted/55 flex-shrink-0">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
