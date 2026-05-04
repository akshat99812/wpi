"use client";

import React, { useState, useCallback } from 'react';
import type { WpiBundle } from '@/lib/types';
import ContextBar from './ContextBar';
import MapCanvas, { type BasemapId } from './Map/MapCanvas';
import MetricsStrip from './KnowledgeBank/MetricsStrip';
import TabPanel from './KnowledgeBank/TabPanel';
import SourceStatusBar from './SourceStatusBar';

interface Props { bundle: WpiBundle | null }

export default function PortalShell({ bundle }: Props) {
  const [selectedState, setSelected]  = useState<string | null>(null);
  const [basemap, setBasemap]         = useState<BasemapId>('satellite');
  const [metricsOpen, setMetricsOpen] = useState(true);

  const clearState = useCallback(() => setSelected(null), []);

  return (
    <>
      <ContextBar
        bundle={bundle}
        basemap={basemap}
        selectedState={selectedState}
        onStateClear={clearState}
      />

      <main className="flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0 overflow-hidden">

        {/* ── Left: Map ──────────────────────────────── */}
        <section className="flex-[6] glass-panel rounded-xl flex flex-col overflow-hidden min-h-[50vh] lg:min-h-0">
          <div className="px-4 py-2.5 border-b border-[#1e2c44] flex justify-between items-center flex-none">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-orange shadow-[0_0_6px_#ff8a1f]" />
              <h1 className="text-[14px] font-bold text-text">India Wind Intelligence Map</h1>
              <span className="text-[9px] px-2 py-0.5 bg-orange/10 text-orange border border-orange/20 rounded-full font-bold uppercase tracking-wide">Live</span>
            </div>
            <span suppressHydrationWarning className="text-[10px] text-muted hidden md:block">
              {bundle?.generatedAt
                ? `Updated ${new Date(bundle.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
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

        {/* ── Right: Three-zone knowledge bank ───────── */}
        <section className="flex-[4] flex flex-col min-h-0 overflow-hidden gap-0">

          {/* Zone 1: Collapsible metrics header */}
          <div className="flex-none">
            <MetricsStrip
              bundle={bundle ?? undefined}
              collapsed={!metricsOpen}
              onToggle={() => setMetricsOpen(v => !v)}
            />
          </div>

          {/* Zone 2 + 3: Glass panel */}
          <div className="glass-panel rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden mt-3">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <TabPanel bundle={bundle ?? undefined} selectedState={selectedState} />
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
