"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  formatDistanceKm,
  type MeasurePhase,
  type MeasurePoint,
} from "@/components/Map/utils/measureDistance";
import {
  CornerBrackets,
  StatusIndicator,
  type ToolStatus,
} from "./toolChrome";

/**
 * "Measure distance" section of the right Map-tools panel, styled to match
 * the Site-screening module above it: status rail, one arm-toggle button with
 * the corner-bracket armed state, a per-phase hint line, and the From / To /
 * Distance result rows. The state machine lives in useMeasureDistance.
 */

interface Props {
  phase: MeasurePhase;
  pointA: MeasurePoint | null;
  pointB: MeasurePoint | null;
  liveDistanceKm: number | null;
  distanceKm: number | null;
  /** Arm/disarm toggle (the page also disarms the AOI draw on arm). */
  onToggle: () => void;
  onClear: () => void;
}

/** Status-rail config per phase (a persisted line keeps COMPLETE when idle). */
function statusFor(phase: MeasurePhase, hasResult: boolean): ToolStatus {
  if (phase === "done")
    return { text: "COMPLETE", dot: "bg-emerald-400", textColor: "text-emerald-300", pulse: false };
  if (phase === "armed" || phase === "onePoint")
    return { text: "ARMED", dot: "bg-amber-400", textColor: "text-amber-300", pulse: true };
  if (hasResult)
    return { text: "COMPLETE", dot: "bg-emerald-400", textColor: "text-emerald-300", pulse: false };
  return { text: "READY", dot: "bg-slate-400", textColor: "text-slate-400", pulse: false };
}

export function MeasureTool({
  phase,
  pointA,
  pointB,
  liveDistanceKm,
  distanceKm,
  onToggle,
  onClear,
}: Props) {
  const armed = phase !== "idle";
  const hasResult = pointA != null && pointB != null && distanceKm != null;
  const status = statusFor(phase, hasResult);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      {/* ── Status rail ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.18em]">
        <span className="flex items-center gap-1.5 text-slate-500">
          <MeasureIcon className="h-3.5 w-3.5" />
          MEASURE DISTANCE
        </span>
        <StatusIndicator status={status} />
      </div>

      {/* ── Arm toggle ───────────────────────────────────────────────── */}
      <motion.button
        type="button"
        title="Measure a straight-line distance — clicks snap to masts, substations, lines and the AOI"
        aria-pressed={armed}
        onClick={onToggle}
        whileTap={{ scale: 0.96 }}
        className={
          "relative flex items-center justify-center gap-2 rounded-lg border px-2 py-2 text-xs font-medium transition-colors " +
          (armed
            ? "border-sky-400/60 bg-sky-500/15 text-sky-200 shadow-[0_0_14px_rgba(56,189,248,0.18)]"
            : "border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-white/5 hover:text-slate-100")
        }
      >
        {armed && <CornerBrackets />}
        <MeasureGlyph className="h-4 w-4" />
        Measure
      </motion.button>

      {(pointA != null || pointB != null) && (
        <button
          type="button"
          onClick={onClear}
          className="self-start rounded-md px-2 py-1 font-mono text-[11px] tracking-wide text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          ✕ Clear
        </button>
      )}

      {/* ── Per-phase hint / live readout / result ───────────────────── */}
      <AnimatePresence mode="popLayout" initial={false}>
        {phase === "armed" && (
          <HintBox key="armed">
            Click the first point — masts, substations, lines and the AOI
            snap. Esc exits.
          </HintBox>
        )}

        {phase === "onePoint" && (
          <HintBox key="onePoint">
            <span>Click the second point — Esc drops the first.</span>
            <div className="mt-1.5 font-mono text-[13px] tabular-nums text-slate-100">
              {pointA ? (
                <span className="text-slate-400">{pointA.label} → </span>
              ) : null}
              {liveDistanceKm != null ? formatDistanceKm(liveDistanceKm) : "—"}
            </div>
          </HintBox>
        )}

        {hasResult && pointA && pointB && distanceKm != null && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-lg border border-slate-700/70 bg-slate-800/50 px-3 py-2 text-xs"
          >
            <ResultRow label="From" value={pointA.label} />
            <ResultRow label="To" value={pointB.label} />
            <div className="mt-1.5 flex items-baseline justify-between border-t border-slate-700/70 pt-1.5">
              <span className="font-mono text-[10px] tracking-[0.14em] text-slate-500">
                DISTANCE
              </span>
              <span className="font-mono text-[15px] tabular-nums text-emerald-300">
                {formatDistanceKm(distanceKm)}
              </span>
            </div>
          </motion.div>
        )}

        {phase === "idle" && !hasResult && (
          <motion.p
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs leading-relaxed text-slate-400"
          >
            <span className="font-mono text-sky-400/80">&gt; </span>
            Point-to-point distance between masts, substations, grid lines or
            anywhere on the map.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// forwardRef: as a DIRECT child of AnimatePresence popLayout, framer-motion
// clones this element with a ref to measure + absolutely-position it while it
// exits — a plain function component would silently break that (and warn).
const HintBox = React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(
  function HintBox({ children }, ref) {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className="rounded-lg border border-slate-700/70 border-l-2 border-l-emerald-400/70 bg-slate-800/50 px-3 py-2 text-xs text-slate-300"
      >
        <span className="font-mono text-emerald-400/80">&gt; </span>
        {children}
      </motion.div>
    );
  },
);

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-slate-500">
        {label.toUpperCase()}
      </span>
      <span className="truncate text-right text-slate-200">{value}</span>
    </div>
  );
}

/** Two endpoints joined by a dashed segment — the arm-button glyph. */
function MeasureGlyph({ className }: { className?: string }) {
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
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="18.5" cy="5.5" r="2" />
      <path d="M7.5 16.5 16.5 7.5" strokeDasharray="2.4 2.4" />
    </svg>
  );
}

/** Marker-pin launcher icon for the panel section header. */
export function MeasureIcon({ className }: { className?: string }) {
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
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
