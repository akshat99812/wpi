"use client";

import React, { useEffect, useState } from "react";
import {
  fetchPolicyScores,
  scoreToColor,
  type PolicyScoreProps,
} from "@/components/Map/utils/policyScore";

// Plain-language summary of scoring.ts → RUBRIC. Surfaced via the "i" tooltip so
// the legend is auditable without opening the code.
const METHODOLOGY_LINES = [
  "A transparent, deterministic index — not legal advice.",
  "Each state's sourced policy cells are scored on a weighted rubric across four groups:",
  "• Open access & dispatch — third-party sale, captive use, must-run, GEOA threshold",
  "• Charges — wheeling/CSS concessions, additional surcharge, transmission loss",
  "• Banking — allowed, period, charge, third-party banking",
  "• Incentives & clearances — duty exemption, green cess, single-window, panchayat NOC",
  "Numeric inputs are min-max normalised across the compared states, so the score is relative (best → worst). States are scored only on dimensions they have data for. Grades: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F.",
];

// Ranked best→worst legend for the policy-score choropleth. Mirrors the
// MastLegend overlay positioning (absolute, top, shifts with the sidebar).
export function PolicyScoreLegend() {
  const [rows, setRows] = useState<PolicyScoreProps[] | null>(null);
  // Methodology popover is click-toggled (hover alone never opens on touch and
  // felt unresponsive — clicking the "i" now shows/hides it).
  const [showMethodology, setShowMethodology] = useState(false);

  useEffect(() => {
    let on = true;
    fetchPolicyScores()
      .then((fc) => {
        if (!on) return;
        setRows(fc.features.map((f) => f.properties).sort((a, b) => a.rank - b.rank));
      })
      .catch(() => on && setRows([]));
    return () => {
      on = false;
    };
  }, []);

  if (!rows || rows.length === 0) return null;
  const min = Math.min(...rows.map((r) => r.score));
  const max = Math.max(...rows.map((r) => r.score));

  return (
    // Outer wrapper is the positioning context and does NOT clip — the
    // methodology popover is a sibling of the scroll card so the card's
    // overflow-y-auto can never cut it off (that was the "not showing" bug).
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 w-max">
      {showMethodology && (
        <div className="pointer-events-auto absolute bottom-full left-0 z-20 mb-1.5 w-64 rounded-md border border-slate-700 bg-slate-900/95 p-2.5 text-[9.5px] leading-snug text-white/75 shadow-xl backdrop-blur">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wide text-white/45">
              How this score is built
            </span>
            <button
              type="button"
              aria-label="Close methodology"
              onClick={() => setShowMethodology(false)}
              className="-mr-0.5 -mt-0.5 px-1 text-[11px] leading-none text-white/40 hover:text-white/80"
            >
              ×
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {METHODOLOGY_LINES.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      )}

      <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-2.5 text-slate-200 shadow-lg backdrop-blur">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase tracking-wide text-white/45">
            Policy attractiveness 
          </span>
          <button
            type="button"
            aria-label="Scoring methodology"
            aria-expanded={showMethodology}
            onClick={() => setShowMethodology((v) => !v)}
            className={`pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[8px] font-bold italic leading-none transition-colors ${
              showMethodology
                ? "border-white/60 bg-white/10 text-white/90"
                : "border-white/25 text-white/55 hover:border-white/50 hover:text-white/90"
            }`}
          >
            i
          </button>
        </div>
        {rows.map((r) => (
          <div key={r.state_code} className="flex items-center gap-2 py-0.5">
            <span className="w-4 text-right text-[10px] font-mono text-white/40">{r.rank}</span>
            <span
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: scoreToColor(r.score, min, max) }}
            />
            <span className="flex-1 text-[11px] text-white/85">{r.name}</span>
            <span className="text-[10px] font-mono text-white/55">{r.score}</span>
            <span className="w-3 text-center text-[10px] font-bold text-white/70">{r.grade}</span>
          </div>
        ))}
        <div className="mt-1 border-t border-white/10 pt-1 text-[8.5px] leading-tight text-white/35">
          Composite of tariff/OA/banking/charges policy. Relative index, not legal advice.
        </div>
      </div>
    </div>
  );
}
