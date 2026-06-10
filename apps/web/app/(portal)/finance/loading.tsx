import React from 'react';

/**
 * Suspense fallback for the Finance section. The sidebar lives in the layout
 * and stays mounted, so this only needs to fill the content area with a
 * single-pane dashboard skeleton (eyebrow + KPI grid + section rows).
 */
export default function Loading() {
  return (
    <div className="w-full max-w-5xl mx-auto p-3 sm:p-5 lg:p-7 flex flex-col gap-5">
      {/* Eyebrow */}
      <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold">
        <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange/60 to-transparent" />
        Finance Bench
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-[#131826] border border-[#1e2c44] p-2.5 rounded-lg flex flex-col gap-2">
            <div className="h-2.5 w-2/3 rounded bg-[#1a2238] animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-[#1a2238] animate-pulse" />
          </div>
        ))}
      </div>

      {/* Section list */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border border-[#1a2138] rounded-xl bg-[#0d1220] px-3.5 py-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-2/5 rounded bg-[#13192a] animate-pulse" />
              <div className="h-3 w-3 rounded bg-[#13192a] animate-pulse" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="h-3 w-16 rounded bg-[#13192a] animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
