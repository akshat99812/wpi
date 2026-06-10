import React from 'react';
import { motion } from 'framer-motion';
import { WIND_HEIGHTS, type WindHeight } from '@/lib/wind/lookup';

/**
 * Interactive wind-speed legend (Global Wind Atlas) with a hub-height switcher.
 *
 * Doubles as the colour key AND a live slider: as the cursor moves over the
 * map, a pointer glides up/down the gradient to the colour for the wind speed
 * at that location and a bubble shows the value (m/s). Driven by the `wind`
 * prop, resolved from the pre-baked GWA grid for the selected height.
 *
 * The 50 / 100 / 150 m segmented control switches the rendered raster AND the
 * grid the cursor samples (lifted to MapCanvas via `onHeightChange`).
 *
 * Domain matches the baked raster: 4 m/s (bottom) → 9 m/s (top), clamped, held
 * fixed across heights so colours are comparable between them. Off-map /
 * no-data (null) parks the pointer and shows "—".
 */

const STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [0x3d, 0x93, 0xb5]],
  [0.2, [0x5a, 0xad, 0x82]],
  [0.4, [0xc8, 0xe0, 0x4a]],
  [0.6, [0xff, 0xc0, 0x41]],
  [0.8, [0xff, 0x7a, 0x1a]],
  [1.0, [0xff, 0x1a, 0x00]],
];
const WS_LO = 4;
const WS_HI = 9;
const BAR_H = 150; // px

const GRADIENT =
  'linear-gradient(to top,' +
  STOPS.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`).join(',') +
  ')';

function colorAt(frac: number): string {
  const t = Math.min(1, Math.max(0, frac));
  for (let k = 0; k < STOPS.length - 1; k++) {
    const [t0, c0] = STOPS[k];
    const [t1, c1] = STOPS[k + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1].join(',')})`;
}

interface Props {
  /** Wind speed (m/s) under the cursor, or null/undefined off-map / no-data. */
  wind?: number | null;
  /** Selected hub height (m). */
  height: WindHeight;
  onHeightChange: (h: WindHeight) => void;
}

export function WindScale({ wind, height, onHeightChange }: Props) {
  const has = wind != null && Number.isFinite(wind);
  const frac = has ? Math.min(1, Math.max(0, (wind! - WS_LO) / (WS_HI - WS_LO))) : 0;
  const tint = has ? colorAt(frac) : 'rgba(255,255,255,0.4)';
  const ticks = [9, 8, 7, 6, 5, 4];

  return (
    <div className="bg-gradient-to-b from-black/75 to-black/85 backdrop-blur-md border border-cyan-400/40 rounded-xl px-3 py-3 shadow-2xl select-none">
      <div className="text-[9px] sm:text-[10px] text-cyan-400 font-bold uppercase tracking-widest mb-2 text-center">
        Wind Speed
      </div>

      {/* Hub-height switcher */}
      <div className="flex items-center rounded-md border border-white/15 overflow-hidden mb-2.5 bg-black/30">
        {WIND_HEIGHTS.map((h) => {
          const active = h === height;
          return (
            <button
              key={h}
              type="button"
              onClick={() => onHeightChange(h)}
              aria-pressed={active}
              className={
                'flex-1 px-1.5 py-1 text-[10px] font-semibold tabular-nums transition-colors ' +
                (active
                  ? 'bg-cyan-400/85 text-black'
                  : 'text-white/65 hover:text-white hover:bg-white/10')
              }
            >
              {h}m
            </button>
          );
        })}
      </div>

      <div className="flex items-stretch gap-2">
        {/* Live value bubble — glides with the pointer */}
        <div className="relative w-[58px]" style={{ height: BAR_H }}>
          <motion.div
            className="absolute right-0 flex items-center gap-1"
            initial={false}
            animate={{ bottom: `${frac * 100}%`, opacity: has ? 1 : 0.35 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.4 }}
            style={{ transform: 'translateY(50%)' }}
          >
            <span
              className="font-mono tabular-nums text-[11px] font-semibold leading-none rounded px-1.5 py-1 border"
              style={{
                color: '#fff',
                background: 'rgba(0,0,0,0.55)',
                borderColor: tint,
                boxShadow: has ? `0 0 8px ${tint}66` : 'none',
              }}
            >
              {has ? wind!.toFixed(1) : '—'}
            </span>
            <span
              className="block w-0 h-0"
              style={{
                borderTop: '5px solid transparent',
                borderBottom: '5px solid transparent',
                borderLeft: `6px solid ${tint}`,
              }}
            />
          </motion.div>
        </div>

        {/* Gradient bar */}
        <div
          className="w-2.5 rounded-full border border-white/20"
          style={{ height: BAR_H, background: GRADIENT }}
        />

        {/* Tick labels */}
        <div
          className="relative font-mono tabular-nums text-[8.5px] text-white/55"
          style={{ height: BAR_H }}
        >
          {ticks.map((v) => {
            const f = (v - WS_LO) / (WS_HI - WS_LO);
            return (
              <span
                key={v}
                className="absolute left-0 whitespace-nowrap leading-none"
                style={{ bottom: `${f * 100}%`, transform: 'translateY(50%)' }}
              >
                {v === WS_LO ? '<4' : v === WS_HI ? '9+' : v}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-cyan-400/20 text-[8px] text-cyan-300/60 italic leading-snug max-w-[150px]">
        GWA v4 mean @ {height} m (DTU / World&nbsp;Bank) · move the cursor to read m/s.
      </div>
    </div>
  );
}
