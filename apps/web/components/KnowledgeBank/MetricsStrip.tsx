"use client";

import React from 'react';
import { WpiBundle } from '@/lib/types';

interface Props {
  bundle?:    WpiBundle;
  collapsed?: boolean;
  onToggle?:  () => void;
}

// ── Accent palette ──────────────────────────────────────────────────────────
type Accent = { text: string; glow: string; bar: string };

const ACCENT: Record<'orange' | 'amber' | 'green' | 'cyan' | 'neutral', Accent> = {
  orange:  { text: '#ff8a1f', glow: 'rgba(255,138,31,0.35)',  bar: '#ff8a1f' },
  amber:   { text: '#ffd0a0', glow: 'rgba(255,208,160,0.25)', bar: '#ffb066' },
  green:   { text: '#4cc87a', glow: 'rgba(76,200,122,0.28)',  bar: '#4cc87a' },
  cyan:    { text: '#7bc4e2', glow: 'rgba(123,196,226,0.25)', bar: '#7bc4e2' },
  neutral: { text: '#e8edf7', glow: 'rgba(232,237,247,0.18)', bar: '#3a4a6a' },
};

interface Metric {
  label:  string;
  value:  string;
  sub:    string;
  accent: Accent;
}

export default function MetricsStrip({ bundle }: Props) {
  const cap   = bundle?.capacity;
  const ok    = bundle ? Object.values(bundle.sourceStatus).filter(s => s.ok).length : 0;
  const total = bundle ? Object.keys(bundle.sourceStatus).length : 15;

  const potentialGw = bundle?.windPotential?.total_150m_gw ?? 1163.9;
  const potentialDisplay = `${Math.round(potentialGw).toLocaleString()} GW`;

  const metrics: Metric[] = [
    { label: 'Installed',   value: cap ? `${(cap.installed_mw / 1000).toFixed(1)} GW` : '48.2 GW',
      sub: 'All-India fleet',                                  accent: ACCENT.orange },
    { label: 'FY30 Target', value: cap ? `${(cap.target_fy_mw / 1000).toFixed(0)} GW` : '100 GW',
      sub: 'MNRE wind-only',                                   accent: ACCENT.amber },
    { label: 'Potential',   value: potentialDisplay,           sub: 'NIWE @150m',     accent: ACCENT.cyan },
  ];

  return (
    <div className="bg-gradient-to-b from-[#0f1424] to-[#0a0f1c] border border-[#2a3a54]/70 rounded-2xl overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.6)]">
      <Header ok={ok} total={total} />

      <div className="grid divide-x divide-[#1a2a44] grid-cols-3">
        {metrics.map((m, i) => (
          <MetricTile key={i} metric={m} />
        ))}
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────
function Header({ ok, total }: { ok: number; total: number }) {
  const dotColor =
    ok === total      ? '#4cc87a' :
    ok >= total * 0.8 ? '#ffb066' :
                        '#f87171';

  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[#1a2a44] bg-gradient-to-r from-[#0d121f] via-[#0d121f] to-[#0f1525]">
      <div className="flex items-center gap-2.5">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            backgroundColor: dotColor,
            boxShadow: `0 0 8px ${dotColor}, 0 0 0 2px ${dotColor}22`,
          }}
        />
        <span className="text-[11px] text-orange uppercase font-bold tracking-[1.5px]">
          Key Metrics
        </span>
        <span className="text-[10px] text-muted/40 font-mono hidden sm:inline">·</span>
        <span className="text-[10px] text-muted/60 font-mono tabular-nums hidden sm:inline">
          {ok}/{total} feeds
        </span>
      </div>
    </div>
  );
}

// ── Single tile ───────────────────────────────────────
function MetricTile({ metric: m }: { metric: Metric }) {
  return (
    <div
      className="group relative flex flex-col gap-1.5 px-3.5 py-3 hover:bg-white/[0.015] transition-colors min-w-0 overflow-hidden"
      title={`${m.label}: ${m.value} — ${m.sub}`}
    >
      {/* Top accent bar */}
      <span
        className="w-6 h-[3px] rounded-full"
        style={{
          backgroundColor: m.accent.bar,
          boxShadow: `0 0 8px ${m.accent.glow}`,
        }}
      />

      {/* Label */}
      <span className="text-[9px] text-muted/55 uppercase tracking-[0.08em] font-bold leading-none truncate">
        {m.label}
      </span>

      {/* Value */}
      <span
        suppressHydrationWarning
        className="font-black font-mono leading-none tracking-tight tabular-nums text-[15px] truncate"
        style={{ color: m.accent.text, textShadow: `0 0 10px ${m.accent.glow}` }}
      >
        {m.value}
      </span>

      {/* Sub label */}
      <span className="text-[8.5px] text-muted/45 leading-none truncate">
        {m.sub}
      </span>
    </div>
  );
}