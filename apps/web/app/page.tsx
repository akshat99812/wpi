import Link from "next/link";
import TopBar from "@/components/TopBar";
import { TypingAnimation } from "@/registry/magicui/typing-animation";
import { Marquee } from "@/registry/magicui/marquee";

export const metadata = {
  title: 'Wind Power India — Geospatial Intelligence Portal',
  description: 'Live wind energy intelligence for India: capacity, auctions, tariffs, policy, and grid data anchored to MNRE, NIWE, SECI, and state SERCs.',
};

type HeroStat = {
  value: string;
  label: string;
  source: string;
  asOf: string;
  delta?: { value: string; trend: 'up' | 'down' | 'flat' };
  glyph: 'turbine' | 'gauge' | 'map' | 'gavel';
};

// Hero stat tiles. Numbers sourced from MNRE RE-Statistics 2024-25
// (31.03.2025 close) and NIWE @150 m atlas.
const HERO_STATS: HeroStat[] = [
  {
    value: '50,038 MW',
    label: 'India wind fleet',
    source: 'MNRE',
    asOf: '31 Mar 2025',
    delta: { value: '+3.42 GW FY25', trend: 'up' },
    glyph: 'turbine',
  },
  {
    value: '1,163.86 GW',
    label: '@150 m potential',
    source: 'NIWE Atlas',
    asOf: '2023',
    delta: { value: '~7× installed', trend: 'up' },
    glyph: 'gauge',
  },
  {
    value: '11',
    label: 'wind states tracked',
    source: 'CECL · State SERCs',
    asOf: 'live',
    delta: { value: '+25 UTs surfaced', trend: 'flat' },
    glyph: 'map',
  },
  {
    value: '21 live',
    label: 'SECI tenders',
    source: 'SECI feed',
    asOf: 'scraped hourly',
    delta: { value: 'auctions · FDRE · RfS', trend: 'up' },
    glyph: 'gavel',
  },
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
      <section className="relative overflow-hidden border-b border-[#1a2540]">
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

        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 pt-20 pb-24 lg:pt-28 lg:pb-32">
          {/* Headline + typewriter rotator below */}
          <h1 className="max-w-[20ch] text-[42px] sm:text-[56px] lg:text-[64px] font-bold leading-[1.02] tracking-tight text-text">
            Geospatial wind{' '}
            <span className="bg-gradient-to-r from-orange to-[#ffd0a0] bg-clip-text text-transparent">
              intelligence
            </span>{' '}
            terminal.
          </h1>

          <div className="mt-4 flex items-baseline gap-3 text-[18px] sm:text-[22px] lg:text-[26px] font-semibold tracking-tight text-muted/90">
            <span className="text-orange/85">›</span>
            <TypingAnimation
              words={["Map 🗺️", "Analyse 📊", "Tender 📑", "Bank 💼", "Ship 🚀"]}
              loop
              cursorClassName="text-orange/80"
              className="text-text"
            />
          </div>

          <p className="mt-6 max-w-[60ch] text-[15px] lg:text-[16px] leading-relaxed text-muted/95">
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
                         border border-[#2a3a54] bg-[#0d1424]
                         text-text px-5 py-3
                         text-[13.5px] font-medium tracking-tight
                         hover:bg-[#131826] hover:border-orange/40
                         transition-colors"
            >
              About CECL ↗
            </a>
          </div>

          {/* Hero stat ticker — premium cards in an auto-scrolling marquee,
              pauses on hover so the user can read individual tiles. */}
          <div className="mt-12 relative">
            <Marquee
              pauseOnHover
              repeat={4}
              className="[--duration:46s] [--gap:14px] py-2"
            >
              {HERO_STATS.map(s => <HeroStatCard key={s.label} stat={s} />)}
            </Marquee>
            {/* Edge fades so cards bleed in/out softly instead of clipping */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[#090d18] to-transparent" />
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#090d18] to-transparent" />
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="border-b border-[#1a2540]">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-24">
          <div className="max-w-[60ch]">
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-orange/85">
              Modules
            </div>
            <h2 className="mt-2 text-[28px] lg:text-[34px] font-semibold tracking-tight text-text leading-tight">
              Everything you need to track India&apos;s wind sector,
              in one terminal.
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEATURES.map(f => (
              <div
                key={f.n}
                className="group relative rounded-xl border border-[#1f2c44] bg-[#0a0f1c]/60 px-5 py-5
                           hover:bg-[#0f1424] hover:border-orange/30 transition-colors"
              >
                <div className="flex items-baseline gap-3 mb-2.5">
                  <span className="text-[11px] font-mono font-medium tabular-nums tracking-wider
                                   text-orange/60 group-hover:text-orange transition-colors">
                    {f.n}
                  </span>
                  <h3 className="text-[15px] font-semibold text-text leading-tight">
                    {f.title}
                  </h3>
                </div>
                <p className="text-[12.5px] text-muted leading-relaxed pl-[34px]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sources strip ────────────────────────────────────────────── */}
      <section className="border-b border-[#1a2540]">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-12 lg:py-14">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted/65">
              Anchored to
            </span>
            {PILLARS.map(p => (
              <span
                key={p}
                className="text-[12px] text-text/85 font-medium
                           px-3 py-1.5 rounded-md
                           border border-[#1f2c44] bg-[#0a0f1c]/70"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Engine teaser ────────────────────────────────────────────── */}
      <section className="border-b border-[#1a2540]">
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
      <section className="border-b border-[#1a2540]">
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
              <h3 className="text-[22px] lg:text-[28px] font-semibold text-text tracking-tight leading-tight">
                Ready to dive in?
              </h3>
              <p className="mt-2 text-[13px] lg:text-[14px] text-muted/95 max-w-[58ch] leading-relaxed">
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
          <div className="flex items-center gap-2 text-muted/75">
            <span className="text-orange/85 font-medium">Wind Power India</span>
            <span className="text-muted/35">·</span>
            <span>Built by Consolidated Energy Consultants Ltd. (CECL)</span>
          </div>
          <div className="flex items-center gap-4 text-muted/75">
            <Link href="/dashboard" className="hover:text-text transition-colors">Dashboard</Link>
            <a
              href="https://cecl.in"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text transition-colors"
            >
              cecl.in ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Hero stat card ────────────────────────────────────────────────────────
// Premium fixed-width tile used inside the marquee. Each card carries a
// numeric headline, a contextual label, a small glyph, a source pill, and
// a delta chip for the "is this trending up?" signal.

const GLYPHS: Record<HeroStat['glyph'], (p: { className?: string }) => JSX.Element> = {
  turbine: ({ className = '' }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 13.5V21" />
      <path d="M9 21h6" />
      <circle cx="12" cy="12" r="1.4" />
      <path d="M12 10.6c-.6-2.7-2-5.5-4.6-7.2-.5-.3-1.2 0-1.2.6.2 3 1.7 5.6 4.4 7" />
      <path d="M13.3 12.7c2.6 1 5.7 1 8.2-.5.5-.3.5-1 0-1.4-2.4-1.7-5.3-2-7.9-1" />
      <path d="M11.2 13c-1.8 2.2-3 5-3 8.0 0 .55.6.95 1.1.6 2.5-1.6 4.1-4.0 4.4-6.8" />
    </svg>
  ),
  gauge: ({ className = '' }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 14a8 8 0 0 1 16 0" />
      <path d="M4 14h2M18 14h2M12 6v2" />
      <path d="M12 14L15.5 9.5" />
      <circle cx="12" cy="14" r="1.2" />
    </svg>
  ),
  map: ({ className = '' }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 6.5l6-2 6 2 6-2v13l-6 2-6-2-6 2v-13z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </svg>
  ),
  gavel: ({ className = '' }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M14 4l6 6" />
      <path d="M16.5 1.5l6 6" />
      <path d="M9.5 8.5l6 6" />
      <path d="M11 11l-7 7 2 2 7-7" />
      <path d="M3 21h8" />
    </svg>
  ),
};

function HeroStatCard({ stat }: { stat: HeroStat }) {
  const Glyph = GLYPHS[stat.glyph];
  const trendColor =
    stat.delta?.trend === 'up'   ? 'text-success'
  : stat.delta?.trend === 'down' ? 'text-[#ff7a7a]'
  :                                'text-muted/85';
  const trendArrow =
    stat.delta?.trend === 'up'   ? '↗'
  : stat.delta?.trend === 'down' ? '↘'
  :                                '→';

  return (
    <div className="group/card relative w-[280px] sm:w-[300px] shrink-0
                    rounded-2xl border border-[#1f2c44]
                    bg-gradient-to-b from-[#0f1424] to-[#0a0f1c]
                    px-5 py-4
                    shadow-[0_8px_28px_-12px_rgba(0,0,0,0.6)]
                    hover:border-orange/40 hover:-translate-y-0.5
                    transition-all duration-200">
      {/* Soft top-right accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full
                   bg-orange/10 blur-2xl opacity-0 group-hover/card:opacity-100 transition-opacity"
      />

      {/* Header row: glyph + label */}
      <div className="relative flex items-center gap-2.5">
        <div className="shrink-0 w-8 h-8 rounded-lg
                        bg-[#131826] border border-[#1f2c44]
                        text-orange/85 flex items-center justify-center">
          <Glyph className="w-4 h-4" />
        </div>
        <div className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted/80 leading-tight">
          {stat.label}
        </div>
      </div>

      {/* Headline value */}
      <div className="relative mt-3 text-[26px] sm:text-[28px] font-bold tabular-nums leading-none tracking-tight
                      text-text">
        {stat.value}
      </div>

      {/* Delta chip */}
      {stat.delta && (
        <div className={`relative mt-2.5 inline-flex items-center gap-1 text-[10.5px] font-medium ${trendColor}`}>
          <span className="tabular-nums">{trendArrow}</span>
          <span>{stat.delta.value}</span>
        </div>
      )}

      {/* Source row */}
      <div className="relative mt-3 pt-2.5 border-t border-[#1a2540]/80
                      flex items-center justify-between gap-2 text-[9.5px]">
        <span className="px-1.5 py-0.5 rounded
                         border border-[#1f2c44] bg-[#0a0f1c]
                         text-text/80 font-medium tracking-wide">
          {stat.source}
        </span>
        <span className="text-muted/55 tabular-nums">{stat.asOf}</span>
      </div>
    </div>
  );
}

function EngineCard({
  eyebrow, title, body, badge,
}: {
  eyebrow: string; title: string; body: string; badge?: string;
}) {
  return (
    <div className="relative rounded-xl border border-[#1f2c44] bg-[#0a0f1c]/60 p-5
                    hover:bg-[#0f1424] hover:border-orange/30 transition-colors">
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
      <h3 className="text-[16px] font-semibold text-text leading-tight">{title}</h3>
      <p className="mt-1.5 text-[12px] text-muted leading-relaxed">{body}</p>
    </div>
  );
}
