"use client";

import React, { useState, ReactNode } from 'react';

// ── Hairline divider ────────────────────────────────────────────────────────
export function Hairline() {
  return <div className="h-px bg-gradient-to-r from-transparent via-[#2a3a54] to-transparent my-1" />;
}

// ── SectionHeader ───────────────────────────────────────────────────────────
// Shared eyebrow + title pair used at the top of every section. The "Live"
// badge on the right is optional; sections that don't pull live data can
// pass `live={false}` to hide it.
interface SectionHeaderProps {
  eyebrow: string;
  title:   string;
  live?:   boolean;
  delay?:  number;
}

export function SectionHeader({ eyebrow, title, live = true, delay = 0 }: SectionHeaderProps) {
  return (
    <div
      className="wpi-card-in flex items-baseline justify-between gap-3"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <div className="flex flex-col">
        <span className="text-[10px] text-muted/50 uppercase tracking-[0.18em] font-bold">
          {eyebrow}
        </span>
        <span className="text-[18px] text-text font-black tracking-tight mt-0.5">
          {title}
        </span>
      </div>
      {live && (
        <span className="wpi-pulse-soft flex items-center gap-1.5 text-[9.5px] text-muted/55 uppercase tracking-wider font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4cc87a]" />
          Live
        </span>
      )}
    </div>
  );
}

// ── EmptyState ─────────────────────────────────────────────────────────────
// Used by sections that depend on bundle data which may not be loaded yet.
// Visually quieter than a card so it doesn't draw the eye on a populated
// page where some sub-sections happen to be empty.
export function EmptyState({ message, delay = 0 }: { message: string; delay?: number }) {
  return (
    <div
      className="wpi-card-in border border-dashed border-[#2a3a54]/60 rounded-xl px-5 py-8 text-center"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <span className="text-[11.5px] text-muted/55 leading-relaxed">{message}</span>
    </div>
  );
}

// ── HeadlineMetric ──────────────────────────────────────────────────────────
// Big stat card used at the top of the Wind tab. The number is the hero,
// with a tiny accent bar on the left and a small caption underneath. The
// caption is allowed to wrap to two lines because it carries data
// provenance (e.g. "Sum of state-level MNRE figures (31 Mar 2025)").
interface HeadlineMetricProps {
  label:    string;
  value:    string;
  caption?: string;
  accent?:  string;
  delay?:   number;     // ms — stagger between sibling cards
  emphasis?: boolean;   // larger version, used for the top three numbers
}

export function HeadlineMetric({
  label, value, caption, accent = '#ff8a1f', delay = 0, emphasis = false,
}: HeadlineMetricProps) {
  return (
    <div
      className="wpi-card-in wpi-hover-lift relative bg-gradient-to-b from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-xl p-4 overflow-hidden"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      {/* left accent bar */}
      <span
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
        style={{
          backgroundColor: accent,
          boxShadow: `0 0 10px ${accent}55`,
        }}
      />
      <div className="pl-2 flex flex-col gap-1.5">
        <span className="text-[10px] text-muted/60 uppercase tracking-[0.1em] font-bold leading-none">
          {label}
        </span>
        <span
          className={`font-black font-mono leading-none tabular-nums tracking-tight ${
            emphasis ? 'text-[26px]' : 'text-[20px]'
          }`}
          style={{ color: accent, textShadow: `0 0 18px ${accent}40` }}
        >
          {value}
        </span>
        {caption && (
          <span className="text-[10px] text-muted/55 leading-snug font-medium mt-0.5">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}

// ── InfoCard ────────────────────────────────────────────────────────────────
// Collapsible prose card. Header shows a section title + chevron; body
// renders prose paragraphs and optional inline stat chips. Defaults to open
// for the first card (Geography) and closed for the rest, so the page
// doesn't look like a wall of text.
interface InfoCardProps {
  title:        string;
  defaultOpen?: boolean;
  delay?:       number;
  icon?:        ReactNode;
  accent?:      string;
  children:     ReactNode;
}

export function InfoCard({
  title, defaultOpen = false, delay = 0, icon, accent = '#ff8a1f', children,
}: InfoCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="wpi-card-in bg-gradient-to-b from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-xl overflow-hidden"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 bg-[#0a0f1c]/60 hover:bg-[#141e35]/70 transition-colors group"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {icon && (
            <span
              className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: `${accent}15`,
                border: `1px solid ${accent}30`,
                color: accent,
              }}
            >
              {icon}
            </span>
          )}
          <span className="text-[11px] uppercase font-bold tracking-[0.12em] truncate" style={{ color: accent }}>
            {title}
          </span>
        </span>
        <Chevron up={open} />
      </button>

      {/*
        Body uses a max-height transition for the expand/collapse feel.
        We can't tween to `auto`, so we use a generous max value (1200px)
        which is more than enough for any of these prose blocks. If a card
        ever exceeds it, the body will simply render without animation —
        no broken layout.
      */}
      <div
        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        style={{
          maxHeight: open ? 1200 : 0,
          opacity:   open ? 1 : 0,
        }}
      >
        <div className="px-5 py-4 border-t border-[#1a2a44] flex flex-col gap-3">
          {children}
        </div>
      </div>
    </div>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      width="11" height="11" viewBox="0 0 12 12" fill="none"
      stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"
      className={`text-muted/60 flex-shrink-0 transition-transform duration-300 ${up ? 'rotate-180' : ''}`}
    >
      <path d="M3 4.5 L6 7.5 L9 4.5" />
    </svg>
  );
}

