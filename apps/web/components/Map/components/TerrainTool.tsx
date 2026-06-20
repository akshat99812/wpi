import React from 'react';
import { MIN_EXAGGERATION, MAX_EXAGGERATION } from '../utils/terrain';
import { ELEVATION_STOPS, elevationGradientCss } from '../utils/elevationTint';

/**
 * Right-panel controls for 3D terrain + the hypsometric elevation tint. Both
 * are orthogonal to the basemap and to each other (the tint works in 2D too),
 * so each is its own toggle, mirroring LayersTool's switch rows and
 * WindResourceCard's slider. Sub-controls reveal only when their toggle is on.
 */

interface Props {
  enabled: boolean;
  exaggeration: number;
  tintEnabled: boolean;
  tintOpacity: number;
  onToggle3D: (next: boolean) => void;
  onExaggerationChange: (next: number) => void;
  onToggleTint: (next: boolean) => void;
  onTintOpacityChange: (next: number) => void;
}

export function TerrainTool({
  enabled,
  exaggeration,
  tintEnabled,
  tintOpacity,
  onToggle3D,
  onExaggerationChange,
  onToggleTint,
  onTintOpacityChange,
}: Props) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <p className="px-1 pb-1 text-xs text-slate-400">
        Tilt the map into 3D and shade it by elevation.
      </p>

      <ToggleRow
        label="3D terrain"
        description="Elevation mesh + hillshade (drag to tilt)"
        swatch="#7dd3fc"
        icon={<TerrainIcon className="h-3.5 w-3.5" />}
        checked={enabled}
        onChange={onToggle3D}
      />
      {enabled && (
        <Slider
          label="Exaggeration"
          value={exaggeration}
          min={MIN_EXAGGERATION}
          max={MAX_EXAGGERATION}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={onExaggerationChange}
        />
      )}

      <ToggleRow
        label="Elevation colour"
        description="Hypsometric tint · purple → red"
        swatch="#a855f7"
        icon={<ElevationIcon className="h-3.5 w-3.5" />}
        checked={tintEnabled}
        onChange={onToggleTint}
      />
      {tintEnabled && (
        <>
          <Slider
            label="Tint opacity"
            value={tintOpacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={onTintOpacityChange}
          />
          <ElevationLegend />
        </>
      )}
    </div>
  );
}

/**
 * Vertical purple→red legend strip, built from the SAME India-tuned stops as the
 * layer. Tick labels are positioned at each stop's true elevation fraction so
 * the legend reads non-linearly, exactly like the colour ramp.
 */
function ElevationLegend() {
  const max = ELEVATION_STOPS[ELEVATION_STOPS.length - 1][0] || 1;
  const fmt = (m: number) => `${m.toLocaleString('en-IN')} m`;
  // Curated, well-spaced subset (the gradient bar still shows all 7 bands); the
  // low stops sit too close together to label without overlapping.
  const ticks = [0, 350, 900, 1400, max];
  return (
    <div className="mx-2 mb-1 mt-1 flex items-stretch gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 px-2.5 py-2">
      <div
        className="relative h-28 w-3 shrink-0 rounded"
        style={{ background: elevationGradientCss() }}
        aria-hidden
      />
      <div className="relative h-28 flex-1 font-mono text-[10px] tabular-nums text-slate-300">
        {ticks.map((elev) => (
          <span
            key={elev}
            className="absolute left-0 -translate-y-1/2 whitespace-nowrap"
            style={{ bottom: `${(elev / max) * 100}%` }}
          >
            {elev === max ? `${fmt(elev)}+` : fmt(elev)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Labelled range slider, matching WindResourceCard's opacity slider style. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="px-2 pb-2 pt-1">
      <div className="flex items-baseline justify-between pb-1">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="font-mono text-[10px] tabular-nums text-slate-200">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-500"
      />
    </div>
  );
}

/** Switch row mirroring LayersTool's ToggleRow (kept local — presentational). */
function ToggleRow({
  label,
  description,
  swatch,
  icon,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  swatch: string;
  icon: React.ReactNode;
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
        className="grid h-3.5 w-3.5 shrink-0 place-items-center"
        style={{ color: swatch }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-100">{label}</span>
        <span className="block truncate text-xs text-slate-400">
          {description}
        </span>
      </span>
      <SwitchVisual checked={checked} />
    </button>
  );
}

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

/** Mountain-range glyph for the 3D terrain toggle + ProSidebar launcher. */
export function TerrainIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m3 20 6-11 4 7 2-3 6 7z" />
      <path d="m9 9 2.2 3.8" />
    </svg>
  );
}

/** Layered-elevation glyph for the elevation-colour toggle. */
function ElevationIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 16h18" />
      <path d="M6 12h12" />
      <path d="M9 8h6" />
      <path d="M11 4h2" />
    </svg>
  );
}
