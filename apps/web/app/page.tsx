import Link from "next/link";
import TopBar from "@/components/TopBar";

export const metadata = {
  title: 'Wind Power India — Geospatial Intelligence Portal',
  description: 'Live wind energy intelligence for India: capacity, auctions, tariffs, policy, and grid data anchored to MNRE, NIWE, SECI, and state SERCs.',
};

// Hero stat tiles. Numbers sourced from MNRE RE-Statistics 2024-25
// (31.03.2025 close) and NIWE @150 m atlas.
const HERO_STATS = [
  { value: '50,038 MW',  label: 'India wind fleet',     hint: '31 Mar 2025 · MNRE' },
  { value: '1,163.86 GW', label: '@150 m potential',     hint: 'NIWE 2023' },
  { value: '11',          label: 'wind states tracked',  hint: 'plus 25 UTs surfaced' },
  { value: '21 live',     label: 'SECI tenders',         hint: 'scraped hourly' },
];

const FEATURES = [
  {
    n: '01',
    title: 'Interactive India map',
    body: 'Click any state to dive into installed fleet, prime districts, tariffs, grid evacuation, and live news. Satellite, terrain (OpenTopoMap), street, and wind-resource basemaps.',
  },
  {
    n: '02',
    title: 'State-level deep dives',
    body: 'District-wise capacity, utility procurement context, SERC tariff orders, Transco evacuation paths, and per-state FY18 → FY25 annual additions.',
  },
  {
    n: '03',
    title: 'Live tariff feed',
    body: 'SECI tender-results page scraped on every refresh — auction L1s, FDRE / RTC / hybrid tenders, offshore RfS. Plus Mercom, SolarQuarter, Renewable Watch.',
  },
  {
    n: '04',
    title: 'Source-anchored data',
    body: 'Every figure cites its primary source: MNRE physical-progress, NIWE 150 m atlas, CEA, SECI, CERC, state nodal agencies and SERCs.',
  },
];

const PILLARS = [
  'MNRE',  'NIWE',  'CEA',  'SECI',  'CERC',  'PGCIL',
  'Grid-India', 'SERCs', 'State nodal', 'Mercom',
];

