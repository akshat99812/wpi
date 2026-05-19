import Image from "next/image";
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
    value: '56.44 GW',
    label: 'Installed (All-India)',
    source: 'MNRE physical progress',
    asOf: '30 Apr 2026',
    delta: { value: '+6.05 GW in FY26 · record', trend: 'up' },
    glyph: 'turbine',
  },
  {
    value: '1,163.9 GW',
    label: 'Onshore 150 m potential',
    source: 'NIWE 150 m Wind Potential Atlas',
    asOf: '2023',
    delta: { value: '~21× installed', trend: 'up' },
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
    <div className="min-h-screen w-full overflow-x-hidden bg-[#090d18] text-text flex flex-col">
      <TopBar showEngines={false} showAbout={false} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-[#1a2540] flex flex-col justify-center min-h-[calc(100svh-68px)]">
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

        <div className="relative max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-12 pb-10 lg:pt-20 lg:pb-16 flex flex-col items-center text-center">
          {/* Headline + typewriter rotator below — single-line on >=sm via fluid
              clamp; wraps on narrow mobile so it never overflows. */}
          <h1 className="sm:whitespace-nowrap text-[clamp(22px,6.5vw,46px)] font-bold leading-[1.15] sm:leading-[1.05] tracking-tight text-text">
            Geospatial Wind,{' '}
            <span className="bg-gradient-to-r from-orange to-[#ffd0a0] bg-clip-text text-transparent">
              Intelligence
            </span>{' '}
            Terminal.
          </h1>

          <div className="mt-5 sm:mt-6 lg:mt-8 flex items-baseline justify-center gap-2 sm:gap-3 text-[16px] sm:text-[22px] lg:text-[26px] font-semibold tracking-tight text-muted/90">
            <span className="text-orange/85">›</span>
            <TypingAnimation
              words={["Map", "Analyse", "Tender", "Finance", "Research"]}
              loop
              cursorClassName="text-orange/80"
              className="text-text"
            />
          </div>

          <p className="mt-6 sm:mt-7 lg:mt-9 max-w-[60ch] text-[13px] sm:text-[14px] lg:text-[15px] leading-relaxed text-muted/95">
            Open intelligence portal for India&apos;s wind sector built on four decades of
            capacity, tariffs, policy, grid, and resource data.
          </p>

          <p className="mt-3 text-[11px] sm:text-[11.5px] lg:text-[12.5px] font-medium tracking-tight text-muted/70">
            Built by <span className="text-orange/90">Consolidated Energy Consultants Ltd.</span>
            <span className="text-muted/45"> · </span>
            <span className="tabular-nums">1986</span>
          </p>

          {/* Product cards — replaces the prior "Enter portal" CTA.
              Each card is a direct link into one of the three portal
              sections, with a short description of what's inside. */}
          <div className="mt-12 sm:mt-14 lg:mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 lg:gap-6 w-full max-w-6xl">
            {PRODUCTS.map(p => <ProductCard key={p.id} product={p} />)}
          </div>

          {/* Hero stat ticker — premium cards in an auto-scrolling marquee,
              pauses on hover so the user can read individual tiles. */}
          <div className="mt-14 sm:mt-16 lg:mt-20 mb-10 sm:mb-12 lg:mb-16 relative w-full">
            <Marquee
              pauseOnHover
              repeat={4}
              className="[--duration:12s] [--gap:14px] py-2"
            >
              {HERO_STATS.map(s => <HeroStatCard key={s.label} stat={s} />)}
            </Marquee>
            {/* Edge fades so cards bleed in/out softly instead of clipping */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 sm:w-16 bg-gradient-to-r from-[#090d18] to-transparent" />
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 sm:w-16 bg-gradient-to-l from-[#090d18] to-transparent" />
          </div>

          {/* Scroll cue — quiet hint that there's more below. */}
          <a
            href="#about"
            aria-label="Scroll to About"
            className="group relative mt-4 sm:mt-6 inline-flex flex-col items-center gap-1.5
                       text-[10.5px] uppercase tracking-[0.16em] text-muted/55 hover:text-orange/85
                       transition-colors"
          >
            <span>About the portal</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                 strokeLinecap="round" strokeLinejoin="round"
                 className="w-3.5 h-3.5 animate-bounce">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </a>
        </div>
      </section>

      {/* ── About section ────────────────────────────────────────────── */}
      <AboutSection />

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-[#1a2540] bg-[#080b10]">
        <div className="mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-5">

          {/* Brand */}
          <div className="pb-3">
            <div className="flex items-center ">
              <Image
                src="/logo.png"
                alt="Wind Power India"
                width={36}
                height={36}
                className="object-contain"
              />
              <span className="text-[15px] font-bold tracking-tight text-text">
                Wind Power India
              </span>
            </div>
          </div>

          {/* Bottom strip — © on the left, legal links on the right.
              Stacks vertically on small viewports where the © line is too
              long to share a row with the legal cluster. */}
          <div className="pt-6 border-t border-[#1a2540] flex flex-col md:flex-row md:items-center md:justify-between gap-y-3 text-[10.5px] text-muted/65">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left">
              <span>© 2026 Wind Power India</span>
              <span className="text-muted/30">·</span>
              <span>
                Built by{' '}
                <a
                  href="https://cecl.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange/85 hover:text-orange transition-colors"
                >
                  Consolidated Energy Consultants Ltd.
                </a>
              </span>
              <span className="text-muted/30">·</span>
              <span className="tabular-nums">est. 1986</span>
            </div>

            <div className="flex items-center gap-4 md:justify-end">
              <a href="#" className="hover:text-text transition-colors">Privacy</a>
              <a href="#" className="hover:text-text transition-colors">Terms</a>
              <a href="#" className="hover:text-text transition-colors">Attribution</a>
            </div>
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
    <div className="group/card relative w-[248px] sm:w-[300px] shrink-0
                    rounded-2xl border border-[#1f2c44]
                    bg-gradient-to-b from-[#0f1424] to-[#0a0f1c]
                    px-4 sm:px-5 py-3.5 sm:py-4
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

// ── Product cards ────────────────────────────────────────────────────────
// Three feature tiles inside the hero: stylised illustration at the top,
// category eyebrow, big title, body copy, divider, and CTA-with-arrow row.
// Layout follows the Keploy reference (illustration over copy with a
// circular CTA arrow). Whole card is a Link.

type Product = {
  id:        'geospatial' | 'finance' | 'research';
  href:      string;
  eyebrow:   string;
  title:     string;
  body:      string;
  cta:       string;
  Illustration: () => JSX.Element;
};

/* ─── Illustrations ─────────────────────────────────────────────────────── */

// Reusable "window chrome" — traffic-light dots, a faux URL pill, and a
// thin bottom divider. Lets the three illustrations read as a matched
// set of product previews rather than three different drawings.
function WindowChrome({ label }: { label: string }) {
  return (
    <g>
      <rect x="0" y="0" width="320" height="26" fill="#0c1120" />
      <line x1="0" y1="26" x2="320" y2="26" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <circle cx="14" cy="13" r="3" fill="#ff5f56" opacity="0.85" />
      <circle cx="28" cy="13" r="3" fill="#ffbd2e" opacity="0.85" />
      <circle cx="42" cy="13" r="3" fill="#27c93f" opacity="0.85" />
      <rect x="100" y="5" width="160" height="16" rx="3"
            fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <text x="180" y="16" textAnchor="middle" fontSize="9.5" fontFamily="ui-sans-serif"
            fill="rgba(255,255,255,0.70)" fontWeight="600" letterSpacing="0.4">
        {label}
      </text>
    </g>
  );
}

// Geospatial — clean dashboard preview: window chrome + smooth India
// silhouette with a soft orange thermal gradient + ringed state pins +
// floating tooltip + capacity legend strip.
function GeospatialIllustration() {
  // Five pins on principal wind states, drawn as concentric rings so
  // they read as "interactive markers" rather than blobs.
  const pins = [
    { cx: 126, cy:  78, label: 'RJ' },
    { cx: 106, cy: 116, label: 'GJ', big: true },
    { cx: 150, cy: 142, label: 'MH' },
    { cx: 174, cy: 168, label: 'KA' },
    { cx: 198, cy: 142, label: 'AP' },
  ];

  return (
    <svg viewBox="0 0 320 200" className="w-full h-full" aria-hidden>
      <defs>
        <linearGradient id="geoBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#0d1424" />
          <stop offset="100%" stopColor="#080c16" />
        </linearGradient>
        <pattern id="geoGrid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0V16" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
        </pattern>
        {/* Vertical thermal gradient — cooler in the north, hotter through
            the peninsular wind belt. Mirrors India's real wind geography. */}
        <linearGradient id="geoFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#3a4a6a" stopOpacity="0.45" />
          <stop offset="55%"  stopColor="#ff8a1f" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ff7a1f" stopOpacity="0.85" />
        </linearGradient>
        <filter id="geoBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.5" />
        </filter>
      </defs>

      {/* Map area background — sits below the window chrome (drawn last). */}
      <rect y="26" width="320" height="174" fill="url(#geoBg)" />
      <rect y="26" width="320" height="174" fill="url(#geoGrid)" />

      {/* Stylised India silhouette — smoother teardrop with bezier curves. */}
      <path
        d="M120 50
           Q 138 36 168 40
           Q 200 44 224 64
           Q 240 80 232 102
           Q 224 122 214 138
           Q 204 158 190 174
           Q 176 188 162 178
           Q 150 168 142 154
           Q 132 138 120 122
           Q 102 108 92 90
           Q 88 70 102 56
           Q 110 50 120 50 Z"
        fill="url(#geoFill)"
        stroke="rgba(255,138,31,0.65)"
        strokeWidth="1.2"
        filter="url(#geoBlur)"
      />

      {/* Faint state-boundary hairlines suggest sub-divisions. */}
      <g stroke="rgba(255,255,255,0.10)" strokeWidth="0.7" fill="none">
        <path d="M120 90 Q 150 95 180 95" />
        <path d="M130 120 Q 160 122 200 120" />
        <path d="M150 60 Q 170 70 190 80" />
      </g>

      {/* Ringed pins — outer halo + inner dot. */}
      {pins.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r={p.big ? 10 : 7}
                  fill="rgba(255,138,31,0.18)" stroke="rgba(255,138,31,0.55)" strokeWidth="1" />
          <circle cx={p.cx} cy={p.cy} r={p.big ? 4 : 3} fill="#ff8a1f"
                  stroke="#0a0f1c" strokeWidth="1" />
        </g>
      ))}

      {/* Tooltip card anchored to the Gujarat pin. */}
      <g transform="translate(186, 64)">
        <line x1="-78" y1="52" x2="-2" y2="20" stroke="rgba(255,138,31,0.45)" strokeWidth="1" strokeDasharray="2 2" />
        <rect width="120" height="46" rx="6"
              fill="#0d1424" stroke="rgba(255,138,31,0.55)" strokeWidth="1" />
        <text x="10" y="16" fontSize="8.5" fontFamily="ui-sans-serif" fill="#ffd0a0"
              fontWeight="800" letterSpacing="0.6">GUJARAT · WIND</text>
        <text x="10" y="32" fontSize="13" fontFamily="ui-sans-serif" fill="#ffffff" fontWeight="800">15.8 GW</text>
        <text x="10" y="42" fontSize="8" fontFamily="ui-sans-serif" fill="rgba(255,255,255,0.55)">
          +0.3 GW FY26 · MNRE
        </text>
      </g>

      {/* Capacity legend strip — gradient swatch with min/max labels. */}
      <g transform="translate(20, 180)">
        <text x="0" y="0" fontSize="8" fontFamily="ui-sans-serif"
              fill="rgba(255,255,255,0.55)" fontWeight="700" letterSpacing="0.6">
          0 GW
        </text>
        <rect x="32" y="-7" width="120" height="6" rx="3" fill="url(#geoFill)" />
        <text x="158" y="0" fontSize="8" fontFamily="ui-sans-serif"
              fill="rgba(255,255,255,0.55)" fontWeight="700" letterSpacing="0.6">
          15+ GW
        </text>
      </g>

      {/* Window chrome on top — drawn last so it sits above the map. */}
      <WindowChrome label="India · Wind Capacity" />
    </svg>
  );
}

// Finance — windowed dashboard preview with a bar chart, dashed trend
// line, and a KPI tile pinned over the top-right corner.
function FinanceIllustration() {
  const bars = [38, 52, 46, 70, 64, 88, 96];
  return (
    <svg viewBox="0 0 320 200" className="w-full h-full" aria-hidden>
      <defs>
        <linearGradient id="finBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#0d1424" />
          <stop offset="100%" stopColor="#080c16" />
        </linearGradient>
        <linearGradient id="finBar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff9a3c" />
          <stop offset="100%" stopColor="#ff7a1f" />
        </linearGradient>
      </defs>

      <rect y="26" width="320" height="174" fill="url(#finBg)" />

      {/* Grid */}
      {[60, 100, 140, 170].map(y => (
        <line key={y} x1="28" x2="296" y1={y} y2={y}
              stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 3" />
      ))}

      {/* Bars */}
      {bars.map((h, i) => {
        const x = 36 + i * 34;
        const y = 170 - h;
        return (
          <rect key={i} x={x} y={y} width={18} height={h} rx="3"
                fill="url(#finBar)" opacity={0.65 + i * 0.05} />
        );
      })}

      {/* Trend line */}
      <polyline
        fill="none"
        stroke="#ffd0a0"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="3 3"
        points={bars.map((h, i) => `${36 + i * 34 + 9},${170 - h - 10}`).join(' ')}
      />

      {/* KPI tile — pinned top-right inside the map area */}
      <g transform="translate(190, 40)">
        <rect width="116" height="44" rx="6" fill="rgba(13,20,36,0.95)"
              stroke="rgba(255,138,31,0.45)" strokeWidth="1" />
        <text x="10" y="16" fontSize="8.5" fontFamily="ui-sans-serif" fill="#ffd0a0"
              fontWeight="800" letterSpacing="0.6">DCF · EQUITY IRR</text>
        <text x="10" y="32" fontSize="13" fontFamily="ui-sans-serif" fill="#ffffff" fontWeight="800">17.4%</text>
        <text x="72" y="32" fontSize="9"  fontFamily="ui-sans-serif" fill="#4cc87a" fontWeight="700">bankable</text>
        <line x1="0" y1="38" x2="116" y2="38" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        <text x="10" y="40" fontSize="0" />
      </g>

      {/* Axis label */}
      <text x="36" y="190" fontSize="8" fontFamily="ui-sans-serif"
            fill="rgba(255,255,255,0.55)" fontWeight="700" letterSpacing="0.6">
        FY20 → FY26 · Equity IRR (%)
      </text>

      <WindowChrome label="100 MW · DCF Bench" />
    </svg>
  );
}

// Research — windowed dashboard preview: stacked research-section rows
// with index numbers, tag chips, and an AI-search bar pinned at top.
function ResearchIllustration() {
  const rows = [
    { n: '01', label: 'Resource & Wind Regime' },
    { n: '02', label: 'Climatology · CUF · PLF' },
    { n: '03', label: 'OEM Models · ALMM' },
    { n: '04', label: 'Tariff & Auctions' },
  ];
  return (
    <svg viewBox="0 0 320 200" className="w-full h-full" aria-hidden>
      <defs>
        <linearGradient id="resBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#0d1424" />
          <stop offset="100%" stopColor="#080c16" />
        </linearGradient>
      </defs>
      <rect y="26" width="320" height="174" fill="url(#resBg)" />

      {/* AI search bar at top of the body */}
      <g transform="translate(20, 38)">
        <rect width="232" height="22" rx="5"
              fill="rgba(255,255,255,0.04)" stroke="rgba(255,138,31,0.35)" strokeWidth="1" />
        <g transform="translate(8, 11)" stroke="#ffd0a0" strokeWidth="1.4" fill="none"
           strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="5" r="3.5" />
          <line x1="7.5" y1="7.5" x2="11" y2="11" />
        </g>
        <text x="28" y="15" fontSize="9" fontFamily="ui-sans-serif"
              fill="rgba(255,255,255,0.55)">Ask the corpus — &ldquo;FY26 wind PLF by state&rdquo;</text>
        <rect x="260" width="48" height="22" rx="5"
              fill="rgba(255,138,31,0.18)" stroke="rgba(255,138,31,0.55)" strokeWidth="1" />
        <text x="284" y="15" textAnchor="middle" fontSize="9" fontWeight="800"
              fill="#ffd0a0" fontFamily="ui-sans-serif" letterSpacing="0.6">AI · 11</text>
      </g>

      {/* Stacked section rows */}
      {rows.map((r, i) => {
        const y = 76 + i * 30;
        return (
          <g key={r.n}>
            <rect x="20" y={y} width="280" height="24" rx="6"
                  fill="rgba(255,255,255,0.04)"
                  stroke={i === 0 ? 'rgba(255,138,31,0.55)' : 'rgba(255,255,255,0.08)'}
                  strokeWidth="1" />
            <text x="32" y={y + 16} fontSize="9" fontFamily="ui-sans-serif"
                  fill="#ffd0a0" fontWeight="800" letterSpacing="0.6">
              {r.n}
            </text>
            <text x="56" y={y + 16} fontSize="10" fontFamily="ui-sans-serif"
                  fill="rgba(255,255,255,0.88)" fontWeight="600">
              {r.label}
            </text>
            {/* Tag chip */}
            <rect x="244" y={y + 6} width="44" height="12" rx="3"
                  fill="rgba(255,138,31,0.14)" stroke="rgba(255,138,31,0.25)" strokeWidth="0.6" />
            <text x="266" y={y + 15} textAnchor="middle" fontSize="7.5" fontWeight="800"
                  fill="#ffd0a0" letterSpacing="0.4" fontFamily="ui-sans-serif">
              {i === 0 ? 'NEW' : 'OPEN'}
            </text>
          </g>
        );
      })}

      <WindowChrome label="Research · 11 sections" />
    </svg>
  );
}

const PRODUCTS: Product[] = [
  {
    id: 'geospatial', href: '/geospatial',
    eyebrow: 'Intelligence Terminal',
    title:   'Geospatial',
    body:    'Interactive India map. Drill into any state for installed fleet, prime districts, tariffs, grid evacuation, and live wind news — all anchored to MNRE, NIWE, and state SERCs.',
    cta:     'Open the map',
    Illustration: GeospatialIllustration,
  },
  {
    id: 'finance', href: '/finance',
    eyebrow: 'DCF & Bankability',
    title:   'Finance',
    body:    'Project-level DCF model, bankability scoring, lender criteria, and PPA tariff economics. Built for IPPs, lenders, and the projects desk.',
    cta:     'Run a DCF',
    Illustration: FinanceIllustration,
  },
  {
    id: 'research', href: '/research',
    eyebrow: 'Resource Intelligence',
    title:   'Research',
    body:    '11 research sections — wind regime, resource, technology, regulation, supply chain — plus AI topic search across MNRE / NIWE / CEA reports.',
    cta:     'Explore research',
    Illustration: ResearchIllustration,
  },
];

function ProductCard({ product }: { product: Product }) {
  const Illo = product.Illustration;
  return (
    <Link
      href={product.href}
      aria-label={`Open ${product.title}`}
      className="group relative flex flex-col
                 rounded-3xl border border-[#1f2c44]
                 bg-gradient-to-b from-[#0f1424] to-[#0a0f1c]
                 p-4 sm:p-5 lg:p-6
                 text-left
                 shadow-[0_14px_40px_-14px_rgba(0,0,0,0.7)]
                 transition-all duration-200
                 hover:border-orange/55 hover:-translate-y-1
                 hover:shadow-[0_24px_56px_-16px_rgba(255,138,31,0.40)]
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange/40"
    >
      {/* Soft top-right accent glow on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full
                   bg-orange/15 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"
      />

      {/* Illustration tile */}
      <div className="relative rounded-2xl overflow-hidden border border-[#1f2c44]
                      bg-[#0a0f1c] aspect-[16/10]
                      group-hover:border-orange/30 transition-colors">
        <Illo />
      </div>

      {/* Copy — flex-1 so the CTA row below is pinned to the card
          bottom across all three cards regardless of body length. */}
      <div className="relative flex flex-col gap-3 pt-6 sm:pt-7 px-1 flex-1">
        <span className="text-[10.5px] sm:text-[11px] font-bold uppercase tracking-[0.16em] text-orange/85">
          {product.eyebrow}
        </span>

        <h3 className="text-[24px] sm:text-[28px] lg:text-[30px] font-bold tracking-tight text-white leading-[1.1]">
          {product.title}
        </h3>

        <p className="text-[13.5px] sm:text-[14px] lg:text-[14.5px] leading-relaxed text-white/60">
          {product.body}
        </p>
      </div>

      {/* Divider + CTA row — flex-none keeps it locked at the bottom. */}
      <div className="relative mt-6 sm:mt-7 px-1 flex-none">
        <div className="border-t border-white/[0.08] pt-4 sm:pt-5
                        flex items-center justify-between gap-3">
          <span className="text-[13.5px] sm:text-[14px] font-bold tracking-tight
                           text-white/90 group-hover:text-orange transition-colors">
            {product.cta}
          </span>
          <span
            aria-hidden
            className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full
                       flex items-center justify-center
                       bg-[#13192a] border border-[#1f2c44] text-white/75
                       transition-all duration-200
                       group-hover:bg-orange group-hover:border-orange group-hover:text-[#0a0e18]
                       group-hover:shadow-[0_0_18px_rgba(255,138,31,0.55)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                 className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── About section ────────────────────────────────────────────────────────
// In-page About copy (replaces the modal on the landing route).
// Designed for a slow scroll-read: section header → portal pitch +
// feature grid → "Built by CECL" stats card → tiny open-access note.

const ABOUT_FEATURES: { n: string; title: string; body: string }[] = [
  { n: '01', title: 'Interactive India map',     body: 'Click any state to dive into installed fleet, prime districts, tariffs, grid evacuation, and live news.' },
  { n: '02', title: 'State-level deep dives',    body: 'District-wise capacity, utility procurement context, SERC tariff orders, and Transco evacuation paths.' },
  { n: '03', title: 'Live state-specific news',  body: 'Google News-aggregated wind headlines per state, refreshed every 30 minutes.' },
  { n: '04', title: 'Source-anchored data',      body: 'Tariffs from SECI / GUVNL / MSEDCL, policy from MNRE / MoP / CERC, grid from POSOCO / PGCIL, atlas from NIWE / GWA.' },
];

const CECL_STATS: { value: string; label: string; accent?: boolean }[] = [
  { value: '350+',      label: 'Clients served' },
  { value: '600+',      label: 'Projects delivered' },
  { value: '340+',      label: 'Locations worked' },
  { value: '40+ yrs',   label: 'Wind domain experience' },
  { value: '20,000 MW', label: 'Wind sites identified', accent: true },
  { value: '7',         label: 'Countries · IN BD NP LK MU MV + Africa' },
];

function AboutSection() {
  return (
    <section
      id="about"
      className="relative overflow-hidden border-b border-[#1a2540]
                 bg-gradient-to-b from-[#090d18] via-[#0a0e1a] to-[#080b14]"
    >
      {/* Subtle radial accent so the section reads as a fresh surface, not a
          continuation of the hero. Mirrors the hero's palette so it feels of-a-piece. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0
                   bg-[radial-gradient(80%_60%_at_20%_0%,rgba(255,138,31,0.06),transparent_55%)]"
      />

      <div className="relative mx-auto max-w-5xl w-full px-4 sm:px-6 lg:px-8 py-20 sm:py-24 lg:py-28 flex flex-col gap-16 sm:gap-20">

        {/* Header */}
        <header className="flex flex-col gap-3 max-w-[60ch]">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[1.1px] uppercase">
            <span className="inline-flex items-center gap-1.5 text-orange">
              <span className="w-1.5 h-1.5 rounded-full bg-orange" />
              About
            </span>
            <span className="text-white/20">/</span>
            <span className="text-white/55">the portal</span>
          </div>

          <h2 className="text-[clamp(22px,4vw,32px)] font-semibold text-white tracking-tight leading-[1.15]">
            Geospatial wind <span className="text-orange">intelligence</span> terminal
          </h2>

          <p className="text-[13.5px] sm:text-[14px] text-white/60 leading-relaxed">
            A real-time intelligence terminal for everyone tracking India&apos;s wind
            sector — developers, IPPs, OEMs, lenders, regulators, researchers, and
            policy analysts. Every figure is anchored to an authoritative public
            source (<span className="text-white/85">MNRE · NIWE · CEA · SERCs · state nodal agencies</span>).
            No simulated values.
          </p>
        </header>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ABOUT_FEATURES.map(f => (
            <div
              key={f.n}
              className="group flex gap-3 rounded-xl border border-white/[0.07]
                         bg-gradient-to-br from-white/[0.025] to-transparent
                         px-4 py-3.5 hover:border-orange/30 transition-colors"
            >
              <span className="shrink-0 mt-0.5 text-[10.5px] font-mono font-bold tracking-wider
                               text-orange/80">
                {f.n}
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-white/90 leading-tight">
                  {f.title}
                </div>
                <p className="text-[12px] text-white/55 leading-relaxed">{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Built by CECL */}
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-[1.1px] uppercase">
              <span className="inline-flex items-center gap-1.5 text-orange">
                <span className="w-1.5 h-1.5 rounded-full bg-orange" />
                Built by CECL
              </span>
            </div>
            <span className="text-[10px] font-mono font-medium tracking-wider text-orange/75 tabular-nums">
              EST. 1986
            </span>
          </div>

          <p className="text-[13.5px] sm:text-[14px] text-white/65 leading-relaxed max-w-[68ch]">
            <span className="text-white/90 font-medium">Consolidated Energy Consultants Ltd.</span>{' '}
            has been a trailblazer in India&apos;s renewable energy sector since
            1986 — authoring the country&apos;s wind story from early demonstration
            projects through today&apos;s <span className="text-orange/90 font-medium">56 GW+</span>{' '}
            operating fleet. Four decades of fieldwork across resource assessment,
            micro-siting, bankability, construction supervision, and owner&apos;s
            &amp; lender&apos;s engineering.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/[0.06] border border-white/[0.08] rounded-xl overflow-hidden">
            {CECL_STATS.map(s => (
              <div
                key={s.label}
                className={`flex flex-col gap-1 px-4 py-3.5 bg-[#0a0e18]
                            ${s.accent ? 'bg-gradient-to-br from-[#1a1208] to-[#0a0e18]' : ''}`}
              >
                <div
                  className={`text-[18px] sm:text-[20px] font-black tracking-tight tabular-nums
                              ${s.accent ? 'text-orange' : 'text-white/95'}`}
                  style={s.accent ? { textShadow: '0 0 12px rgba(255,138,31,0.35)' } : undefined}
                >
                  {s.value}
                </div>
                <div className="text-[10.5px] text-white/50 leading-tight">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}

