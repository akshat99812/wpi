import React from 'react';
import {
  VOLTAGE_COLORS,
  PLANT_COLORS,
  SUBSTATION_MIN_ZOOM,
  PLANT_MIN_ZOOM,
  LOW_VOLTAGE_VISIBLE_ZOOM,
  EHV_MIN_VOLTAGE,
} from '../utils/powerGrid';
import { PRIVATE_MAST_COLOR } from '../utils/privateMasts';

/** Mast height buckets — mirror the `hcat` property baked into the windmill
 *  vector tiles (apps/api windmills route): 0 = <50 m, 1 = 50–100 m, 2 = >100 m. */
export type MastHeightCat = 'short' | 'mid' | 'tall';

export const MAST_CAT_LABELS: Record<MastHeightCat, string> = {
  short: '<50m',
  mid: '50–100m',
  tall: '100–200m',
};

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
  /** "Private Masts" = proprietary inventory (yellow pins). */
  showPrivateMasts: boolean;
  /** "Electricity Grid" = OpenInfraMap lines/substations/RE plants. */
  showPowerGrid: boolean;
  /** Which mast height buckets are visible (all true = no filtering). */
  mastCats: Record<MastHeightCat, boolean>;
  onToggleWindmills: (next: boolean) => void;
  onToggleMasts: (next: boolean) => void;
  onTogglePrivateMasts: (next: boolean) => void;
  onTogglePowerGrid: (next: boolean) => void;
  onMastCatChange: (cat: MastHeightCat, next: boolean) => void;
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
  showPrivateMasts,
  showPowerGrid,
  mastCats,
  onToggleWindmills,
  onToggleMasts,
  onTogglePrivateMasts,
  onTogglePowerGrid,
  onMastCatChange,
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
        label="Private Masts"
        description="Proprietary mast inventory"
        swatch={PRIVATE_MAST_COLOR}
        checked={showPrivateMasts}
        onChange={onTogglePrivateMasts}
      />
      {/* Height chips filter BOTH mast layers — show while either is on. */}
      {(showMasts || showPrivateMasts) && (
        <MastHeightChips cats={mastCats} onChange={onMastCatChange} />
      )}
      <ToggleRow
        label="Electricity Grid"
        description="Transmission lines, substations & RE plants"
        // 400 kV purple — taken from the live palette so it can't drift.
        swatch={VOLTAGE_COLORS.find(([kv]) => kv === 400)?.[1] ?? VOLTAGE_COLORS[0][1]}
        checked={showPowerGrid}
        onChange={onTogglePowerGrid}
      />
      {showPowerGrid && <PowerGridLegend />}
    </div>
  );
}

/** Mast measurement-height filter chips, shown while the Masts layer is on. */
function MastHeightChips({
  cats,
  onChange,
}: {
  cats: Record<MastHeightCat, boolean>;
  onChange: (cat: MastHeightCat, next: boolean) => void;
}) {
  return (
    <div className="mx-2 mb-1 ml-7 rounded-lg border border-slate-700/60 bg-slate-800/40 px-2.5 py-2">
      <p className="pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
        Mast height
      </p>
      <div className="flex items-center gap-1.5">
        {(Object.keys(MAST_CAT_LABELS) as MastHeightCat[]).map((cat) => {
          const on = cats[cat];
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(cat, !on)}
              className={
                'flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-1.5 ' +
                'font-mono text-[11px] tabular-nums transition-all ' +
                (on
                  ? 'border-sky-400/60 bg-sky-500/15 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.12)]'
                  : 'border-slate-600/60 bg-transparent text-slate-500 hover:border-slate-500 hover:text-slate-300')
              }
            >
              <span
                aria-hidden
                className={
                  'h-1.5 w-1.5 shrink-0 rounded-full transition-colors ' +
                  (on ? 'bg-sky-400' : 'bg-slate-600')
                }
              />
              {MAST_CAT_LABELS[cat]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