export default function Landing() {
  return (
    <div className="min-h-screen w-full bg-[#090d18] text-text">
      <TopBar />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        {/* Soft orange wash + faint grid pattern for depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0
                     bg-[radial-gradient(120%_100%_at_10%_0%,rgba(255,138,31,0.10),transparent_55%),radial-gradient(80%_80%_at_90%_100%,rgba(123,196,226,0.08),transparent_55%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(80% 60% at 50% 30%, rgba(0,0,0,0.9), transparent 75%)',
            WebkitMaskImage: 'radial-gradient(80% 60% at 50% 30%, rgba(0,0,0,0.9), transparent 75%)',
          }}
        />

        <div className="relative max-w-6xl mx-auto px-6 lg:px-8 pt-20 pb-24 lg:pt-28 lg:pb-32">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em]">
            <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_8px_rgba(76,200,122,0.7)]" />
            <span className="text-orange">Wind Power India</span>
            <span className="text-white/25">·</span>
            <span className="text-white/55">v1.0</span>
          </div>

          {/* Headline */}
          <h1 className="mt-5 max-w-[20ch] text-[42px] sm:text-[56px] lg:text-[68px] font-bold leading-[1.02] tracking-tight text-white">
            Geospatial wind{' '}
            <span className="bg-gradient-to-r from-orange to-[#ffd0a0] bg-clip-text text-transparent">
              intelligence
            </span>{' '}
            terminal.
          </h1>

          <p className="mt-5 max-w-[60ch] text-[15px] lg:text-[16px] leading-relaxed text-white/65">
            Open intelligence portal for India&apos;s wind sector — capacity, tariffs,
            policy, grid, and resource data, anchored to authoritative public sources.
            Built for developers, IPPs, OEMs, lenders, regulators, and researchers.
          </p>

          {/* Primary CTAs */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 rounded-lg
                         bg-gradient-to-r from-orange to-[#ffb066]
                         text-[#0a0e18] px-5 py-3
                         text-[13.5px] font-semibold tracking-tight
                         shadow-[0_10px_28px_-8px_rgba(255,138,31,0.55)]
                         hover:shadow-[0_14px_36px_-8px_rgba(255,138,31,0.70)]
                         transition-shadow"
            >
              Open dashboard
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </Link>
            <a
              href="https://cecl.in"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg
                         border border-white/15 bg-white/[0.04]
                         text-white px-5 py-3
                         text-[13.5px] font-medium tracking-tight
                         hover:bg-white/[0.08] hover:border-white/25
                         transition-colors"
            >
              About CECL ↗
            </a>
          </div>

          {/* Hero stat strip */}
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden bg-white/[0.06] border border-white/[0.08]">
            {HERO_STATS.map(s => (
              <div key={s.label} className="bg-[#0b0e14] px-4 py-4">
                <div className="text-[18px] lg:text-[22px] font-semibold tabular-nums leading-none tracking-tight text-white">
                  {s.value}
                </div>
                <div className="text-[10.5px] text-white/55 mt-1.5 leading-tight">
                  {s.label}
                </div>
                <div className="text-[9.5px] text-white/30 mt-0.5">
                  {s.hint}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-24">
          <div className="max-w-[60ch]">
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-orange/85">
              Modules
            </div>
            <h2 className="mt-2 text-[28px] lg:text-[34px] font-semibold tracking-tight text-white leading-tight">
              Everything you need to track India&apos;s wind sector,
              in one terminal.
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEATURES.map(f => (
              <div
                key={f.n}
                className="group relative rounded-xl border border-white/[0.08] bg-white/[0.015] px-5 py-5
                           hover:bg-white/[0.035] hover:border-white/15 transition-colors"
              >
                <div className="flex items-baseline gap-3 mb-2.5">
                  <span className="text-[11px] font-mono font-medium tabular-nums tracking-wider
                                   text-orange/60 group-hover:text-orange transition-colors">
                    {f.n}
                  </span>
                  <h3 className="text-[15px] font-semibold text-white leading-tight">
                    {f.title}
                  </h3>
                </div>
                <p className="text-[12.5px] text-white/60 leading-relaxed pl-[34px]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sources strip ────────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-12 lg:py-14">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
              Anchored to
            </span>
            {PILLARS.map(p => (
              <span
                key={p}
                className="text-[12px] text-white/75 font-medium
                           px-3 py-1.5 rounded-md
                           border border-white/[0.10] bg-white/[0.025]"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Engine teaser ────────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-24
                        grid grid-cols-1 lg:grid-cols-3 gap-3">
          <EngineCard
            eyebrow="Finance"
            title="DCF & Bankability"
            body="Project-level IRR / DSCR / NPV model with capex sensitivities. Plus a contact card for CECL bankable reports."
          />
          <EngineCard
            eyebrow="Research"
            title="Resource Intelligence"
            body="State / district resource summaries, NIWE 150 m potential, repowering pool, offshore zones, FDRE economics. Premium chatbot trained on CECL's 2001–2026 archive."
            badge="PRO"
          />
          <EngineCard
            eyebrow="Operators"
            title="Fleet & O&M"
            body="Fleet performance diagnostics, P50 vs. actual benchmarking, mast / SCADA / micrositing archive."
            badge="Soon"
          />
        </div>
      </section>

      {/* ── CTA banner ────────────────────────────────────────────────── */}
      <section className="border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-16 lg:py-20">
          <div
            className="relative overflow-hidden rounded-2xl border border-orange/30
                       bg-gradient-to-br from-[#1a140a] via-[#0e1422] to-[#090d18]
                       px-6 lg:px-10 py-10 lg:py-14
                       flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full
                         bg-orange/15 blur-3xl"
            />
            <div className="relative">
              <h3 className="text-[22px] lg:text-[28px] font-semibold text-white tracking-tight leading-tight">
                Ready to dive in?
              </h3>
              <p className="mt-2 text-[13px] lg:text-[14px] text-white/65 max-w-[58ch] leading-relaxed">
                The dashboard is free, no login required. Premium modules
                — DCF bankability, fleet O&amp;M diagnostics, and CECL&apos;s
                40-year proprietary dataset — sit behind the engine buttons.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="group relative inline-flex items-center gap-2 rounded-lg
                         bg-gradient-to-r from-orange to-[#ffb066]
                         text-[#0a0e18] px-5 py-3
                         text-[13px] font-semibold tracking-tight whitespace-nowrap
                         shadow-[0_10px_28px_-8px_rgba(255,138,31,0.55)]
                         hover:shadow-[0_14px_36px_-8px_rgba(255,138,31,0.70)]
                         transition-shadow"
            >
              Open dashboard
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="bg-[#080b10]">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8 flex flex-wrap items-center justify-between gap-3 text-[11px]">
          <div className="flex items-center gap-2 text-white/45">
            <span className="text-orange/85 font-medium">Wind Power India</span>
            <span className="text-white/20">·</span>
            <span>Built by Consolidated Energy Consultants Ltd. (CECL)</span>
          </div>
          <div className="flex items-center gap-4 text-white/45">
            <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
            <a
              href="https://cecl.in"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              cecl.in ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function EngineCard({
  eyebrow, title, body, badge,
}: {
  eyebrow: string; title: string; body: string; badge?: string;
}) {
  return (
    <div className="relative rounded-xl border border-white/[0.08] bg-white/[0.015] p-5
                    hover:bg-white/[0.035] hover:border-white/15 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-orange/85">
          {eyebrow}
        </span>
        {badge && (
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em]
                           px-1.5 py-0.5 rounded
                           bg-orange/15 text-orange border border-orange/30">
            {badge}
          </span>
        )}
      </div>
      <h3 className="text-[16px] font-semibold text-white leading-tight">{title}</h3>
      <p className="mt-1.5 text-[12px] text-white/60 leading-relaxed">{body}</p>
    </div>
  );
}
