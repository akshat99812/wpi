import React from 'react';

/**
 * Wind speed legend — single continuous GWA gradient bar.
 *
 * Mirrors the reference NIWE / GWA portal:
 *   linear-gradient(90deg,
 *     #3d93b5 0%, #5aad82 20%, #c8e04a 40%,
 *     #ffc041 60%, #ff7a1a 80%, #ff1a00 100%)
 *
 * Endpoint labels are <4 m/s and >8 m/s — same as the reference. Tick
 * marks at the integer m/s values give scientific readability without
 * over-cluttering.
 */
const RAMP =
  'linear-gradient(90deg,' +
  '#3d93b5 0%, #5aad82 20%, #c8e04a 40%,' +
  '#ffc041 60%, #ff7a1a 80%, #ff1a00 100%)';

export function WindLegend() {
  return (
    <div className="bg-gradient-to-b from-black/75 to-black/85 backdrop-blur-md border border-cyan-400/40 rounded-xl px-3 sm:px-4 py-2 sm:py-3 shadow-2xl w-[160px] sm:w-[220px]">
      <div className="text-[9px] sm:text-[10px] text-cyan-400 font-bold uppercase tracking-widest mb-2">
        Wind Speed @ 100 m
      </div>

      {/* Continuous gradient bar */}
      <div
        className="h-2 rounded-full border border-white/15"
        style={{ background: RAMP }}
      />

      {/* Tick labels — match the gradient stops at 4, 5, 6, 7, 8 m/s */}
      <div className="flex justify-between mt-1.5 text-[8.5px] text-white/55 font-mono tabular-nums">
        <span>&lt;4</span>
        <span>5</span>
        <span>6</span>
        <span>7</span>
        <span>8</span>
        <span>&gt;8</span>
      </div>
      <div className="text-center text-[8.5px] text-white/40 mt-0.5">m/s</div>

      <div className="mt-2.5 pt-2.5 border-t border-cyan-400/20 text-[8px] text-cyan-300/60 italic leading-snug">
        NIWE India Wind Atlas (2019) &amp; DTU Global Wind Atlas regional means.
      </div>
    </div>
  );
}