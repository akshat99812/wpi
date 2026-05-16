"use client";

import React, { useState, useCallback } from 'react';
import type { WpiBundle } from '@/lib/types';
import MapCanvas, { type BasemapId } from './Map';
import TabPanel from './KnowledgeBank/TabPanel';
import SourceStatusBar from './SourceStatusBar';

interface Props { bundle: WpiBundle | null }

export default function PortalShell({ bundle }: Props) {
  const [selectedState, setSelected]  = useState<string | null>(null);
  const [basemap, setBasemap]         = useState<BasemapId>('satellite');

  const clearState = useCallback(() => setSelected(null), []);

  return (
    <>
      <main className="flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0 overflow-y-auto lg:overflow-hidden">

        {/* ── Left: Map ──────────────────────────────── */}
        <section className="flex-[6] glass-panel rounded-xl flex flex-col overflow-hidden min-h-[50vh] lg:min-h-0">
          <div className="px-6 lg:px-8 py-3 border-b border-[#1e2c44] flex justify-between items-center flex-none">
            <h1 className="text-[15px] font-bold tracking-tight leading-none">
              <span className="text-text">Wind Power</span>
              <span className="inline-block w-2" />
              <span className="bg-gradient-to-r from-orange to-[#ffd0a0] bg-clip-text text-transparent">India</span>
            </h1>
            <span suppressHydrationWarning className="text-[10px] text-muted hidden md:flex items-center gap-2">
              <span className="uppercase tracking-[0.14em] text-muted/55 text-[9px]">Updated</span>
              {bundle?.generatedAt
                ? new Date(bundle.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : 'Offline mode'}
            </span>
          </div>
          <div className="flex-1 relative min-h-0">
            <MapCanvas
              bundle={bundle ?? undefined}
              selectedState={selectedState}
              basemap={basemap}
              onStateSelect={setSelected}
              onBasemapChange={setBasemap}
            />
          </div>
        </section>

        {/* ── Right: Knowledge bank ───────── */}
        <section className="flex-[4] flex flex-col min-h-[55vh] lg:min-h-0 overflow-hidden gap-0">
          <div className="glass-panel rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <TabPanel bundle={bundle ?? undefined} selectedState={selectedState} onClearState={clearState} />
            </div>
            <div className="flex-none border-t border-[#1a2138]">
              <SourceStatusBar status={bundle?.sourceStatus} />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
