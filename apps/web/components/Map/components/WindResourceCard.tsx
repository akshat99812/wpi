import React from 'react';
import { motion } from 'framer-motion';
import {
  WIND_METRICS,
  type WindMetric,
  type WindMetricMeta,
} from '../utils/windResource';
import {
  rampToNormStops,
  steppedGradientStops,
} from '../utils/windRamp';

/** 'off' plus the bake-emitted metrics — the segmented control's value. */
export type WindMetricChoice = 'off' | WindMetric;

/**
 * Wind-resource controls: Off / Speed / Density segmented control, hub-height
 * pills, and the colour-ramp legend with the live cursor arrow.
 *
 * Two render modes:
 *  - default  → standalone floating card (own border / width / backdrop);
 *  - embedded → bare panel content for a ProSidebar tool (the sidebar supplies
 *    the chrome and the "Wind resource" header, so both are dropped).
 *
 * Heights, units, domains, and ramp colours all come from the bake-emitted
 * metadata.json via WIND_METRICS — nothing here can drift from the tiles.
 */
export function WindResourceCard({
  metric,
  height,
  value,
  opacity = 1,
  onMetricChange,
  onHeightChange,
  onOpacityChange,
  embedded = false,
}: {
  metric: WindMetricChoice;
  height: number;
  value?: number | null;
  /** Layer opacity, 0–1. Defaults to 1 (fully opaque). */
  opacity?: number;
  onMetricChange: (next: WindMetricChoice) => void;
  onHeightChange: (next: number) => void;
  /** When provided, an opacity slider is shown while a metric is active. */
  onOpacityChange?: (next: number) => void;
  embedded?: boolean;
}) {
  const options: { id: WindMetricChoice; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'speed', label: 'Speed' },
    { id: 'density', label: 'Density' },
  ];
  const active = metric !== 'off' ? WIND_METRICS[metric] : null;

  return (
    <div
      className={
        embedded
          ? 'px-4 py-3'
          : 'pointer-events-auto w-60 rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2.5 shadow-2xl backdrop-blur'
      }
    >
      {!embedded && (
        <p className="pb-1.5 text-sm font-medium text-slate-100">Wind resource</p>
      )}
      <div
        role="radiogroup"
        aria-label="Wind resource layer"
        className="flex gap-1"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={metric === o.id}
            onClick={() => onMetricChange(o.id)}
            className={
              'flex-1 rounded-md px-2 py-1 text-xs transition-colors ' +
              (metric === o.id
                ? 'bg-sky-500/90 text-white'
                : 'bg-white/5 text-slate-300 hover:bg-white/10')
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      {active && (
        <>
          <div className="flex items-center gap-1.5 pt-2">
            <span className="text-[11px] text-slate-400">Hub height</span>
            {ALL_HEIGHTS.map((h) => {
              const available = active.heights.includes(h);
              return (
                <button
                  key={h}
                  type="button"
                  disabled={!available}
                  aria-pressed={height === h}
                  title={
                    available
                      ? undefined
                      : `Not available for ${active.label.toLowerCase()}`
                  }
                  onClick={() => available && onHeightChange(h)}
                  className={
                    'rounded-md px-2 py-0.5 text-[11px] transition-colors ' +
                    (!available
                      ? 'cursor-not-allowed bg-white/[0.03] text-slate-600'
                      : height === h
                        ? 'bg-white/15 text-white'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10')
                  }
                >
                  {h} m
                </button>
              );
            })}
          </div>
          <RampLegend meta={active} value={value} />
          {onOpacityChange && (
            <OpacitySlider value={opacity} onChange={onOpacityChange} />
          )}
          <p className="pt-1.5 text-[10px] leading-relaxed text-slate-500">
            {active.label} · Global Wind Atlas · CC BY 4.0
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Horizontal colour-ramp bar with end labels, from the metadata ramp. A white
 * arrow glides along the band to the cursor's live value; the value slot is
 * fixed-width so the card never resizes — off-map / no-data hides the arrow
 * and shows "—".
 */
function RampLegend({
  meta,
  value,
}: {
  meta: WindMetricMeta;
  value?: number | null;
}) {
  const [lo, hi] = meta.domain as [number, number];
  const has = value != null && Number.isFinite(value);
  const frac = has ? Math.min(1, Math.max(0, ((value as number) - lo) / (hi - lo))) : 0;
  // Discrete band ramp: same boundaries the baked raster steps at, so the
  // legend reads as flat bands that change colour every 1/bands of the domain.
  const norm = rampToNormStops(meta.ramp, lo, hi);
  const stops = steppedGradientStops(norm, meta.bands);
  const label = !has
    ? '—'
    : meta.unit === 'm/s'
      ? (value as number).toFixed(1)
      : String(Math.round(value as number));

  return (
    <div className="pt-2">
      <div className="flex items-baseline justify-between pb-0.5">
        <span className="text-[10px] text-slate-400">Cursor</span>
        <span className="inline-block w-[11ch] text-right font-mono text-[10px] tabular-nums text-slate-200">
          {label} {meta.unit}
        </span>
      </div>
      {/* Fixed-height arrow track — constant card size with or without a value. */}
      <div className="relative h-2">
        <motion.span
          aria-hidden
          className="absolute top-0 block h-0 w-0"
          initial={false}
          animate={{ left: `${frac * 100}%`, opacity: has ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.4 }}
          style={{
            transform: 'translateX(-50%)',
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '6px solid #ffffff',
            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))',
          }}
        />
      </div>
      <div
        className="h-2 rounded-full"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      />
      <div className="flex justify-between pt-0.5 text-[10px] text-slate-400">
        <span>{lo === 0 ? '0' : `≤${lo}`} {meta.unit}</span>
        <span>≥{hi} {meta.unit}</span>
      </div>
    </div>
  );
}

/** Layer-opacity slider (0–100%). Drives the raster `raster-opacity` via the
 *  parent's onOpacityChange — the value is a 0–1 fraction. */
function OpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="pt-2.5">
      <div className="flex items-baseline justify-between pb-1">
        <span className="text-[11px] text-slate-400">Layer opacity</span>
        <span className="font-mono text-[10px] tabular-nums text-slate-200">{pct}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label="Wind layer opacity"
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-500"
      />
    </div>
  );
}

/** Wind-gust launcher icon for the ProSidebar, matching the MastIcon convention. */
export function WindIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      <path d="M3 8h9a2.5 2.5 0 1 0-2.4-3.2" />
      <path d="M3 12h13.5a2.5 2.5 0 1 1-2.4 3.2" />
      <path d="M3 16h6a2 2 0 1 1-1.9 2.6" />
    </svg>
  );
}

// Union of every metric's heights — heights a metric lacks render as blocked
// pills rather than disappearing.
const ALL_HEIGHTS = Array.from(
  new Set(Object.values(WIND_METRICS).flatMap((m) => m.heights)),
).sort((a, b) => a - b);
