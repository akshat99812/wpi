"use client";

import React from "react";
import type { MetaJurisdiction } from "@/lib/policy";

export type CompareMode = "compare" | "diff";

interface Props {
  jurisdictions: MetaJurisdiction[];
  selected: string[]; // codes (includes the base in diff mode)
  mode: CompareMode;
  baseCode: string; // baseline in diff mode (e.g. 'national')
  onToggle: (code: string) => void;
  onModeChange: (mode: CompareMode) => void;
}

// Multi-select of jurisdictions + a Compare / Diff-vs-national toggle.
export default function JurisdictionPicker({
  jurisdictions,
  selected,
  mode,
  baseCode,
  onToggle,
  onModeChange,
}: Props) {
  const sel = new Set(selected);

  return (
    <div className="flex flex-col gap-3">
      {/* Mode toggle */}
      <div className="inline-flex w-fit rounded-lg border border-border bg-panel p-0.5 text-sm">
        {(["compare", "diff"] as CompareMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`rounded-md px-3 py-1.5 transition ${
              mode === m ? "bg-orange text-black font-medium" : "text-muted hover:text-text"
            }`}
          >
            {m === "compare" ? "Compare" : "Diff vs National"}
          </button>
        ))}
      </div>

      {/* Jurisdiction chips */}
      <div className="flex flex-wrap gap-2">
        {jurisdictions.map((j) => {
          const isBase = mode === "diff" && j.code === baseCode;
          const isSelected = sel.has(j.code) || isBase;
          return (
            <button
              key={j.code}
              type="button"
              disabled={isBase}
              onClick={() => onToggle(j.code)}
              title={isBase ? "Baseline (always shown in diff mode)" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                isSelected
                  ? "border-orange bg-orange/15 text-orange"
                  : "border-border bg-panel text-muted hover:text-text hover:border-muted"
              } ${isBase ? "cursor-default ring-1 ring-orange/40" : ""}`}
            >
              {j.name}
              {isBase && <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">baseline</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
