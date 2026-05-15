import Link from "next/link";
import TopBar from "@/components/TopBar";
import { TypingAnimation } from "@/registry/magicui/typing-animation";
import { Marquee } from "@/registry/magicui/marquee";
import { ShinyButton } from "@/registry/magicui/shiny-button";

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
    value: '56,090 MW',
    label: 'India wind fleet',
    source: 'MNRE',
    asOf: '31 Mar 2026',
    delta: { value: '+6.05 GW FY26 (record)', trend: 'up' },
    glyph: 'turbine',
  },
  {
    value: '1,164 GW',
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

export default function Landing() {
  return (
    <div className="min-h-screen w-full bg-[#090d18] text-text flex flex-col">
      <TopBar showEngines={false} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="flex-1 relative overflow-hidden border-b border-[#1a2540]">
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

        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 pt-10 pb-10 lg:pt-14 lg:pb-14 flex flex-col items-center text-center">
          {/* Headline + typewriter rotator below — single-line via fluid clamp */}
          <h1 className="whitespace-nowrap text-[clamp(22px,5vw,46px)] font-bold leading-[1.05] tracking-tight text-text">
            Geospatial Wind,{' '}
            <span className="bg-gradient-to-r from-orange to-[#ffd0a0] bg-clip-text text-transparent">
              Intelligence
            </span>{' '}
            Terminal.
          </h1>

          <div className="mt-4 lg:mt-5 flex items-baseline justify-center gap-3 text-[18px] sm:text-[22px] lg:text-[26px] font-semibold tracking-tight text-muted/90">
            <span className="text-orange/85">›</span>
            <TypingAnimation
              words={["Map 🗺️", "Analyse 📊", "Tender 📑", "Finance 💼", "Research 🔬"]}
              loop
              cursorClassName="text-orange/80"
              className="text-text"
            />
          </div>

          <p className="mt-5 lg:mt-6 max-w-[60ch] text-[14px] lg:text-[15px] leading-relaxed text-muted/95">
            Open intelligence portal for India&apos;s wind sector built on four decades of
            capacity, tariffs, policy, grid, and resource data.
          </p>

          <p className="mt-2 text-[11.5px] lg:text-[12.5px] font-medium tracking-tight text-muted/70">
            Built by <span className="text-orange/90">Consolidated Energy Consultants Ltd.</span>
            <span className="text-muted/45"> · </span>
            <span className="tabular-nums">1986</span>
          </p>

          {/* Primary CTA — centred shiny pill */}
          <div className="mt-7 lg:mt-9 flex justify-center">
            <ShinyButton
              href="/dashboard"
              className="px-6 lg:px-8 py-3 lg:py-3.5 text-[14px] lg:text-[16px]"
            >
              Enter portal
              <span className="text-[15px] lg:text-[17px]">→</span>
            </ShinyButton>
          </div>

          {/* Hero stat ticker — premium cards in an auto-scrolling marquee,
              pauses on hover so the user can read individual tiles. */}
          <div className="mt-9 lg:mt-11 relative w-full">
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

