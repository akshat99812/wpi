import React from 'react';
import { motion } from 'framer-motion';
import {
  VOLTAGE_COLORS,
  PLANT_COLORS,
  SUBSTATION_MIN_ZOOM,
  PLANT_MIN_ZOOM,
  LOW_VOLTAGE_VISIBLE_ZOOM,
  EHV_MIN_VOLTAGE,
} from '../utils/powerGrid';
import {
  WIND_METRICS,
  type WindMetric,
  type WindMetricMeta,
} from '../utils/windResource';

/** 'off' plus the bake-emitted metrics — the segmented control's value. */
export type WindMetricChoice = 'off' | WindMetric;

/** Stacked-layers icon for the Layers card's launcher + header. */
export function LayersIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

interface Props {
  /** "Windmills" = wind-farm site boundaries. */
  showWindmills: boolean;
  /** "Masts" = wind-mast measurement points. */
  showMasts: boolean;
  /** "Electricity Grid" = OpenInfraMap lines/substations/RE plants. */
  showPowerGrid: boolean;
  /** Active wind-resource raster — 'off', or a metric from metadata.json. */
  windMetric: WindMetricChoice;
  /** Hub height (m) for the active wind-resource metric. */
  windHeight: number;
  /** Live value under the cursor for the active metric (drives the legend
   *  arrow). null/undefined off-map or over no-data. */
  windValue?: number | null;
  onToggleWindmills: (next: boolean) => void;
  onToggleMasts: (next: boolean) => void;
  onTogglePowerGrid: (next: boolean) => void;
  onWindMetricChange: (next: WindMetricChoice) => void;
  onWindHeightChange: (next: number) => void;
}

/**
 * Content of the right-hand "Layers" card: one toggle per dataset so the user
 * can show the wind-farm boundaries ("Wind Turbines" — internally still
 * `showWindmills` for historical reasons), the mast points ("Masts"), the
 * electricity grid, any, or all. Swatch colours mirror the map layers exactly
 * (orange #ff8a1f boundaries, blue #1d9bf0 mast points, purple 400 kV grid
 * lines).
 */
export function LayersTool({
  showWindmills,
  showMasts,
  showPowerGrid,
  windMetric,
  windHeight,
  windValue,
  onToggleWindmills,
  onToggleMasts,
  onTogglePowerGrid,
  onWindMetricChange,
  onWindHeightChange,
}: Props) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <p className="px-1 pb-1 text-xs text-slate-400">
        Choose which datasets to show on the map.
      </p>
      <ToggleRow
        label="Wind Turbines"
        description="Wind-farm site boundaries"
        swatch="#ff8a1f"
        checked={showWindmills}
        onChange={onToggleWindmills}
      />
      <ToggleRow
        label="Masts"
        description="Wind-mast measurement points"
        swatch="#1d9bf0"
        checked={showMasts}
        onChange={onToggleMasts}
      />
      <ToggleRow
        label="Electricity Grid"
        description="Transmission lines, substations & RE plants"
        // 400 kV purple — taken from the live palette so it can't drift.
        swatch={VOLTAGE_COLORS.find(([kv]) => kv === 400)?.[1] ?? VOLTAGE_COLORS[0][1]}
        checked={showPowerGrid}
        onChange={onTogglePowerGrid}
      />
      {showPowerGrid && <PowerGridLegend />}
      <WindResourceSection
        metric={windMetric}
        height={windHeight}
        value={windValue}
        onMetricChange={onWindMetricChange}
        onHeightChange={onWindHeightChange}
      />
    </div>
  );
}

/**
 * "Wind resource" segmented control (Off / Speed / Density) + hub-height
 * pills + colour-ramp legend. Heights, units, domains, and ramp colours all
 * come from the bake-emitted metadata.json via WIND_METRICS — nothing here
 * can drift from the baked tiles.
 */
function WindResourceSection({
  metric,
  height,
  value,
  onMetricChange,
  onHeightChange,
}: {
  metric: WindMetricChoice;
  height: number;
  value?: number | null;
  onMetricChange: (next: WindMetricChoice) => void;
  onHeightChange: (next: number) => void;
}) {
  const options: { id: WindMetricChoice; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'speed', label: 'Speed' },
    { id: 'density', label: 'Density' },
  ];
  const active = metric !== 'off' ? WIND_METRICS[metric] : null;

  return (
    <div className="mt-2 border-t border-white/10 px-1 pt-2">
      <p className="pb-1.5 text-sm font-medium text-slate-100">Wind resource</p>
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
 * arrow glides along the band to the cursor's live value (spring tuning
 * matches the main map's WindScale pointer); the value slot is fixed-width so
 * the card never resizes — off-map / no-data hides the arrow and shows "—".
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
  const stops = meta.ramp
    .map((s) => `${s.color} ${(((s.value - lo) / (hi - lo)) * 100).toFixed(1)}%`)
    .join(', ');
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

// Union of every metric's heights — heights a metric lacks render as blocked
// pills rather than disappearing (the colour-band legend lives on the map's
// bottom bar, see WindResourceScale).
const ALL_HEIGHTS = Array.from(
  new Set(Object.values(WIND_METRICS).flatMap((m) => m.heights)),
).sort((a, b) => a - b);

/**
 * Legend for the Electricity Grid layer — built from the same constants the
 * map layers use (utils/powerGrid.ts), so it can never drift from the map.
 */
function PowerGridLegend() {
  return (
    <div className="mt-1 rounded-lg bg-white/5 px-3 py-2">
      <p className="pb-1 text-[11px] font-medium text-slate-300">
        Lines &amp; substations
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {VOLTAGE_COLORS.map(([kv, color]) => (
          <span key={kv} className="flex items-center gap-1 text-[11px] text-slate-300">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            {kv}
          </span>
        ))}
        <span className="text-[11px] text-slate-400">kV</span>
      </div>
      <p className="pb-1 pt-2 text-[11px] font-medium text-slate-300">Plants</p>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-[11px] text-slate-300">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: PLANT_COLORS.wind }}
          />
          Wind
        </span>
        <span className="flex items-center gap-1 text-[11px] text-slate-300">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: PLANT_COLORS.solar }}
          />
          Solar
        </span>
      </div>
      <p className="pt-2 text-[10px] leading-relaxed text-slate-500">
        Substations from zoom {SUBSTATION_MIN_ZOOM} · plants from zoom{' '}
        {PLANT_MIN_ZOOM} · lines below {EHV_MIN_VOLTAGE} kV from zoom{' '}
        {LOW_VOLTAGE_VISIBLE_ZOOM}
      </p>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  swatch,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  swatch: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label} — ${description}`}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5"
    >
      <span
        className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/10"
        style={{ backgroundColor: swatch }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-100">{label}</span>
        <span className="block truncate text-xs text-slate-400">{description}</span>
      </span>
      <SwitchVisual checked={checked} />
    </button>
  );
}

/** Presentational track + thumb. The parent row is the interactive control. */
function SwitchVisual({ checked }: { checked: boolean }) {
  return (
    <span
      className={
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ' +
        (checked ? 'bg-sky-500' : 'bg-slate-600')
      }
    >
      <span
        className={
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' +
          (checked ? 'translate-x-4' : 'translate-x-0.5')
        }
      />
    </span>
  );
}