// ── Prose paragraph ─────────────────────────────────────────────────────────
export function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12.5px] text-text/85 leading-relaxed font-normal">
      {children}
    </p>
  );
}

// ── ChipRow — inline label/value chip pairs ─────────────────────────────────
interface Chip { label: string; value: string; accent?: string }

export function ChipRow({ chips }: { chips: Chip[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {chips.map((c, i) => (
        <div
          key={i}
          className="flex items-center gap-2 bg-[#0a0f1c]/70 border border-[#1f2c44] rounded-md pl-2 pr-2.5 py-1.5 hover:border-orange/40 transition-colors"
        >
          <span className="text-[9.5px] text-muted/55 uppercase tracking-wider font-bold">
            {c.label}
          </span>
          <span
            className="text-[11px] font-mono font-bold tabular-nums"
            style={{ color: c.accent ?? '#ffd0a0' }}
          >
            {c.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── PotentialBar — animated horizontal bar ──────────────────────────────────
// Used to compare state-wise 150 m wind potential.  Bars fill in on mount
// (animated width via CSS var). Capped at the largest value in the list.
interface PotentialBarProps {
  state: string;
  gw:    number;
  max:   number;
  delay?: number;
}

export function PotentialBar({ state, gw, max, delay = 0 }: PotentialBarProps) {
  const pct = Math.min(100, (gw / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-text/85 font-medium w-[110px] flex-shrink-0">
        {state}
      </span>
      <div className="flex-1 h-2 bg-[#0a0f1c] rounded-full overflow-hidden border border-[#1f2c44]">
        <div
          className="wpi-bar-grow h-full rounded-full bg-gradient-to-r from-orange to-[#ffd0a0]"
          style={{
            ['--wpi-delay' as string]:      `${delay}ms`,
            ['--wpi-bar-target' as string]: `${pct}%`,
          }}
        />
      </div>
      <span className="text-[11px] font-mono font-bold text-[#ffd0a0] w-[60px] text-right tabular-nums">
        {gw} GW
      </span>
    </div>
  );
}

// ── ProTeaser — the locked Pro upsell at the bottom ─────────────────────────
interface ProTeaserProps {
  delay?: number;
}

export function ProTeaser({ delay = 0 }: ProTeaserProps) {
  // Distinct visual register — gold/amber accents, a faint shimmer bar
  // along the top edge — so users read it as a separate "premium" rail
  // instead of another data card. Locked icon + caption call out gating.
  return (
    <div
      className="wpi-card-in relative bg-gradient-to-b from-[#1a1410] to-[#0d0a08] border border-[#3d2f1f] rounded-xl overflow-hidden"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      {/* Top shimmer accent */}
      <div className="absolute top-0 left-0 right-0 h-[2px] wpi-shimmer" />

      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-orange/10 border border-orange/30 flex items-center justify-center text-orange">
            <LockIcon />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-[0.1em] font-black text-orange">
              CECL Pro
            </span>
            <span className="text-[10px] text-muted/60">
              40-year proprietary wind dataset
            </span>
          </div>
        </div>

        <p className="text-[12px] text-text/80 leading-relaxed">
          Site-level wind, generation &amp; finance microdata that powers
          what you&apos;re reading on the right — long-period reanalysis,
          fleet SCADA, project commissioning &amp; auction microdata.
        </p>

        <div className="flex flex-col gap-1.5 mt-1">
          {[
            ['1985–2025 reanalysis',  '250 m hourly wind grids · 40-yr climatology'],
            ['OEM SCADA archives',     '16,000+ turbines · 10-min resolution'],
            ['Auction & PPA microdata','Bidder-level history · ~9,400 wind PPA terms'],
            ['P50 / P75 / P90',        'Yield uncertainty per atlas block'],
          ].map(([title, sub]) => (
            <div key={title} className="flex items-start gap-2 py-1">
              <span className="w-1 h-1 rounded-full bg-orange mt-2 flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-[11px] text-text/90 font-bold">{title}</span>
                <span className="text-[10px] text-muted/60 leading-snug">{sub}</span>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => alert('Pro access — coming soon')}
          className="mt-2 w-full py-2.5 rounded-lg bg-orange/10 border border-orange/40 text-orange text-[11px] font-bold uppercase tracking-wider hover:bg-orange/20 hover:border-orange/60 transition-colors"
        >
          Request Pro access →
        </button>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// ── SourceLinks — tiny attribution row ──────────────────────────────────────
interface Source { label: string; url: string }

export function SourceLinks({ sources, delay = 0 }: { sources: Source[]; delay?: number }) {
  return (
    <div
      className="wpi-card-in flex flex-wrap items-center gap-2 px-1 py-1"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <span className="text-[9.5px] text-muted/50 uppercase tracking-wider font-bold">
        Sources:
      </span>
      {sources.map((s, i) => (
        <React.Fragment key={s.url}>
          <a
            href={s.url} target="_blank" rel="noopener noreferrer"
            className="text-[10.5px] text-muted/75 hover:text-orange transition-colors underline-offset-2 hover:underline"
          >
            {s.label}
          </a>
          {i < sources.length - 1 && <span className="text-muted/30 text-[10px]">·</span>}
        </React.Fragment>
      ))}
    </div>
  );
}
