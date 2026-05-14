"use client";

import React, { useState, useEffect } from 'react';
import type { WpiBundle } from '@/lib/types';
import './tabpanel.animations.css';
import { STATE_PROFILES } from './stateProfiles';

import WindSection       from './sections/WindSection';
import CapacitySection   from './sections/CapacitySection';
import PolicySection     from './sections/PolicySection';
import TariffsSection    from './sections/TariffsSection';
import GridSection       from './sections/GridSection';
import LandSection       from './sections/LandSection';
import NewsSection       from './sections/NewsSection';
import TechnologySection from './sections/TechnologySection';

const TABS = [
  { id: 'wind',       label: 'Wind',       Component: WindSection,       indiaOnly: false },
  { id: 'capacity',   label: 'Capacity',   Component: CapacitySection,   indiaOnly: false },
  { id: 'policy',     label: 'Policy',     Component: PolicySection,     indiaOnly: false },
  { id: 'tariffs',    label: 'Tariffs',    Component: TariffsSection,    indiaOnly: false },
  { id: 'grid',       label: 'Grid',       Component: GridSection,       indiaOnly: false },
  { id: 'land',       label: 'Land',       Component: LandSection,       indiaOnly: true  },
  { id: 'technology', label: 'Technology', Component: TechnologySection, indiaOnly: true  },
  { id: 'news',       label: 'News',       Component: NewsSection,       indiaOnly: false },
] as const;

type TabId = typeof TABS[number]['id'];

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
  onClearState?:  () => void;
}

export default function TabPanel({ bundle, selectedState, onClearState }: Props) {
  const [active, setActive] = useState<TabId>('wind');

  // Preserve the active tab across state changes — if a user is on Grid or
  // Tariffs and clicks a different state on the map, they should stay on
  // Grid / Tariffs (just re-scoped to the new state). The only exception is
  // entering a state while on an India-only tab (Land / Technology), since
  // those tabs are hidden in state view — fall back to Wind in that case.
  useEffect(() => {
    if (!selectedState) return;
    const activeTab = TABS.find(t => t.id === active);
    if (activeTab?.indiaOnly) {
      setActive('wind');
    }
  }, [selectedState, active]);

  const ActiveComponent = TABS.find(t => t.id === active)?.Component ?? WindSection;
  const profile = selectedState ? STATE_PROFILES[selectedState] ?? null : null;

  // ── State detail layout ─────────────────────────────────────────────────
  if (selectedState) {
    // Prefer the live bundle's installed_mw (refreshed from MNRE / state
    // nodal crawlers) over the static profile fallback. Potential is left
    // on the static profile per product spec.
    const liveRow      = bundle?.stateCapacity?.find(s => s.state === selectedState);
    const installedMw  = liveRow?.installed_mw ?? profile?.installed_mw ?? 0;
    const installedSrc = liveRow?.installed_mw != null;
    const realisationPct = profile
      ? ((installedMw / 1000) / profile.potential_gw * 100).toFixed(2)
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
                value={`${installedMw.toLocaleString('en-IN')} MW`}
                caption={installedSrc ? 'Live · MNRE / state nodal crawl' : profile.installed_caption}
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

          {/* Tab bar — always visible so users can browse sections even when
              we don't have a curated profile for the state. India-only tabs
              (e.g. Technology / ALMM) are hidden in state detail. */}
          <div className="flex gap-0.5 border-t border-[#2a3a54] px-4 pt-2 pb-0 overflow-x-auto no-scrollbar">
            {TABS.filter(t => !t.indiaOnly).map(tab => (
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
          {profile ? (
            <ActiveComponent
              key={`${active}-${selectedState}`}
              bundle={bundle}
              selectedState={selectedState}
            />
          ) : (
            <NoProfileNotice
              key={`${active}-${selectedState}`}
              state={selectedState}
              tabLabel={TABS.find(t => t.id === active)?.label ?? ''}
            />
          )}
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

// ── Notice shown for states without a curated wind profile ────────────────
function NoProfileNotice({ state, tabLabel }: { state: string; tabLabel: string }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-muted/40" />
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted/55">
          {tabLabel} · No Data
        </span>
      </div>

      {/* Per-tab empty state */}
      <div className="bg-[#0d1628]/70 border border-dashed border-[#2a3a54] rounded-xl p-5 flex flex-col items-center text-center gap-2">
        <div className="w-9 h-9 rounded-full bg-[#1a2138] border border-[#2a3a54] flex items-center justify-center text-muted/55">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-[12.5px] font-semibold text-text/85">
          No {tabLabel.toLowerCase()} data available for {state}.
        </p>
        <p className="text-[10.5px] text-muted/60 leading-relaxed max-w-[36ch]">
          We don&apos;t track this section for non-primary wind states.
        </p>
      </div>

      {/* NIWE blurb — shown alongside every tab's empty state */}
      <div className="bg-[#0d1628]/70 border border-[#1e2c44] rounded-xl p-4 flex flex-col gap-3">
        <p className="text-[12.5px] leading-relaxed text-text/85">
          <b className="text-[#ffd0a0]">{state}</b> is not currently one of India&apos;s
          primary wind-energy states. Any latent 150 m potential should be
          consulted on the NIWE Resource Portal.
        </p>

        <a
          href="https://maps.niwe.res.in/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-[10px] font-semibold uppercase tracking-wider text-orange hover:opacity-80 transition-opacity"
        >
          Open NIWE Resource Portal
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </div>
  );
}
