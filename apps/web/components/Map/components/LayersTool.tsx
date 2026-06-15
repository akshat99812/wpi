import React from 'react';
import {
  VOLTAGE_COLORS,
  VOLTAGE_BANDS,
  PLANT_COLORS,
  SUBSTATION_MIN_ZOOM,
  PLANT_MIN_ZOOM,
  LOW_VOLTAGE_VISIBLE_ZOOM,
  EHV_MIN_VOLTAGE,
} from '../utils/powerGrid';

// The map dots are near-black (utils/turbines TURBINE_COLOR); on the dark
// sidebar that's invisible, so the toggle's glyph is tinted a legible light
// slate instead. The black symbol lives on the (light) map, where it reads.
const TURBINE_SWATCH = '#e2e8f0';

/** Three-blade turbine glyph for the "Wind turbines" layer toggle. */
function TurbineGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      <circle cx="12" cy="9" r="1.4" />
      <path d="M12 7.6V3" />
      <path d="M13.2 9.7l3.9 2.3" />
      <path d="M10.8 9.7l-3.9 2.3" />
      <path d="M11 10.3 11 21h2l-1-10.7" />
      <path d="M9.5 21h5" />
    </svg>
  );
}
/** Grid/transmission-tower icon for the Electricity Grid layer toggle. */
function GridIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden
    >
      {/* transmission tower: tapered legs, two cross-arms, ground line */}
      <path d="M8 21 12 3l4 18" />
      <path d="M9.3 12h5.4M8.6 16h6.8" />
      <path d="M5 8h14" />
      <path d="M5 8 9 6M19 8l-4-2" />
    </svg>
  );
}

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
  /** "Wind turbines" = individual OSM/OpenInfraMap turbine points (black dots). */
  showTurbines: boolean;
  /** "Masts" = all wind-mast points (public NIWE + private inventory). */
  showMasts: boolean;
  /** "Electricity Grid" = OpenInfraMap lines/substations/RE plants. */
  showPowerGrid: boolean;
  /** Which mast height buckets are visible (all true = no filtering). */
  mastCats: Record<MastHeightCat, boolean>;
  /** Which grid line-voltage bands are visible, keyed by band-min kV as a
   *  string (all true = no filtering). */
  voltageBands: Record<string, boolean>;
  onToggleTurbines: (next: boolean) => void;
  onToggleMasts: (next: boolean) => void;
  onTogglePowerGrid: (next: boolean) => void;
  onMastCatChange: (cat: MastHeightCat, next: boolean) => void;
  onVoltageBandChange: (kv: string, next: boolean) => void;
}

/**
 * Content of the right-hand "Layers" card: one toggle per dataset. Three
 * datasets, top to bottom:
 *   "Wind turbines"    → showTurbines  (individual OSM turbine dots, near-black)
 *   "Masts"            → showMasts     (NIWE blue + private inventory points)
 *   "Electricity Grid" → showPowerGrid (OpenInfraMap lines/substations/plants)
 * Swatch colours mirror the map layers (the turbine glyph is tinted light for
 * legibility on the dark card — its map dots are near-black).
 */
export function LayersTool({
  showTurbines,
  showMasts,
  showPowerGrid,
  mastCats,
  voltageBands,
  onToggleTurbines,
  onToggleMasts,
  onTogglePowerGrid,
  onMastCatChange,
  onVoltageBandChange,
}: Props) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <p className="px-1 pb-1 text-xs text-slate-400">
        Choose which datasets to show on the map.
      </p>
      <ToggleRow
        label="Wind turbines"
        description="Individual turbines (OpenStreetMap)"
        swatch={TURBINE_SWATCH}
        icon={<TurbineGlyph className="h-3.5 w-3.5" />}
        checked={showTurbines}
        onChange={onToggleTurbines}
      />
      <ToggleRow
        label="Masts"
        description="Wind-mast points (NIWE + private inventory)"
        swatch="#1d9bf0"
        checked={showMasts}
        onChange={onToggleMasts}
      />
      {/* Height chips filter the mast layers — show while masts are on. */}
      {showMasts && (
        <MastHeightChips cats={mastCats} onChange={onMastCatChange} />
      )}
      <ToggleRow
        label="Electricity Grid"
        description="Transmission lines, substations & RE plants"
        // 400 kV purple — taken from the live palette so it can't drift.
        swatch={VOLTAGE_COLORS.find(([kv]) => kv === 400)?.[1] ?? VOLTAGE_COLORS[0][1]}
        icon={<GridIcon className="h-3.5 w-3.5" />}
        checked={showPowerGrid}
        onChange={onTogglePowerGrid}
      />
      {/* Voltage chips isolate the grid LINES — show while the grid is on. */}
      {showPowerGrid && (
        <VoltageChips bands={voltageBands} onChange={onVoltageBandChange} />
      )}
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
 * Voltage-band filter chips for the grid LINES — one per VOLTAGE_BANDS entry.
 * Doubles as the interactive line-voltage legend (the colours match the map).
 * Toggling a chip isolates the lines to the selected bands; all on = no filter.
 */
function VoltageChips({
  bands,
  onChange,
}: {
  bands: Record<string, boolean>;
  onChange: (kv: string, next: boolean) => void;
}) {
  return (
    <div className="mx-2 mb-1 ml-7 rounded-lg border border-slate-700/60 bg-slate-800/40 px-2.5 py-2">
      <p className="pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
        Line voltage
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {VOLTAGE_BANDS.map(({ kv, color }) => {
          const key = String(kv);
          const on = bands[key] ?? true;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(key, !on)}
              className={
                'flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-1 ' +
                'font-mono text-[11px] tabular-nums transition-all ' +
                (on
                  ? 'border-slate-500 bg-white/10 text-slate-100'
                  : 'border-slate-700/60 bg-transparent text-slate-500 hover:border-slate-500 hover:text-slate-300')
              }
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: on ? color : '#475569' }}
              />
              {kv}
            </button>
          );
        })}
        <span className="text-[10px] text-slate-500">kV</span>
      </div>
    </div>
  );
}

/**
 * Legend for the Electricity Grid layer — built from the same constants the
 * map layers use (utils/powerGrid.ts), so it can never drift from the map.
 * The line-voltage colours live in the interactive VoltageChips above; this
 * covers the plants legend + the zoom-visibility notes.
 */
function PowerGridLegend() {
  return (
    <div className="mt-1 rounded-lg bg-white/5 px-3 py-2">
      <p className="pb-1 text-[11px] font-medium text-slate-300">Plants</p>
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
  icon,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  swatch: string;
  /** Optional glyph shown instead of the plain colour dot, tinted with `swatch`. */
  icon?: React.ReactNode;
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
      {icon ? (
        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center" style={{ color: swatch }}>
          {icon}
        </span>
      ) : (
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/10"
          style={{ backgroundColor: swatch }}
        />
      )}
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
