"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import type { BasemapId } from './Map/MapCanvas';

const MODE_LABELS: Record<BasemapId, string> = {
  satellite: '🛰 Satellite',
  terrain:   '⛰ Terrain',
  wind:      '💨 Wind',
  street:    '🗺 Street',
  pro:       '⚫ Pro',
};

interface Props {
  bundle?:        WpiBundle | null;
  basemap:        BasemapId;
  selectedState:  string | null;
  onStateClear:   () => void;
}

export default function ContextBar({ bundle, basemap, selectedState, onStateClear }: Props) {
  const ss    = bundle?.sourceStatus ?? {};
  const ok    = Object.values(ss).filter(s => s.ok).length;
  const total = Object.keys(ss).length || 15;
  const allOk = ok === total;
  const marginal = ok >= Math.ceil(total * 0.8);

  let ageLabel = 'No data';
  if (bundle?.generatedAt) {
    const mins = Math.floor((Date.now() - new Date(bundle.generatedAt).getTime()) / 60000);
    ageLabel = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  }

  return (
    <div className="flex-none px-4 py-1.5 bg-[#07090f]/90 backdrop-blur-sm border-b border-white/5 flex items-center gap-2 overflow-x-auto no-scrollbar">

      {/* Scope */}
      <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border border-[#1e2c44] bg-[#0d1628]/80 text-[10px] font-bold text-text shrink-0">
        <span>🌏</span><span>India</span>
      </div>

      {/* Selected state chip */}
      {selectedState && (
        <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border border-orange/30 bg-orange/10 text-[10px] font-bold text-orange shrink-0">
          <span>📍</span>
          <span>{selectedState}</span>
          <button onClick={onStateClear} className="opacity-60 hover:opacity-100 ml-0.5 leading-none font-bold">×</button>
        </div>
      )}

      <div className="w-px h-4 bg-white/10 shrink-0" />

      {/* Source health */}
      <div className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border text-[10px] font-bold shrink-0 ${
        allOk ? 'bg-[#0d1c10]/80 border-[#1d3020]/60 text-[#4cc87a]'
        : marginal ? 'bg-[#1a1408]/80 border-[#2e2010]/60 text-[#ffb066]'
        : 'bg-[#1c0d0d]/80 border-[#3a1515]/60 text-[#e85c5c]'
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full ${allOk ? 'bg-[#4cc87a]' : marginal ? 'bg-[#ffb066]' : 'bg-[#e85c5c]'}`} />
        <span suppressHydrationWarning>{ok}/{total} sources</span>
      </div>

      {/* Data age */}
      <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border border-[#1e2c44] bg-[#0d1628]/80 text-[10px] font-bold text-muted shrink-0">
        <span>⏱</span>
        <span suppressHydrationWarning>{ageLabel}</span>
      </div>

      <div className="w-px h-4 bg-white/10 shrink-0" />

      {/* Active basemap badge (read-only — switcher is on the map) */}
      <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border border-[#1e2c44] bg-[#0d1628]/80 text-[10px] font-bold text-muted shrink-0">
        <span>🗺</span>
        <span>{MODE_LABELS[basemap]}</span>
      </div>

      <div className="flex-1 min-w-0" />

      {bundle?.generatedAt && (
        <span suppressHydrationWarning className="text-[9px] text-white/20 shrink-0 hidden lg:block">
          {new Date(bundle.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
