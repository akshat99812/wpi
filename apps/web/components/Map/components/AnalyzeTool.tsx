"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AoiDrawMode } from "@/components/Map/utils/aoiDraw";
import type {
  AnalysisUiState,
  PointUiState,
} from "@/components/Map/hooks/useAoiAnalysis";
import type { AnalysisResponse, PointReport } from "@/lib/analysis/types";
import type { TurbineLayout, TurbinePoint } from "@/lib/analysis/layout";
import { AOI_MAX_KM2 } from "@/lib/analysis/geometry";
import { AnalysisResults } from "./AnalysisResults";
import { TurbinePointCard } from "./TurbinePointCard";
import {
  CornerBrackets,
  StatusIndicator,
  type ToolStatus,
} from "./toolChrome";

/**
 * "Analyze" tool card content, styled as an information-terminal module:
 * a status rail (READY / ARMED / SCANNING / COMPLETE / PARTIAL / FAULT),
 * selection-mode buttons (Point / Rectangle / Polygon) with corner-bracket
 * active states, the live km² readout with the 2,500 km² hard-stop message,
 * and the analysis state machine
 * (idle → drawing → loading → partial | ok | error).
 *
 * Behavioral contract (e2e + parent depend on it): the three mode buttons
 * keep the accessible names "Point" / "Rectangle" / "Polygon", the clear
 * button keeps "Clear selection", and the Props shape is unchanged.
 *
 * `section` splits the card across the two sidebars: 'controls' renders the
 * status rail + draw buttons (right-hand tools bar), 'results' renders the
 * loading / error / results data states (left-hand data bar). Omitting it
 * renders everything, preserving the original single-card behavior.
 */

interface Props {
  uiState: AnalysisUiState;
  armedMode: AoiDrawMode | null;
  liveAreaKm2: number | null;
  liveOverCap: boolean;
  committedAreaKm2: number | null;
  analysis: AnalysisResponse | null;
  /** Committed AOI ring, forwarded to the results panel's PDF export. */
  committedRing?: [number, number][] | null;
  error: string | null;
  onArm: (mode: AoiDrawMode) => void;
  onClear: () => void;
  /** Hand a user-selected .kml/.kmz site-boundary file to the analysis flow. */
  onUploadFile?: (file: File) => void;
  /** Hand a user-selected .kml/.kmz micro-sited turbine-layout file. */
  onUploadLayout?: (file: File) => void;
  /** Active uploaded turbine layout (drives the layout summary + logistics). */
  layout?: TurbineLayout | null;
  /** Turbine currently screened individually (drives the per-turbine card). */
  selectedTurbine?: TurbinePoint | null;
  /** Exact-point report for the selected turbine + its lifecycle. */
  pointReport?: PointReport | null;
  pointUiState?: PointUiState;
  pointError?: string | null;
  /** Return from a single-turbine view to the site footprint result. */
  onClearTurbine?: () => void;
  section?: 'controls' | 'results';
}

const MODES: { id: AoiDrawMode; label: string; hint: string }[] = [
  { id: "point", label: "Point", hint: "Click the map — analyzes a 5×5 km square" },
  { id: "rectangle", label: "Rectangle", hint: "Click a corner, move the mouse, then click the opposite corner" },
  { id: "polygon", label: "Polygon", hint: "Click vertices; click the first point or press Enter to finish, Esc to cancel" },
];

/** Status-rail config for the per-turbine point report (results panel). */
function statusForPoint(pointUiState: PointUiState): ToolStatus {
  if (pointUiState === "loading")
    return { text: "SCANNING", dot: "bg-sky-400", textColor: "text-sky-300", pulse: true };
  if (pointUiState === "error")
    return { text: "FAULT", dot: "bg-red-400", textColor: "text-red-300", pulse: false };
  if (pointUiState === "ok")
    return { text: "COMPLETE", dot: "bg-emerald-400", textColor: "text-emerald-300", pulse: false };
  return { text: "READY", dot: "bg-slate-400", textColor: "text-slate-400", pulse: false };
}

