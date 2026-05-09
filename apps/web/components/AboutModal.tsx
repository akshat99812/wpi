"use client";

import React, { useEffect } from 'react';

export default function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#080c16] max-w-3xl w-full rounded-2xl border border-[#1f2c44] shadow-[0_32px_80px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="relative px-6 pt-6 pb-5 border-b border-[#1a2540] bg-gradient-to-br from-[#0d1526] to-[#080c16] flex-shrink-0">
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full text-muted/50 hover:text-text hover:bg-white/5 transition-all text-lg leading-none"
          >
            ×
          </button>

          {/* Eyebrow */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-orange/70">
              Since 1986 · Bhopal
            </span>
            <span className="w-1 h-1 rounded-full bg-muted/30" />
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted/50">
              40 years of wind leadership
            </span>
          </div>

          {/* Title */}
          <h2 className="text-[22px] font-black text-text tracking-tight leading-none">
            Curated by{' '}
            <span className="text-orange">CECL</span>
          </h2>
          <p className="text-[11px] text-muted/60 mt-1 font-medium">
            Consolidated Energy Consultants Ltd.
          </p>
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto custom-scrollbar flex-1 px-6 py-5 flex flex-col gap-5">

          {/* About paragraph */}
          <p className="text-[12.5px] text-muted/80 leading-relaxed">
            CECL has been a trailblazer in India&apos;s renewable energy sector since{' '}
            <b className="text-text/90">1986</b> — authoring the country&apos;s wind story from its earliest
            demonstration projects through today&apos;s{' '}
            <b className="text-orange">50 GW+ operating fleet</b>. Four decades of hands-on field work
            across resource assessment, micro-siting, bankability, construction supervision, and
            owner&apos;s &amp; lender&apos;s engineering have made CECL one of the most trusted advisors to
            developers, OEMs, financiers, state nodal agencies, and multilateral institutions in
            India and across South Asia.
          </p>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { value: '350+',      label: 'Clients served' },
              { value: '600+',      label: 'Projects delivered' },
              { value: '340+',      label: 'Locations worked' },
              { value: '40+ yrs',  label: 'Wind domain experience' },
              { value: '20,000 MW', label: 'Wind sites identified' },
              { value: '5',         label: 'Countries · IN BD NP LK MU' },
            ].map(s => (
              <div
                key={s.label}
                className="bg-[#0d1526] border border-[#1a2540] rounded-xl p-3 text-center hover:border-orange/30 transition-colors"
              >
                <div className="text-[18px] font-black text-orange tabular-nums leading-none">{s.value}</div>
                <div className="text-[9.5px] text-muted/60 uppercase tracking-wider mt-1.5 leading-tight">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Services */}
          <div>
            <SectionLabel>End-to-end value chain</SectionLabel>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                'Wind Resource Assessment', 'Site Identification', 'Micro-siting & Yield',
                'Energy Estimation & Validation', 'Feasibility Studies', 'DPR Preparation',
                'Design & Engineering', 'Due Diligence', "Owner's & Lender's Engineering",
                'Procurement & Contracting', 'Construction & Commissioning Supervision',
                'Solar–Wind Hybrid Systems', 'Offshore Wind Feasibility',
                'O&M Performance Diagnostics', 'Repowering Studies',
              ].map(s => (
                <span
                  key={s}
                  className="px-2.5 py-1 bg-[#111827] border border-[#1f2c44] rounded-full text-[10.5px] text-text/75 hover:border-orange/40 hover:text-text transition-colors"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Landmark clients */}
          <div>
            <SectionLabel>Landmark clients</SectionLabel>
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { name: 'World Bank',          accent: '#7bc4e2' },
                { name: 'Asian Development Bank', accent: '#7bc4e2' },
                { name: 'MNRE',                accent: '#4cc87a' },
                { name: 'IREDA',               accent: '#4cc87a' },
                { name: 'GEDA',                accent: '#4cc87a' },
                { name: 'MPNRED',              accent: '#4cc87a' },
                { name: 'Suzlon Energy',        accent: '#ff8a1f' },
                { name: 'Inox Wind',            accent: '#ff8a1f' },
                { name: 'ReNew Power',          accent: '#ff8a1f' },
                { name: 'Jindal Steel',         accent: '#ff8a1f' },
                { name: 'SBI Capital Markets',  accent: '#a5b4fc' },
              ].map(c => (
                <span
                  key={c.name}
                  className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold"
                  style={{
                    color: c.accent,
                    backgroundColor: `${c.accent}12`,
                    border: `1px solid ${c.accent}25`,
                  }}
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>

          {/* Signature engagements */}
          <div>
            <SectionLabel>Signature engagements</SectionLabel>
            <div className="flex flex-col gap-2 mt-2">
              {[
                {
                  who:  'World Bank & IREDA, 1993',
                  what: 'Authored the national Guidelines for DPR & Tendering of Wind Power Projects — a foundational reference document for India\'s wind sector.',
                },
                {
                  who:  'Asian Development Bank',
                  what: 'Prepared the Business Plan for scaling private investment in India\'s wind energy sector.',
                },
                {
                  who:  'MNRE, 2009',
                  what: 'Repowering study of demonstration wind farm projects in Gujarat and Tamil Nadu.',
                },
                {
                  who:  'Inox Wind, 2011',
                  what: 'Greenfield site identification for the MPNRED RFP in Madhya Pradesh.',
                },
                {
                  who:  'Suzlon Energy',
                  what: 'Engineering supervision during construction, erection and commissioning of wind energy projects.',
                },
                {
                  who:  'Directory Indian Windpower',
                  what: 'Flagship annual publication since 2001; the 25th Silver Jubilee Edition (2025) is the reference dataset for India\'s wind industry.',
                },
              ].map(e => (
                <div
                  key={e.who}
                  className="bg-[#0d1526] border border-[#1a2540] rounded-xl p-3.5 hover:border-orange/30 transition-colors flex gap-3"
                >
                  <span className="w-0.5 self-stretch rounded-full bg-orange/40 flex-shrink-0" />
                  <div>
                    <div className="text-[11px] font-bold text-orange/90 mb-1">{e.who}</div>
                    <div className="text-[11.5px] text-muted/75 leading-relaxed">{e.what}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* International footprint */}
          <div>
            <SectionLabel>International footprint</SectionLabel>
            <div className="flex gap-2 mt-2 flex-wrap">
              {[
                { flag: '🇮🇳', name: 'India' },
                { flag: '🇧🇩', name: 'Bangladesh' },
                { flag: '🇳🇵', name: 'Nepal' },
                { flag: '🇱🇰', name: 'Sri Lanka' },
                { flag: '🇲🇺', name: 'Mauritius' },
              ].map(c => (
                <div
                  key={c.name}
                  className="flex items-center gap-2 px-3 py-2 bg-[#0d1526] border border-[#1a2540] rounded-xl text-[11px] text-text/80 font-medium hover:border-orange/30 transition-colors"
                >
                  <span>{c.flag}</span>
                  {c.name}
                </div>
              ))}
            </div>
          </div>

          {/* PRO data callout */}
          <div className="bg-gradient-to-br from-[#0f1a2e] to-[#0a1020] border border-orange/20 rounded-2xl p-4 flex gap-3.5">
            <div className="flex-shrink-0 mt-0.5">
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-orange/15 text-orange border border-orange/30 rounded-md">PRO</span>
            </div>
            <div>
              <p className="text-[11px] font-bold text-text/90 mb-1">Coming soon · CECL 40 Yr Data</p>
              <p className="text-[11px] text-muted/65 leading-relaxed">
                A premium base-map layer powered by CECL&apos;s proprietary 40-year field dataset — site-level
                mast measurements, 10-minute SCADA archives, micro-siting records, and
                post-commissioning performance benchmarks that no public dataset carries. Shipping as
                a paid SaaS module for developers, IPPs, OEMs, lenders, and advisors.
              </p>
            </div>
          </div>

          {/* Portal note */}
          <p className="text-[10.5px] text-muted/45 leading-relaxed pb-1">
            Wind Power India is a public-interest intelligence portal assembled by CECL. Every figure
            on this map — capacity, tariffs, policy, grid infrastructure, and wind resource — is
            anchored to an authoritative source (MNRE, NIWE, CEA, SERCs, state nodal agencies); no
            simulated or placeholder values.
          </p>
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-[#1a2540] bg-[#060910] flex items-center justify-between gap-4 flex-shrink-0">
          <span className="text-[10px] text-muted/40">Press Esc to close</span>
          <a
            href="https://cecl.in"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-orange hover:bg-[#e07818] text-[#060910] px-5 py-2.5 rounded-xl font-black text-[12px] tracking-wide transition-colors"
          >
            Visit cecl.in
            <ExternalLinkIcon />
          </a>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted/45">
      {children}
    </span>
  );
}

const ExternalLinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
