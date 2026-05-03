"use client";

import React from 'react';
import { WpiBundle } from '@/lib/types';

interface Props {
  bundle?:    WpiBundle;
  collapsed?: boolean;
  onToggle?:  () => void;
}

export default function MetricsStrip({ bundle, collapsed = false, onToggle }: Props) {
  const cap   = bundle?.capacity;
  const ok    = bundle ? Object.values(bundle.sourceStatus).filter(s => s.ok).length : 0;
  const total = bundle ? Object.keys(bundle.sourceStatus).length : 15;

  const all = [
    { label: 'Installed',     value: cap ? `${(cap.installed_mw / 1000).toFixed(1)} GW` : '48.2 GW', sub: 'All-India fleet',      color: 'text-orange' },
    { label: 'FY30 Target',   value: cap ? `${(cap.target_fy_mw / 1000).toFixed(0)} GW` : '100 GW',  sub: 'MNRE wind-only',       color: 'text-[#ffd0a0]' },
    { label: 'L1 Tariff',     value: bundle?.auctions?.[0] ? `₹${bundle.auctions[0].tariffL1Inr}` : '₹3.15', sub: `${bundle?.auctions?.[0]?.issuer ?? 'SECI'} latest`, color: 'text-[#4cc87a]' },
    { label: 'Potential',     value: '1,164 GW',       sub: 'NIWE @150m',          color: 'text-[#7bc4e2]' },
    { label: 'Nat. PLF',      value: '~24%',           sub: 'FY25 avg',            color: 'text-text' },
    { label: 'Auctions',      value: `${bundle?.auctions?.length ?? 0}`, sub: 'SECI / State', color: 'text-[#ffd0a0]' },
    { label: 'News',          value: `${bundle?.news?.length ?? 0}`,     sub: 'RSS live',     color: 'text-text' },
    { label: 'Sources',       value: `${ok}/${total}`, sub: ok < total ? `${total - ok} degraded` : 'All healthy', color: ok === total ? 'text-[#4cc87a]' : ok >= total * 0.8 ? 'text-[#ffb066]' : 'text-red-400' },
  ];

  const shown = collapsed ? all.slice(0, 4) : all;

  return (
    <div className={`bg-gradient-to-b from-[#0f1424] to-[#0a0f1c] border border-[#2a3a54] rounded-2xl overflow-hidden transition-all duration-200 shadow-lg`}>
      {/* Header row with toggle */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a2a44] bg-[#0d121f]">
        <span className="text-[11px] text-orange uppercase font-bold tracking-[1.5px] letter-spacing">Key Metrics</span>
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-[10px] text-muted hover:text-orange transition-colors font-bold uppercase tracking-wider"
        >
          {collapsed ? 'Expand' : 'Compact'}
          <span className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>▼</span>
        </button>
      </div>

      {/* Metric tiles */}
      <div className={`grid gap-0 divide-x divide-[#1a2a44] ${collapsed ? 'grid-cols-4' : 'grid-cols-4 xl:grid-cols-8'}`}>
        {shown.map((m, i) => (
          <div key={i} className="px-4 py-4 flex flex-col gap-1.5 hover:bg-[#0f1424]/50 transition-colors border-b border-[#1a2a44] last:border-b-0">
            <span className="text-[10px] text-muted/70 uppercase tracking-wider font-bold leading-tight truncate">{m.label}</span>
            <span suppressHydrationWarning className={`text-2xl font-black font-mono leading-tight ${m.color}`}>{m.value}</span>
            {!collapsed && <span className="text-[9px] text-muted/50 leading-tight truncate">{m.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
