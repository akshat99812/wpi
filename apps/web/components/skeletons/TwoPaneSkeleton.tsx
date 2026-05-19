import React from 'react';

/**
 * Two-pane skeleton that mirrors the Finance and Research page layout:
 * a left "primary" pane (KPI strip + stacked sections) and a right
 * "secondary" pane (calculator / search form). Used as the Suspense
 * fallback while a portal route's chunk loads on client navigation.
 */
interface Props {
  /** Eyebrow shown at the top of the left pane (e.g., "Finance Bench"). */
  leftEyebrow:  string;
  /** Eyebrow shown at the top of the right pane (e.g., "Bankability"). */
  rightEyebrow: string;
}

export default function TwoPaneSkeleton({ leftEyebrow, rightEyebrow }: Props) {
  return (
    <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] overflow-y-auto lg:overflow-hidden min-h-0">

      {/* ── Left pane ── */}
      <section className="bg-[#0a0e18] border-b lg:border-b-0 lg:border-r border-[#1f2740]
                          lg:overflow-y-auto custom-scrollbar p-3 sm:p-4 lg:p-5
                          flex flex-col gap-5">

        {/* Eyebrow */}
        <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold">
          <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange/60 to-transparent" />
          {leftEyebrow}
        </div>

        {/* KPI strip — 3 columns on small, 6 on wide */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-[#131826] border border-[#1e2c44] p-2.5 rounded-xl flex flex-col gap-2">
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
                  <div key={j} className="h-3 w-12 rounded bg-[#13192a] animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Right pane ── */}
      <section className="bg-[#0c1120] lg:overflow-y-auto custom-scrollbar p-3 sm:p-4 lg:p-5
                          flex flex-col gap-5 min-h-[560px] lg:min-h-0">

        {/* Eyebrow */}
        <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold">
          <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange/60 to-transparent" />
          {rightEyebrow}
        </div>

        {/* Form / output stack — title + 6 rows + footer */}
        <div className="border border-[#1a2138] rounded-xl bg-[#0d1220] p-4 flex flex-col gap-3.5">
          <div className="h-3 w-1/3 rounded bg-[#13192a] animate-pulse" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-2.5 w-1/4 rounded bg-[#13192a] animate-pulse" />
              <div className="h-7 w-full rounded-md bg-[#13192a] animate-pulse" />
            </div>
          ))}
          <div className="h-9 w-full rounded-md bg-[#1a2238] animate-pulse mt-1" />
        </div>

        {/* Results card */}
        <div className="border border-[#1a2138] rounded-xl bg-[#0d1220] p-4 flex flex-col gap-3">
          <div className="h-3 w-1/4 rounded bg-[#13192a] animate-pulse" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="h-2.5 w-2/3 rounded bg-[#13192a] animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-[#13192a] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
