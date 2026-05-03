"use client";

import React, { useState } from 'react';
import { WpiBundle } from '@/lib/types';

const SOURCE_META: Record<string, { label: string; category: string }> = {
  mnre:             { label: 'MNRE',          category: 'Gov' },
  cea:              { label: 'CEA',           category: 'Gov' },
  niwe:             { label: 'NIWE',          category: 'Gov' },
  seci:             { label: 'SECI',          category: 'Gov' },
  cerc:             { label: 'CERC',          category: 'Gov' },
  state_serc:       { label: 'SERCs',         category: 'Gov' },
  state_nodal:      { label: 'State Nodal',   category: 'Gov' },
  pib:              { label: 'PIB',           category: 'Gov' },
  lenders:          { label: 'Lenders',       category: 'Finance' },
  grid:             { label: 'POSOCO',        category: 'Grid' },
  global_wind_atlas:{ label: 'GWA',           category: 'Resource' },
  mercom:           { label: 'Mercom',        category: 'Media' },
  renewable_watch:  { label: 'RenewWatch',    category: 'Media' },
  oem_reports:      { label: 'OEM Reports',   category: 'Industry' },
  analyst_notes:    { label: 'Analyst Notes', category: 'Industry' },
};

const CATEGORY_COLOR: Record<string, string> = {
  Gov:      'text-[#7bc4e2]',
  Finance:  'text-[#ffb066]',
  Grid:     'text-[#4cc87a]',
  Resource: 'text-[#c47bdd]',
  Media:    'text-[#e2c47b]',
  Industry: 'text-[#e27b7b]',
};

export default function SourceStatusBar({ status }: { status?: WpiBundle['sourceStatus'] }) {
  const [expanded, setExpanded] = useState(false);

  const sources = Object.keys(SOURCE_META);
  const okCount = sources.filter(k => status?.[k]?.ok).length;
  const total   = sources.length;
  const allOk   = okCount === total;
  const fixtureCount = sources.filter(k => status?.[k]?.fixturesUsed).length;

  return (
    <div className="bg-[#0b0f1c] border border-[#1e2c44] rounded-xl p-3 flex-none">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${allOk ? 'bg-[#4cc87a] shadow-[0_0_6px_#4cc87a]' : 'bg-[#ffb066] shadow-[0_0_6px_#ffb066]'}`} />
          <span className="text-[10px] font-bold uppercase tracking-[1px] text-muted">Data Sources</span>
          <span className={`text-[11px] font-mono font-bold ${allOk ? 'text-[#4cc87a]' : 'text-[#ffb066]'}`}>
            {okCount}/{total} OK
          </span>
          {fixtureCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1a2133] border border-[#2a3350] text-muted">
              {fixtureCount} fixture
            </span>
          )}
        </div>
        <span className={`text-[10px] text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {/* Expanded detail grid */}
      {expanded && (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 gap-1.5 pt-3 border-t border-[#1a2138]">
          {sources.map(key => {
            const s    = status?.[key];
            const meta = SOURCE_META[key];
            const ok   = s?.ok ?? false;
            const fix  = s?.fixturesUsed ?? false;
            const catColor = CATEGORY_COLOR[meta.category] ?? 'text-muted';

            return (
              <div
                key={key}
                title={s?.error ?? (fix ? 'Using fixture data' : 'Live data')}
                className={`flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border transition-colors ${
                  ok
                    ? fix
                      ? 'bg-[#1a180a] border-[#2e2a10]'
                      : 'bg-[#0d1c10] border-[#1d3020]'
                    : 'bg-[#1c0d0d] border-[#3a1515]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full flex-none ${ok ? (fix ? 'bg-[#c8a030]' : 'bg-[#4cc87a]') : 'bg-[#e85c5c]'}`} />
                  <span className={`text-[9.5px] font-bold truncate ${catColor}`}>{meta.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8.5px] text-muted/60">{meta.category}</span>
                  {fix && <span className="text-[8px] text-[#c8a030]">fixture</span>}
                  {!ok && s?.error && <span className="text-[8px] text-red-400 truncate">err</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