/** Status-rail config per ui/armed state. */
function statusFor(
  uiState: AnalysisUiState,
  armedMode: AoiDrawMode | null,
): ToolStatus {
  if (uiState === "loading")
    return { text: "SCANNING", dot: "bg-sky-400", textColor: "text-sky-300", pulse: true };
  if (uiState === "error")
    return { text: "FAULT", dot: "bg-red-400", textColor: "text-red-300", pulse: false };
  if (uiState === "partial")
    return { text: "PARTIAL", dot: "bg-amber-400", textColor: "text-amber-300", pulse: false };
  if (uiState === "ok")
    return { text: "COMPLETE", dot: "bg-emerald-400", textColor: "text-emerald-300", pulse: false };
  if (armedMode)
    return {
      text: `ARMED · ${armedMode.toUpperCase()}`,
      dot: "bg-amber-400",
      textColor: "text-amber-300",
      pulse: true,
    };
  return { text: "READY", dot: "bg-slate-400", textColor: "text-slate-400", pulse: false };
}

export function AnalyzeTool({
  uiState,
  armedMode,
  liveAreaKm2,
  liveOverCap,
  committedAreaKm2,
  analysis,
  error,
  onArm,
  onClear,
  onUploadFile,
  onUploadLayout,
  layout,
  selectedTurbine,
  pointReport,
  pointUiState = "idle",
  pointError = null,
  onClearTurbine,
  section,
  committedRing,
}: Props) {
  const hasAnything = uiState !== "idle";
  // In the results panel, a selected turbine's card owns the view — reflect its
  // point-report state in the rail rather than the (often "COMPLETE") footprint.
  const status =
    section === "results" && selectedTurbine
      ? statusForPoint(pointUiState)
      : statusFor(uiState, armedMode);
  const showControls = section !== "results";
  const showResults = section !== "controls";
  const boundaryInputRef = React.useRef<HTMLInputElement>(null);
  const layoutInputRef = React.useRef<HTMLInputElement>(null);

  const onBoundaryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so re-selecting the same file fires change again.
    e.target.value = "";
    if (file) onUploadFile?.(file);
  };
  const onLayoutFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onUploadLayout?.(file);
  };

  // Per-turbine banner label.
  const turbineLabel = selectedTurbine?.name || "Turbine";
  // Footprint logistics pre-fill (single-turbine logistics lives in the card).
  const logisticsTurbineCount = layout ? layout.points.length : undefined;
  const logisticsSiteName = layout ? "Uploaded layout" : undefined;
  const logisticsContextKey = layout ? "footprint" : "aoi";

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      {/* ── Status rail ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.18em]">
        <span className="text-slate-500">
          {section === "results" ? "SCREENING RESULTS" : "SITE SCREENING"}
        </span>
        <StatusIndicator status={status} />
      </div>

      {/* ── Layout context banner (results panel) ────────────────────── */}
      {showResults && selectedTurbine && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-orange-400/40 bg-orange-500/10 px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11px] text-orange-200">
            <span className="font-semibold">{turbineLabel}</span> · exact-point analysis
          </span>
          {onClearTurbine && (
            <button
              type="button"
              onClick={onClearTurbine}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-orange-200 transition-colors hover:bg-orange-500/20"
            >
              <span aria-hidden="true">←</span> Back to site
            </button>
          )}
        </div>
      )}
      {showResults && !selectedTurbine && layout && (
        <p className="rounded-lg border border-teal-400/30 bg-teal-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-teal-200">
          Site footprint · {layout.points.length.toLocaleString()} turbines. Click a
          turbine on the map for its individual analysis.
        </p>
      )}

      {/* ── Mode buttons ─────────────────────────────────────────────── */}
      {showControls && (
        <div className="grid grid-cols-3 gap-1.5">
          {MODES.map((m) => {
            const active = armedMode === m.id;
            return (
              <motion.button
                key={m.id}
                type="button"
                title={m.hint}
                onClick={() => onArm(m.id)}
                whileTap={{ scale: 0.96 }}
                className={
                  "relative flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors " +
                  (active
                    ? "border-sky-400/60 bg-sky-500/15 text-sky-200 shadow-[0_0_14px_rgba(56,189,248,0.18)]"
                    : "border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-white/5 hover:text-slate-100")
                }
              >
                {active && <CornerBrackets />}
                <ModeGlyph mode={m.id} className="h-4 w-4" />
                {m.label}
              </motion.button>
            );
          })}
        </div>
      )}

      {/* ── Upload KML / KMZ (boundary or micro-sited turbine layout) ──── */}
      {showControls && (onUploadFile || onUploadLayout) && (
        <div className="flex flex-col gap-1.5">
          <input
            ref={boundaryInputRef}
            type="file"
            accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            onChange={onBoundaryFileChange}
            className="hidden"
            aria-hidden
          />
          <input
            ref={layoutInputRef}
            type="file"
            accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            onChange={onLayoutFileChange}
            className="hidden"
            aria-hidden
          />
          <div className="grid grid-cols-2 gap-1.5">
            {onUploadFile && (
              <motion.button
                type="button"
                title="Upload a .kml or .kmz site boundary polygon and screen it"
                onClick={() => boundaryInputRef.current?.click()}
                whileTap={{ scale: 0.97 }}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-2 py-2 text-[11px] font-medium text-slate-300 transition-colors hover:border-sky-400/60 hover:bg-sky-500/10 hover:text-sky-200"
              >
                <UploadGlyph className="h-4 w-4 shrink-0" />
                Upload site boundary
              </motion.button>
            )}
            {onUploadLayout && (
              <motion.button
                type="button"
                title="Upload a .kml or .kmz of exact turbine points (micro-sited layout)"
                onClick={() => layoutInputRef.current?.click()}
                whileTap={{ scale: 0.97 }}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-2 py-2 text-[11px] font-medium text-slate-300 transition-colors hover:border-teal-400/60 hover:bg-teal-500/10 hover:text-teal-200"
              >
                <TurbinesGlyph className="h-4 w-4 shrink-0" />
                Upload turbine layout
              </motion.button>
            )}
          </div>
          {layout && (
            <p className="rounded-md border border-teal-400/30 bg-teal-500/10 px-2 py-1.5 text-[11px] leading-snug text-teal-200">
              {layout.points.length.toLocaleString()} turbine
              {layout.points.length === 1 ? "" : "s"} loaded ·{" "}
              {layout.areaKm2.toFixed(1)} km² footprint.
              <span className="text-teal-300/80">
                {" "}Click a turbine on the map for its individual analysis.
              </span>
            </p>
          )}
        </div>
      )}

      {showControls && hasAnything && (
        <button
          type="button"
          onClick={onClear}
          className="self-start rounded-md px-2 py-1 font-mono text-[11px] tracking-wide text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          ✕ Clear selection
        </button>
      )}

      {/* ── State machine ────────────────────────────────────────────── */}
      <AnimatePresence mode="popLayout" initial={false}>
        {showControls && armedMode && (
          <motion.div
            key={`armed-${armedMode}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="rounded-lg border border-slate-700/70 border-l-2 border-l-sky-400/70 bg-slate-800/50 px-3 py-2 text-xs text-slate-300"
          >
            <span className="font-mono text-sky-400/80">&gt; </span>
            {armedMode === "point" ? (
              <span>Hover shows the 5×5 km square — click to analyze. Esc cancels.</span>
            ) : (
              <>
                <span>{MODES.find((m) => m.id === armedMode)?.hint}</span>
                <div className="mt-1.5 font-mono text-[13px] tabular-nums text-slate-100">
                  {liveAreaKm2 != null ? `${liveAreaKm2.toFixed(1)} km²` : "— km²"}
                  <span className="ml-1 text-slate-500">
                    / {AOI_MAX_KM2.toLocaleString()} km² max
                  </span>
                  <Caret />
                </div>
                <AreaCapBar liveAreaKm2={liveAreaKm2} overCap={liveOverCap} />
                {liveOverCap && (
                  <p className="mt-1 font-medium text-red-400">
                    Too large — shrink the shape below {AOI_MAX_KM2.toLocaleString()} km² to
                    finish (or zoom in).
                  </p>
                )}
              </>
            )}
          </motion.div>
        )}

        {showControls && uiState === "idle" && !armedMode && (
          <motion.p
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs leading-relaxed text-slate-400"
          >
            <span className="font-mono text-sky-400/80">&gt; </span>
            Screen a site: drop a point or draw an area to get an indicative wind-resource
            analysis — capacity factor, screening score, nearby masts and grid.
            <Caret />
          </motion.p>
        )}

        {section === "results" && !selectedTurbine && uiState === "idle" && (
          <motion.p
            key="results-idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs leading-relaxed text-slate-400"
          >
            <span className="font-mono text-sky-400/80">&gt; </span>
            No screening yet — pick Point / Rectangle / Polygon in the tools panel on
            the right and the analysis will land here.
            <Caret />
          </motion.p>
        )}

        {showResults && selectedTurbine && (
          <motion.div
            key="turbine-point"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <TurbinePointCard
              turbine={selectedTurbine}
              report={pointReport ?? null}
              uiState={pointUiState}
              error={pointError ?? null}
            />
          </motion.div>
        )}

        {showResults && !selectedTurbine && uiState === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-800/50"
          >
            <ScanBar />
            <div className="px-3 py-2.5">
              <p className="font-mono text-[12px] tabular-nums text-sky-200">
                ANALYZING{" "}
                {committedAreaKm2 != null ? `${committedAreaKm2.toFixed(1)} KM²` : "SITE"}
                <Ellipsis />
              </p>
              <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-slate-500">
                WIND RESOURCE · TERRAIN · GRID · CONTEXT
              </p>
            </div>
          </motion.div>
        )}

        {showResults && !selectedTurbine && uiState === "error" && error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: [0, -4, 4, -2, 0] }}
            exit={{ opacity: 0 }}
            transition={{ x: { duration: 0.3 } }}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            <span className="mr-1.5 font-mono text-[10px] tracking-[0.18em] text-red-400">
              ▲ FAULT
            </span>
            {error}
          </motion.div>
        )}

        {showResults && !selectedTurbine && (uiState === "ok" || uiState === "partial") && analysis && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <AnalysisResults
              analysis={analysis}
              committedRing={committedRing}
              logisticsTurbineCount={logisticsTurbineCount}
              logisticsSiteName={logisticsSiteName}
              logisticsContextKey={logisticsContextKey}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Blinking block caret, terminal-style. */
function Caret() {
  return (
    <motion.span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] bg-sky-400/80"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
    />
  );
}

/** Animated "..." that cycles without reflowing the line. */
function Ellipsis() {
  return (
    <span aria-hidden className="inline-flex w-[1.4em]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.15, 1, 0.15] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        >
          .
        </motion.span>
      ))}
    </span>
  );
}

/** Indeterminate sweep across the top of the loading block. */
function ScanBar() {
  return (
    <div className="relative h-[2px] w-full overflow-hidden bg-sky-500/10">
      <motion.div
        aria-hidden
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-sky-400 to-transparent"
        animate={{ x: ["-100%", "300%"] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/** Live area vs cap, as a thin terminal meter. Red past the hard stop. */
function AreaCapBar({
  liveAreaKm2,
  overCap,
}: {
  liveAreaKm2: number | null;
  overCap: boolean;
}) {
  const frac = Math.min(1, (liveAreaKm2 ?? 0) / AOI_MAX_KM2);
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
      <motion.div
        className={`h-full rounded-full ${overCap ? "bg-red-500" : "bg-sky-400/80"}`}
        animate={{ width: `${frac * 100}%` }}
        transition={{ duration: 0.15, ease: "linear" }}
      />
    </div>
  );
}

/** Per-mode mini glyphs for the selection buttons. */
function ModeGlyph({ mode, className }: { mode: AoiDrawMode; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  if (mode === "point") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <path d="M12 4v3.5M12 16.5V20M4 12h3.5M16.5 12H20" />
      </svg>
    );
  }
  if (mode === "rectangle") {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="12" rx="1" strokeDasharray="3 2.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3.5 20 9l-3 10H7L4 9z" strokeDasharray="3 2.2" />
    </svg>
  );
}

/** Upload / tray-arrow glyph for the KML/KMZ button. */
function UploadGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Scattered-dots glyph for the "Upload turbine layout" button. */
function TurbinesGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="6" cy="7" r="1.7" />
      <circle cx="13" cy="5" r="1.7" />
      <circle cx="18" cy="9" r="1.7" />
      <circle cx="8" cy="14" r="1.7" />
      <circle cx="15" cy="16" r="1.7" />
      <circle cx="5" cy="19" r="1.7" />
      <circle cx="19" cy="18" r="1.7" />
    </svg>
  );
}

/** Crosshair-in-square launcher icon, matching the MastIcon convention. */
export function AnalyzeIcon({ className }: { className?: string }) {
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
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2.4" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 5.5v3M12 15.5v3M5.5 12h3M15.5 12h3" />
    </svg>
  );
}
