"use client";

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="bg-[#080c16] max-w-3xl w-full rounded-2xl border border-[#1f2c44]
                     shadow-[0_32px_80px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col max-h-[90vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* ── Hero ── */}
          <div className="relative px-6 pt-7 pb-6 border-b border-[#1a2540] flex-shrink-0 overflow-hidden">
            {/* Background glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#0d1526] via-[#0c1422] to-[#080c16]" />
            <motion.div
              aria-hidden
              className="absolute -top-20 -right-10 w-72 h-72 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(255,138,31,0.18), transparent 65%)' }}
              animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              aria-hidden
              className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(123,196,226,0.12), transparent 65%)' }}
              animate={{ scale: [1.15, 1, 1.15], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Close */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full
                         text-muted/55 hover:text-text hover:bg-white/5 transition-all text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>

            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4cc87a] shadow-[0_0_8px_#4cc87a]" />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#4cc87a]">Live</span>
                </span>
                <span className="w-1 h-1 rounded-full bg-muted/30" />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-orange/70">
                  Wind Power India
                </span>
                <span className="w-1 h-1 rounded-full bg-muted/30" />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted/55">
                  v1.0
                </span>
              </div>

              <h2 className="text-[26px] font-black text-text tracking-tight leading-[1.05]">
                Geospatial Wind <span className="bg-gradient-to-r from-orange to-[#ffd0a0] bg-clip-text text-transparent">Intelligence Terminal</span>
              </h2>
              <p className="text-[12px] text-muted/65 mt-2 max-w-[44ch] leading-relaxed">
                An open intelligence portal for India&apos;s wind sector — capacity, tariffs,
                policy, grid, and resource data, anchored to authoritative public sources.
              </p>
            </div>
          </div>

          {/* ── Scrollable body ── */}
          <div className="overflow-y-auto custom-scrollbar flex-1 px-6 py-6 flex flex-col gap-7">

            {/* ═══ Section 1: About the Portal ═══════════════════════════ */}
            <Section number="01" eyebrow="About the Portal" title="What this website does">
              <Prose>
                Wind Power India is a real-time intelligence terminal for everyone tracking
                India&apos;s wind sector — developers, IPPs, OEMs, lenders, regulators,
                researchers, and policy analysts. Every figure on the map — installed
                capacity, tariffs, auction results, policy stack, grid infrastructure,
                and 150 m wind potential — is anchored to an{' '}
                <b className="text-orange">authoritative public source</b> (MNRE, NIWE,
                CEA, SERCs, state nodal agencies). No simulated or placeholder values.
              </Prose>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
                <FeatureCard
                  icon={<MapIcon />}
                  title="Interactive India map"
                  body="Click any state to dive into its installed fleet, prime districts, tariffs, grid evacuation, and live news."
                  accent="#ff8a1f"
                />
                <FeatureCard
                  icon={<BoltIcon />}
                  title="State-level deep dives"
                  body="District-wise capacity, utility procurement context, SERC tariff orders, and Transco evacuation paths."
                  accent="#7bc4e2"
                />
                <FeatureCard
                  icon={<FeedIcon />}
                  title="Live state-specific news"
                  body="Google News–aggregated wind headlines per state, updated every 30 min — Mercom, ET, BusinessLine, PIB."
                  accent="#4cc87a"
                />
                <FeatureCard
                  icon={<ShieldIcon />}
                  title="Source-anchored data"
                  body="Tariffs from SECI / GUVNL / MSEDCL, policy from MNRE / MoP / CERC, grid from POSOCO / PGCIL, atlas from NIWE / GWA."
                  accent="#a5b4fc"
                />
              </div>

              <div className="bg-[#0d1526]/70 border border-[#1a2540] rounded-xl p-3.5 mt-3 flex gap-3">
                <span className="text-[16px] flex-shrink-0 mt-0.5">🌐</span>
                <div>
                  <div className="text-[11px] font-bold text-text/90 mb-1">Open access · No login</div>
                  <p className="text-[11px] text-muted/70 leading-relaxed">
                    The portal is free to use. Premium modules — DCF bankability, fleet
                    O&amp;M diagnostics, and CECL&apos;s 40-year proprietary dataset — sit
                    behind the engine buttons on the top bar.
                  </p>
                </div>
              </div>
            </Section>

            <Divider />

            {/* ═══ Section 2: About CECL ════════════════════════════════════ */}
            <Section number="02" eyebrow="Built by" title="CECL — 40 years of wind leadership">
              <Prose>
                <b className="text-text/90">Consolidated Energy Consultants Ltd. (CECL)</b> has
                been a trailblazer in India&apos;s renewable energy sector since{' '}
                <b className="text-orange">1986</b>, authoring the country&apos;s wind story
                from its earliest demonstration projects through today&apos;s{' '}
                <b className="text-orange">50 GW+ operating fleet</b>. Four decades of
                hands-on field work across resource assessment, micro-siting, bankability,
                construction supervision, and owner&apos;s &amp; lender&apos;s engineering have
                made CECL one of the most trusted advisors to developers, OEMs, financiers,
                state nodal agencies, and multilateral institutions in India and across
                South Asia.
              </Prose>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2.5 mt-3">
                {[
                  { value: '350+',      label: 'Clients served' },
                  { value: '600+',      label: 'Projects delivered' },
                  { value: '340+',      label: 'Locations worked' },
                  { value: '40+ yrs',   label: 'Wind domain experience' },
                  { value: '20,000 MW', label: 'Wind sites identified' },
                  { value: '5',         label: 'Countries · IN BD NP LK MU' },
                ].map((s, i) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * i + 0.1, duration: 0.3 }}
                    className="bg-[#0d1526] border border-[#1a2540] rounded-xl p-3 text-center
                               hover:border-orange/40 hover:-translate-y-0.5 transition-all"
                  >
                    <div className="text-[18px] font-black text-orange tabular-nums leading-none">{s.value}</div>
                    <div className="text-[9.5px] text-muted/60 uppercase tracking-wider mt-1.5 leading-tight">{s.label}</div>
                  </motion.div>
                ))}
              </div>

              {/* Services */}
              <div className="mt-4">
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
                      className="px-2.5 py-1 bg-[#111827] border border-[#1f2c44] rounded-full text-[10.5px]
                                 text-text/75 hover:border-orange/40 hover:text-text transition-colors"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Landmark clients */}
              <div className="mt-4">
                <SectionLabel>Landmark clients</SectionLabel>
                <div className="flex flex-wrap gap-2 mt-2">
                  {[
                    { name: 'World Bank',             accent: '#7bc4e2' },
                    { name: 'Asian Development Bank', accent: '#7bc4e2' },
                    { name: 'MNRE',                   accent: '#4cc87a' },
                    { name: 'IREDA',                  accent: '#4cc87a' },
                    { name: 'GEDA',                   accent: '#4cc87a' },
                    { name: 'MPNRED',                 accent: '#4cc87a' },
                    { name: 'Suzlon Energy',          accent: '#ff8a1f' },
                    { name: 'Inox Wind',              accent: '#ff8a1f' },
                    { name: 'ReNew Power',            accent: '#ff8a1f' },
                    { name: 'Jindal Steel',           accent: '#ff8a1f' },
                    { name: 'SBI Capital Markets',    accent: '#a5b4fc' },
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
              <div className="mt-4">
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
              <div className="mt-4">
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
                      className="flex items-center gap-2 px-3 py-2 bg-[#0d1526] border border-[#1a2540]
                                 rounded-xl text-[11px] text-text/80 font-medium hover:border-orange/30 transition-colors"
                    >
                      <span>{c.flag}</span>
                      {c.name}
                    </div>
                  ))}
                </div>
              </div>

              {/* PRO data callout */}
              <div className="mt-4 bg-gradient-to-br from-[#0f1a2e] to-[#0a1020] border border-orange/25 rounded-2xl p-4 flex gap-3.5
                              shadow-[0_0_24px_-8px_rgba(255,138,31,0.25)]">
                <div className="flex-shrink-0 mt-0.5">
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-orange/15 text-orange border border-orange/30 rounded-md">PRO</span>
                </div>
                <div>
                  <p className="text-[11.5px] font-bold text-text/90 mb-1">Coming soon · CECL 40-Year Data</p>
                  <p className="text-[11px] text-muted/70 leading-relaxed">
                    A premium base-map layer powered by CECL&apos;s proprietary 40-year field dataset —
                    site-level mast measurements, 10-minute SCADA archives, micro-siting records,
                    and post-commissioning performance benchmarks that no public dataset carries.
                    Shipping as a paid SaaS module for developers, IPPs, OEMs, lenders, and advisors.
                  </p>
                </div>
              </div>
            </Section>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-[#1a2540] bg-[#060910] flex items-center justify-between gap-4 flex-shrink-0">
            <span className="text-[10px] text-muted/45">Press <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[9px] font-mono text-muted/70">Esc</kbd> to close</span>
            <a
              href="https://cecl.in"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-orange hover:bg-[#e07818] text-[#060910]
                         px-5 py-2.5 rounded-xl font-black text-[12px] tracking-wide transition-colors
                         shadow-[0_4px_16px_-4px_rgba(255,138,31,0.5)]"
            >
              Visit cecl.in
              <ExternalLinkIcon />
            </a>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────
function Section({
  number, eyebrow, title, children,
}: {
  number: string; eyebrow: string; title: string; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[10px] font-black text-orange/55 font-mono tabular-nums tracking-wider">
          {number}
        </span>
        <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-muted/55">
          {eyebrow}
        </span>
      </div>
      <h3 className="text-[17px] font-black text-text leading-tight tracking-tight">
        {title}
      </h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function Divider() {
  return (
    <div className="relative h-px my-1">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#2a3a54] to-transparent" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-orange/40 shadow-[0_0_8px_rgba(255,138,31,0.4)]" />
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12.5px] text-muted/80 leading-relaxed">{children}</p>
  );
}

function FeatureCard({
  icon, title, body, accent,
}: {
  icon: React.ReactNode; title: string; body: string; accent: string;
}) {
  return (
    <div
      className="group bg-[#0d1526] border border-[#1a2540] rounded-xl p-3.5
                 hover:-translate-y-0.5 transition-all"
      style={{
        // border accent on hover via inline so it picks up the per-card color
        boxShadow: 'inset 0 0 0 1px transparent',
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            color:           accent,
            backgroundColor: `${accent}14`,
            border:          `1px solid ${accent}30`,
          }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-text/90 leading-tight">{title}</div>
          <p className="text-[10.5px] text-muted/65 leading-relaxed mt-1">{body}</p>
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

// ── Icons ─────────────────────────────────────────────────────────────────
const ExternalLinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
const MapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3l-6 3v15l6-3 6 3 6-3V3l-6 3z M9 3v15 M15 6v15" />
  </svg>
);
const BoltIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);
const FeedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1.5" />
  </svg>
);
const ShieldIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
