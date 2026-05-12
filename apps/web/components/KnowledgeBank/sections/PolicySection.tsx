"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  InfoCard, Prose, ChipRow, SectionHeader, EmptyState, SourceLinks,
} from '../WindCards';
import { STATE_PROFILES } from '../stateProfiles';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

// ── The central policy stack ───────────────────────────────────────────────
// Curated from MNRE / MoP / CERC notifications. Marked "active" + last
// significant update so users can see what's current vs. legacy.
const CENTRAL_POLICIES = [
  {
    title:  'MNRE Wind Policy & Guidelines',
    issuer: 'MNRE',
    year:   '2016, updated 2024',
    tag:    'Sectoral',
    accent: '#ff8a1f',
    blurb:  'Master sectoral framework — bidding norms, ALMM, payment security, ISTS-waiver eligibility, repowering guidelines.',
    url:    'https://mnre.gov.in/wind-energy/',
  },
  {
    title:  'National Wind-Solar Hybrid Policy',
    issuer: 'MNRE',
    year:   '2018, amended 2024',
    tag:    'Hybrid',
    accent: '#7bc4e2',
    blurb:  'Defines hybrid plant configuration, AC/DC integration, FDRE eligibility. Foundation for SECI Tranche XII–XV hybrid rounds.',
    url:    'https://mnre.gov.in/hybrid-energy/',
  },
  {
    title:  'National Offshore Wind Energy Policy',
    issuer: 'MNRE',
    year:   '2015, updated 2024',
    tag:    'Offshore',
    accent: '#a5b4fc',
    blurb:  'EEZ block allocation, NIWE survey-rights regime, VGF support framework. Operational for Gulf of Kutch & Dhanushkodi blocks.',
    url:    'https://mnre.gov.in/offshore-wind-energy/',
  },
  {
    title:  'Green Energy Open Access Rules',
    issuer: 'MoP',
    year:   '2022, amended 2023, 2025',
    tag:    'Open Access',
    accent: '#4cc87a',
    blurb:  '100 kW minimum threshold, deemed approval for OA applications, banking & wheeling charges capped. C&I tailwind.',
    url:    'https://powermin.gov.in/en/content/green-energy-open-access-rules-2022',
  },
  {
    title:  'CERC RE Tariff Regulations',
    issuer: 'CERC',
    year:   'CERC Reg. 2024',
    tag:    'Tariff',
    accent: '#ffb066',
    blurb:  'Generic tariff norms for non-bid wind, normative parameters (CUF, debt-equity, ROE), benchmark capex per MW class.',
    url:    'https://cercind.gov.in/Regulations/regulations.html',
  },
  {
    title:  'ISTS Charge Waiver — RE',
    issuer: 'MoP',
    year:   '2023, extended to Jun 2025',
    tag:    'Transmission',
    accent: '#67e8f9',
    blurb:  'Inter-state transmission charge waiver for projects commissioned by 30 Jun 2025; partial-rebate phase to FY28.',
    url:    'https://powermin.gov.in/en/content/inter-state-transmission-charges-and-losses',
  },
  {
    title:  'Repowering & Life-Extension Policy',
    issuer: 'MNRE',
    year:   '2022 (draft), 2023 (operational)',
    tag:    'Repowering',
    accent: '#f87171',
    blurb:  'Replacement-of-old-WTGs framework, PPA renegotiation guidance, IT/SGD concessions. State alignment via CERC/SERC.',
    url:    'https://mnre.gov.in/wind-energy/',
  },
];

const SOURCES = [
  { label: 'MNRE Policies', url: 'https://mnre.gov.in/policies' },
  { label: 'MoP Notifications', url: 'https://powermin.gov.in/' },
  { label: 'CERC Orders', url: 'https://cercind.gov.in/' },
  { label: 'PIB Press Releases', url: 'https://pib.gov.in/' },
];

