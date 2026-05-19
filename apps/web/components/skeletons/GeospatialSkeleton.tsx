import React from 'react';

/**
 * Body-only skeleton for the Geospatial page. Mirrors the two-pane
 * layout (map on the left, tab panel on the right) so the user sees
 * the destination shape before maplibre and the bundle arrive.
 *
 * Used in two places:
 *   1. Dashboard.tsx — while the bundle fetch is in flight.
 *   2. app/(portal)/geospatial/loading.tsx — while the route chunk
 *      is loading during client-side navigation.
 *
 * Does NOT include the TopBar — the (portal) layout owns that and
 * keeps it mounted across navigations.
 */
export default function GeospatialSkeleton() {
  return (
    <main className="flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0 overflow-y-auto lg:overflow-hidden">
      {/* ── Left: map placeholder ── */}
      <section className="flex-[6] glass-panel rounded-xl flex flex-col overflow-hidden min-h-[50vh] lg:min-h-0">
        <div className="px-6 lg:px-8 py-3 border-b border-[#1e2c44] flex justify-between items-center flex-none">
          <div className="h-4 w-36 rounded bg-[#13192a] animate-pulse" />
          <div className="h-3 w-24 rounded bg-[#13192a] animate-pulse hidden md:block" />
        </div>
        <div className="flex-1 relative bg-[#0a0f1c]">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#0d1424] via-[#0a0f1c] to-[#0d1424]" />
        </div>
      </section>

      {/* ── Right: tab panel placeholder ── */}
      <section className="flex-[4] flex flex-col min-h-[55vh] lg:min-h-0 overflow-hidden gap-0">
        <div className="glass-panel rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex gap-2 border-b border-[#2a3a54] px-4 pt-3 pb-2.5 flex-none">
            {[18, 22, 16, 18, 14].map((w, i) => (
              <div key={i} className="h-5 rounded bg-[#13192a] animate-pulse" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
          <div className="flex-1 p-4 flex flex-col gap-3 overflow-hidden">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="rounded-xl border border-[#1e2c44] bg-[#0d1424] p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-[#13192a] animate-pulse" />
                  <div className="h-3 w-1/3 rounded bg-[#13192a] animate-pulse" />
                </div>
                <div className="h-4 w-3/4 rounded bg-[#13192a] animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-[#13192a] animate-pulse" />
              </div>
            ))}
          </div>
          <div className="flex-none border-t border-[#1a2138] px-4 py-3 flex items-center gap-3">
            <div className="h-3 w-20 rounded bg-[#13192a] animate-pulse" />
            <div className="flex gap-1.5 ml-auto">
              {[1, 2, 3, 4, 5, 6, 7].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-[#13192a] animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
