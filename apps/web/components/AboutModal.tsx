"use client";

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';

export default function AboutModal({ onClose, potentialGw }: { onClose: () => void; potentialGw?: number }) {
  const potentialDisplay = `${Math.round(potentialGw ?? 1163.9).toLocaleString()} GW`;
  // Esc-to-close. Captured at window level. `capture: true` runs the
  // handler in the capture phase so it isn't swallowed by any focused
  // element (inputs, buttons) that might call stopPropagation in bubble.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true } as EventListenerOptions);
  }, [onClose]);

  return (
    // Outer backdrop. The parent <TopBar> already wraps this component in
    // an <AnimatePresence>, so we don't nest another one here — nested
    // AnimatePresence siblings can hold a stale, transitioning DOM tree
    // that still receives clicks but no longer reacts to them.
    <motion.div
      key="about-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="bg-[#0b0e14] max-w-3xl w-full rounded-2xl border border-white/10
                   shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
          {/* ── Header ──────────────────────────────────────────────── */}
          <header
            className="relative px-8 pt-8 pb-7 border-b border-white/[0.06] flex-shrink-0
                       bg-[radial-gradient(120%_140%_at_0%_0%,rgba(255,138,31,0.10),transparent_55%)]"
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="absolute top-4 right-4 z-20 w-8 h-8 flex items-center justify-center rounded-md
                         text-white/50 hover:text-white hover:bg-white/[0.08] active:bg-white/[0.12]
                         transition-colors text-[20px] leading-none cursor-pointer"
              aria-label="Close"
            >
              ×
            </button>

            <div className="flex items-center gap-2 mb-4 text-[11px] font-medium tracking-tight">
              <span className="inline-flex items-center gap-1.5 text-orange">
                <span className="w-1.5 h-1.5 rounded-full bg-orange" />
                Wind Power India
              </span>
              <span className="text-white/20">/</span>
              <span className="text-white/55">About</span>
            </div>

            <h2 className="text-[28px] font-semibold text-white tracking-tight leading-[1.1]">
              Geospatial wind <span className="text-orange">intelligence</span> terminal
            </h2>
            <p className="text-[13.5px] text-white/60 mt-2.5 max-w-[56ch] leading-relaxed">
              An open intelligence portal for India&apos;s wind sector — capacity, tariffs,
              policy, grid, and resource data, anchored to authoritative public sources.
            </p>

            {/* Quiet stat strip — gives the hero visual anchor without a big graphic. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
              <HeroStat value="50 GW+" label="India fleet" />
              <HeroStat value={potentialDisplay} label="@150 m potential" accent />
              <HeroStat value="600+" label="CECL projects" />
            </div>
          </header>

          {/* ── Body ──────────────────────────────────────────────────── */}
          <div className="overflow-y-auto custom-scrollbar flex-1 px-8 py-8 flex flex-col gap-10">

            {/* ── About the Portal ─────────────────────────────────── */}
            <section className="flex flex-col gap-4">
              <SectionHeader title="About the portal" />

              <Prose>
                A real-time intelligence terminal for everyone tracking India&apos;s wind
                sector — developers, IPPs, OEMs, lenders, regulators, researchers, and
                policy analysts. Every figure is anchored to an authoritative public
                source (<span className="text-white/85">MNRE · NIWE · CEA · SERCs · state nodal agencies</span>). No simulated values.
              </Prose>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                {[
                  { n: '01', title: 'Interactive India map',     body: 'Click any state to dive into installed fleet, prime districts, tariffs, grid evacuation, and live news.' },
                  { n: '02', title: 'State-level deep dives',    body: 'District-wise capacity, utility procurement context, SERC tariff orders, and Transco evacuation paths.' },
                  { n: '03', title: 'Live state-specific news',  body: 'Google News-aggregated wind headlines per state, refreshed every 30 minutes.' },
                  { n: '04', title: 'Source-anchored data',      body: 'Tariffs from SECI / GUVNL / MSEDCL, policy from MNRE / MoP / CERC, grid from POSOCO / PGCIL, atlas from NIWE / GWA.' },
                ].map(f => (
                  <FeatureRow key={f.n} index={f.n} title={f.title} body={f.body} />
                ))}
              </div>

              <div
                className="mt-1 rounded-lg border border-white/[0.08] px-4 py-3
                           bg-gradient-to-br from-white/[0.025] to-transparent
                           flex items-start gap-3"
              >
                <span className="mt-[5px] block w-1.5 h-1.5 rounded-full bg-[#4cc87a] shadow-[0_0_8px_rgba(76,200,122,0.6)] flex-shrink-0" />
                <div>
                  <div className="text-[12.5px] font-medium text-white/90 leading-tight">
                    Open access · no login required
                  </div>
                  <p className="text-[12px] text-white/55 leading-relaxed mt-1">
                    The portal is free to use. Premium modules — DCF bankability,
                    fleet O&amp;M diagnostics, and CECL&apos;s 40-year proprietary
                    dataset — sit behind the engine buttons on the top bar.
                  </p>
                </div>
              </div>
            </section>

            {/* ── Built by ─────────────────────────────────────────── */}
            <section className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <SectionHeader title="Built by CECL" />
                <span className="text-[10px] font-mono font-medium tracking-wider text-orange/75 tabular-nums">
                  EST. 1986
                </span>
              </div>

              <Prose>
                <span className="text-white/90 font-medium">Consolidated Energy Consultants Ltd.</span>{' '}
                has been a trailblazer in India&apos;s renewable energy sector since
                1986 — authoring the country&apos;s wind story from early demonstration
                projects through today&apos;s <span className="text-orange/90 font-medium">50 GW+</span>{' '}
                operating fleet. Four decades of fieldwork across resource assessment,
                micro-siting, bankability, construction supervision, and owner&apos;s
                &amp; lender&apos;s engineering.
              </Prose>

              {/* Stat grid — bigger numbers, restrained accent on the headline figure */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px mt-1 bg-white/[0.06] border border-white/[0.08] rounded-lg overflow-hidden">
                {[
                  { value: '350+',      label: 'Clients served',         accent: false },
                  { value: '600+',      label: 'Projects delivered',     accent: false },
                  { value: '340+',      label: 'Locations worked',       accent: false },
                  { value: '40+ yrs',   label: 'Wind domain experience', accent: false },
                  { value: '20,000 MW', label: 'Wind sites identified',  accent: true  },
                  { value: '7',         label: 'Countries · IN BD NP LK MU MV + Africa', accent: false },
                ].map(s => (
                  <div
                    key={s.label}
                    className="relative bg-[#0b0e14] px-4 py-4 hover:bg-white/[0.015] transition-colors"
                  >
                    {s.accent && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full bg-orange"
                      />
                    )}
                    <div
                      className={`text-[22px] font-semibold tabular-nums leading-none tracking-tight
                                 ${s.accent ? 'text-orange' : 'text-white'}`}
                    >
                      {s.value}
                    </div>
                    <div className="text-[10.5px] text-white/50 mt-2 leading-tight">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Landmark clients — flat chips with restrained accent dot */}
              <div className="mt-1">
                <SubLabel>Landmark clients</SubLabel>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {[
                    'World Bank',
                    'Asian Development Bank',
                    'MNRE',
                    'IREDA',
                    'GEDA',
                    'MPNRED',
                    'Suzlon Energy',
                    'Inox Wind',
                    'ReNew Power',
                    'Jindal Steel',
                    'SBI Capital Markets',
                  ].map(c => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
                                 text-[11px] text-white/75 font-medium
                                 border border-white/[0.10] bg-white/[0.025]
                                 hover:border-white/20 hover:text-white transition-colors"
                    >
                      <span className="w-1 h-1 rounded-full bg-white/30" />
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              {/* ── PRO callout — glass card with quiet ambient motion ── */}
              <ProCard />
            </section>
          </div>

          {/* ── Footer ──────────────────────────────────────────────── */}
          <footer className="px-8 py-4 border-t border-white/[0.06] bg-[#080b10]
                             flex items-center justify-between gap-4 flex-shrink-0">
            <span className="text-[11px] text-white/35">
              Press <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[10px] font-mono text-white/55">Esc</kbd> to close
            </span>
            <a
              href="https://cecl.in"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-white text-[#0b0e14]
                         px-4 py-2 rounded-lg font-semibold text-[12px] tracking-tight
                         hover:bg-white/90 transition-colors"
            >
              Visit cecl.in
              <ExternalLinkIcon />
            </a>
          </footer>
      </motion.div>
    </motion.div>
  );
}

/* The duplicate closing tags above belong to the existing modal scaffold.
   Below this is just the standalone PRO card. */
function ProCard() {
  return (
    <div
      className="group relative mt-2 overflow-hidden rounded-2xl
                 border border-white/[0.10]
                 bg-[linear-gradient(160deg,rgba(20,26,40,0.85),rgba(11,14,20,0.92))]
                 backdrop-blur-2xl backdrop-saturate-150
                 shadow-[0_28px_60px_-24px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(255,138,31,0.10)]
                 transition-shadow duration-300 hover:shadow-[0_36px_72px_-22px_rgba(255,138,31,0.18),inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,138,31,0.22)]"
    >
      {/* Local animation keyframes */}
      <style>{`
        @keyframes pc-drift-a { 0%,100%{transform:translate3d(0,0,0)scale(1);} 50%{transform:translate3d(6%,-4%,0)scale(1.08);} }
        @keyframes pc-drift-b { 0%,100%{transform:translate3d(0,0,0)scale(1);} 50%{transform:translate3d(-5%,6%,0)scale(1.10);} }
        @keyframes pc-shimmer { 0%{transform:translateX(-160%);} 100%{transform:translateX(160%);} }
        @keyframes pc-pulse   { 0%,100%{opacity:0.7;transform:scale(1);} 50%{opacity:1;transform:scale(1.18);} }
        @keyframes pc-grid-glide { 0%{background-position:0 0;} 100%{background-position:24px 24px;} }
      `}</style>

      {/* Layer 1 — slow-drifting orange & cyan orbs (ambient depth) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-16 -right-12 h-56 w-56 rounded-full bg-orange/22 blur-3xl"
          style={{ animation: 'pc-drift-a 14s ease-in-out infinite' }}
        />
        <div
          className="absolute -bottom-16 -left-10 h-48 w-48 rounded-full bg-[#7bc4e2]/12 blur-3xl"
          style={{ animation: 'pc-drift-b 18s ease-in-out infinite' }}
        />
      </div>

      {/* Layer 2 — subtle grid pattern that gently glides */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage:
            'radial-gradient(120% 140% at 100% 0%, rgba(0,0,0,0.85), transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(120% 140% at 100% 0%, rgba(0,0,0,0.85), transparent 70%)',
          animation: 'pc-grid-glide 40s linear infinite',
        }}
      />

      {/* Layer 3 — one-shot specular sweep on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3
                   bg-gradient-to-r from-transparent via-white/[0.10] to-transparent
                   opacity-0 group-hover:opacity-100"
        style={{ animation: 'pc-shimmer 1.6s ease-out 0s 1', animationPlayState: 'paused' }}
      />
      <style>{`
        .group:hover .pc-shimmer-trigger { animation-play-state: running; }
      `}</style>

      <div className="relative p-5 sm:p-6 flex flex-col gap-5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.14em]
                         px-2 py-0.5 rounded bg-orange text-[#0b0e14]
                         shadow-[0_0_18px_-4px_rgba(255,138,31,0.6)]"
            >
              PRO
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-white/60">
              <span
                className="w-1.5 h-1.5 rounded-full bg-orange shadow-[0_0_8px_rgba(255,138,31,0.7)]"
                style={{ animation: 'pc-pulse 2.2s ease-in-out infinite' }}
              />
              Coming soon
            </span>
          </div>
          <a
            href="mailto:info@cecl.in?subject=CECL%2040-Year%20Dataset%20%E2%80%94%20Early%20Access"
            className="group/cta inline-flex items-center gap-1 text-[10.5px] font-semibold
                       uppercase tracking-[0.08em] text-orange/90 hover:text-orange transition-colors"
          >
            Request early access
            <span className="transition-transform duration-200 group-hover/cta:translate-x-0.5">→</span>
          </a>
        </div>

        {/* Title + tagline */}
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[18px] font-semibold text-white leading-tight tracking-tight">
            CECL 40-year wind dataset
          </h4>
          <p className="text-[12.5px] text-white/65 leading-relaxed max-w-[54ch]">
            A premium base-map layer drawn from four decades of in-field wind
            work — the kind of site-resolved intelligence no public dataset
            carries.
          </p>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        {/* Audience strip */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-white/35">
            Built for
          </span>
          {['Developers', 'IPPs', 'OEMs', 'Lenders', 'Advisors'].map(a => (
            <span
              key={a}
              className="text-[10.5px] text-white/70 px-2 py-0.5 rounded-md
                         border border-white/[0.10] bg-white/[0.025]
                         backdrop-blur-sm
                         hover:border-white/20 hover:text-white transition-colors"
            >
              {a}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-[15px] font-semibold text-white tracking-tight">
      {title}
    </h3>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">
      {children}
    </span>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-white/65 leading-relaxed">{children}</p>
  );
}

function FeatureRow({
  index, title, body,
}: { index: string; title: string; body: string }) {
  return (
    <div
      className="group relative rounded-lg border border-white/[0.08] bg-white/[0.015] px-4 py-3
                 hover:bg-white/[0.035] hover:border-white/15 transition-colors"
    >
      <div className="flex items-baseline gap-2.5">
        <span className="text-[10px] font-mono font-medium tabular-nums tracking-wider
                         text-orange/65 group-hover:text-orange transition-colors">
          {index}
        </span>
        <div className="text-[12.5px] font-medium text-white/90 leading-tight">
          {title}
        </div>
      </div>
      <p className="text-[11.5px] text-white/55 leading-relaxed mt-1 pl-[28px]">
        {body}
      </p>
    </div>
  );
}

function HeroStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={`text-[14px] font-semibold tabular-nums leading-none tracking-tight
                   ${accent ? 'text-orange' : 'text-white/90'}`}
      >
        {value}
      </span>
      <span className="text-[10.5px] text-white/45 leading-none">{label}</span>
    </div>
  );
}

const ExternalLinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