export default function PolicySection({ bundle, selectedState }: Props) {
  const profile = selectedState ? STATE_PROFILES[selectedState] ?? null : null;

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow={selectedState ? `${selectedState} · Policy Anchor` : 'Central Government'}
        title={selectedState ? `Policy — ${selectedState}` : 'Policy — Central Stack'}
        delay={0}
      />

      {/* State-specific policy + nodal context */}
      {profile && (
        <>
          <InfoCard
            title={`${selectedState} — state policy & nodal stack`}
            delay={30}
            defaultOpen
            icon={<DocIcon />}
            accent="#ff8a1f"
          >
            <Prose>
              State policy anchor: <b className="text-[#ffd0a0]">{profile.policyAnchor}</b>.
            </Prose>
            {profile.sectorProfile.map((para, i) => (
              <Prose key={i}>{para}</Prose>
            ))}
          </InfoCard>

          <div className="flex items-center gap-2 mt-1 mb-1 px-1">
            <span className="h-px flex-1 bg-[#2a3a54]/60" />
            <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-muted/45">
              Central stack applies on top
            </span>
            <span className="h-px flex-1 bg-[#2a3a54]/60" />
          </div>
        </>
      )}

      {/* Issuer chip overview */}
      <div
        className="wpi-card-in bg-[#0a0f1c]/40 border border-[#1f2c44] rounded-xl p-3.5"
        style={{ ['--wpi-delay' as string]: '60ms' }}
      >
        <span className="text-[9.5px] text-muted/55 uppercase tracking-[0.12em] font-bold">
          Issuing bodies
        </span>
        <ChipRow chips={[
          { label: 'Sectoral',     value: 'MNRE',  accent: '#ff8a1f' },
          { label: 'Power System', value: 'MoP',   accent: '#4cc87a' },
          { label: 'Tariffs',      value: 'CERC',  accent: '#ffb066' },
          { label: 'Procurement',  value: 'SECI',  accent: '#7bc4e2' },
          { label: 'Resource',     value: 'NIWE',  accent: '#a5b4fc' },
        ]} />
      </div>

      {/* Each policy as its own InfoCard */}
      {CENTRAL_POLICIES.map((p, i) => (
        <InfoCard
          key={p.title}
          title={p.title}
          delay={120 + i * 60}
          defaultOpen={i === 0}
          icon={<DocIcon />}
          accent={p.accent}
        >
          <div className="flex items-center gap-2.5 mb-1 flex-wrap">
            <span
              className="text-[9.5px] px-2 py-1 rounded-md font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${p.accent}15`,
                border: `1px solid ${p.accent}30`,
                color: p.accent,
              }}
            >
              {p.tag}
            </span>
            <span className="text-[10px] text-muted/65 font-mono">
              {p.issuer} · {p.year}
            </span>
          </div>
          <Prose>{p.blurb}</Prose>
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity"
            style={{ color: p.accent }}
          >
            View on {p.issuer}
            <ExternalLinkIcon />
          </a>
        </InfoCard>
      ))}

      {/* Live policy feed from bundle */}
      {bundle?.policies?.length ? (
        <InfoCard
          title="Recent notifications (live feed)"
          delay={120 + CENTRAL_POLICIES.length * 60}
          icon={<BellIcon />}
          accent="#4cc87a"
          defaultOpen
        >
          <div className="flex flex-col gap-2">
            {bundle.policies.slice(0, 6).map((p, i) => {
              const d = p.publishedAt
                ? new Date(p.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
                : '';
              return (
                <a
                  key={i}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3 hover:border-orange/50 hover:bg-[#0a0f1c]/80 transition-all"
                >
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[9px] px-2 py-0.5 bg-orange/15 text-orange rounded-md font-bold uppercase tracking-wider">
                      {p.category}
                    </span>
                    <span className="text-[9.5px] text-muted/60 ml-auto font-mono">{d}</span>
                  </div>
                  <p className="text-[12px] text-text/85 leading-snug font-medium">{p.title}</p>
                </a>
              );
            })}
          </div>
        </InfoCard>
      ) : (
        <EmptyState
          delay={120 + CENTRAL_POLICIES.length * 60}
          message="No live policy notifications in bundle. Run the orchestrator to fetch the latest PIB/MNRE feed."
        />
      )}

      <SourceLinks sources={SOURCES} delay={180 + CENTRAL_POLICIES.length * 60} />
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
const DocIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h4" />
  </svg>
);
const BellIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
  </svg>
);
