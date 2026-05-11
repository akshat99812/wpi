"use client";

import React, { useState, useEffect } from 'react';
import type { WpiBundle } from '@/lib/types';
import './tabpanel.animations.css';
import { STATE_PROFILES } from './stateProfiles';

import WindSection     from './sections/WindSection';
import CapacitySection from './sections/CapacitySection';
import PolicySection   from './sections/PolicySection';
import TariffsSection  from './sections/TariffsSection';
import GridSection     from './sections/GridSection';
import LandSection     from './sections/LandSection';
import NewsSection     from './sections/NewsSection';

const TABS = [
  { id: 'wind',     label: 'Wind',     Component: WindSection },
  { id: 'capacity', label: 'Capacity', Component: CapacitySection },
  { id: 'policy',   label: 'Policy',   Component: PolicySection },
  { id: 'tariffs',  label: 'Tariffs',  Component: TariffsSection },
  { id: 'grid',     label: 'Grid',     Component: GridSection },
  { id: 'land',     label: 'Land',     Component: LandSection },
  { id: 'news',     label: 'News',     Component: NewsSection },
] as const;

type TabId = typeof TABS[number]['id'];

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
  onClearState?:  () => void;
}

export default function TabPanel({ bundle, selectedState, onClearState }: Props) {
  const [active, setActive] = useState<TabId>('wind');

  useEffect(() => {
    if (selectedState) setActive('wind');
  }, [selectedState]);

  const ActiveComponent = TABS.find(t => t.id === active)?.Component ?? WindSection;
  const profile = selectedState ? STATE_PROFILES[selectedState] ?? null : null;

  // ── State detail layout ─────────────────────────────────────────────────
  if (selectedState) {
    const realisationPct = profile
      ? ((profile.installed_mw / 1000) / profile.potential_gw * 100).toFixed(2)
      : null;

    return (
      <div className="flex flex-col h-full bg-[#0a0f1c]/50">
        {/* Sticky state-detail header */}
        <div className="flex-none bg-[#0a0f1c] z-10 sticky top-0 shadow-lg">

          {/* Back / label row */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted/45">
              State Detail
            </span>
            <button
              onClick={onClearState}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-muted/65 hover:text-orange transition-colors"
            >
              <span className="text-[15px] leading-none">←</span>
              Back to India overview
            </button>
          </div>

          {/* State name */}
          <div className="px-4 pb-2.5">
            <h2 className="text-[18px] font-black text-text leading-tight">{selectedState}</h2>
          </div>

          {/* Compact metric cards */}
          {profile && (
            <div className="grid grid-cols-3 gap-2 px-4 pb-3">
              <StatMetricCard
                label="Installed Capacity"
                value={`${profile.installed_mw.toLocaleString()} MW`}
                caption={profile.installed_caption}
                accent="#ff8a1f"
              />
              <StatMetricCard
                label="NIWE 150 m Potential"
                value={`${profile.potential_gw} GW`}
                caption="NIWE 150 m Wind Potential Atlas"
                accent="#7bc4e2"
              />
              <StatMetricCard
                label="Realisation"
                value={`${realisationPct}%`}
                caption="Installed ÷ 150 m potential"
                accent="#4cc87a"
              />
            </div>
          )}

          {/* Tab bar */}
          <div className="flex gap-0.5 border-t border-[#2a3a54] px-4 pt-2 pb-0 overflow-x-auto no-scrollbar">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`relative px-3.5 py-2.5 text-[11.5px] font-bold whitespace-nowrap border-b-2 transition-colors ${
                  active === tab.id
                    ? 'border-orange text-[#ffd0a0]'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
          <ActiveComponent
            key={`${active}-${selectedState}`}
            bundle={bundle}
            selectedState={selectedState}
          />
        </div>
      </div>
    );
  }

  // ── India-wide layout ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0a0f1c]/50">
      <div className="flex gap-1 border-b border-[#2a3a54] px-4 pt-3 pb-0 flex-none overflow-x-auto no-scrollbar bg-[#0a0f1c] z-10 sticky top-0 shadow-md">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`relative px-4 py-3 text-[12px] font-bold whitespace-nowrap border-b-2 transition-colors ${
              active === tab.id
                ? 'border-orange text-[#ffd0a0]'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {tab.label}
            {tab.id === 'wind' && active !== 'wind' && (
              <span className="absolute top-2 right-1.5 w-1.5 h-1.5 rounded-full bg-orange/70 wpi-pulse-soft" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
        <ActiveComponent
          key={active}
          bundle={bundle}
          selectedState={selectedState}
        />
      </div>
    </div>
  );
}

// ── Compact metric card used in state header ──────────────────────────────
function StatMetricCard({
  label, value, caption, accent,
}: {
  label: string; value: string; caption: string; accent: string;
}) {
  return (
    <div className="bg-[#0d1628]/80 border border-[#1e2c44] rounded-xl p-3 flex flex-col gap-1">
      <span className="text-[8.5px] font-bold uppercase tracking-wider text-muted/60 leading-tight">
        {label}
      </span>
      <span className="text-[15px] font-black font-mono tabular-nums leading-tight" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-[8px] text-muted/50 leading-tight line-clamp-2">
        {caption}
      </span>
    </div>
  );
}
