"use client";

import React, { useState } from "react";
import type { Cell, CompareResult, Confidence, MetaDimension } from "@/lib/policy";
import { CATEGORY_LABELS } from "@/lib/policy";

interface Props {
  result: CompareResult;
  jurName: Record<string, string>; // code -> display name
}

const CONFIDENCE_STYLE: Record<Confidence, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  extracted: { label: "Extracted", cls: "bg-orange/15 text-orange border-orange/30" },
  estimated: { label: "Estimated", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
};

// Background tint for a target cell from its server-computed diff (spec §6).
function cellTint(cell: Cell): string {
  if (cell.display === "—" && !cell.basis) return "text-muted/60"; // silent / absent → grey
  const k = cell.diff?.kind;
  if (k === "aligned") return "bg-emerald-500/10 text-emerald-200";
  if (k === "differs") return "bg-amber-500/10 text-amber-200";
  if (k === "state_silent" || k === "no_baseline") return "text-muted/70";
  return "text-text"; // numeric / text / neutral / base column
}

function deltaBadge(cell: Cell): string | null {
  const d = cell.diff;
  if (d?.kind !== "numeric" || d.delta == null || d.delta === 0) return null;
  const sign = d.delta > 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(d.delta)}`;
}

export default function PolicyMatrix({ result, jurName }: Props) {
  const { dimensions, jurisdictions, matrix, base } = result;
  const [open, setOpen] = useState<{ dim: string; code: string } | null>(null);

  // Group consecutive dimensions by category for section headers.
  const sections: { category: string; dims: MetaDimension[] }[] = [];
  for (const d of dimensions) {
    const last = sections[sections.length - 1];
    if (last && last.category === d.category) last.dims.push(d);
    else sections.push({ category: d.category, dims: [d] });
  }

  const colCount = jurisdictions.length + 1;

  return (
    <div className="relative overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="bg-panel">
            <th className="sticky left-0 z-20 bg-panel border-b border-border px-3 py-2.5 text-left font-medium text-muted min-w-[180px]">
              Policy dimension
            </th>
            {jurisdictions.map((code) => (
              <th
                key={code}
                className="border-b border-border px-3 py-2.5 text-left font-medium text-text whitespace-nowrap min-w-[150px]"
              >
                {jurName[code] ?? code}
                {base === code && (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-orange/80">baseline</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <React.Fragment key={section.category}>
              <tr>
                <td
                  colSpan={colCount}
                  className="sticky left-0 bg-bg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-orange/80 border-b border-border/60"
                >
                  {CATEGORY_LABELS[section.category] ?? section.category}
                </td>
              </tr>
              {section.dims.map((dim) => (
                <tr key={dim.key} className="hover:bg-panel/40">
                  <th
                    scope="row"
                    title={dim.description ?? undefined}
                    className="sticky left-0 z-10 bg-bg border-b border-border/60 px-3 py-2 text-left font-normal text-muted align-top min-w-[180px]"
                  >
                    {dim.label}
                    {dim.unit && <span className="ml-1 text-[10px] text-muted/60">({dim.unit})</span>}
                  </th>
                  {jurisdictions.map((code) => {
                    const cell = matrix[dim.key]?.[code];
                    if (!cell) {
                      return (
                        <td key={code} className="border-b border-border/60 px-3 py-2 text-muted/50">
                          —
                        </td>
                      );
                    }
                    const isOpen = open?.dim === dim.key && open?.code === code;
                    const hasDetail = Boolean(cell.raw || cell.source);
                    const delta = deltaBadge(cell);
                    return (
                      <td
                        key={code}
                        className={`relative border-b border-border/60 px-3 py-2 align-top ${cellTint(cell)}`}
                      >
                        <button
                          type="button"
                          disabled={!hasDetail}
                          onClick={() => setOpen(isOpen ? null : { dim: dim.key, code })}
                          className={`text-left ${hasDetail ? "cursor-pointer hover:underline decoration-dotted underline-offset-2" : "cursor-default"}`}
                        >
                          <span>{cell.display}</span>
                          {delta && <span className="ml-1 text-[11px] opacity-80">{delta}</span>}
                          {cell.basis === "rule" && (
                            <span className="ml-1 text-[10px] uppercase tracking-wide text-muted/60">rule</span>
                          )}
                        </button>
                        {isOpen && hasDetail && (
                          <CellPopover cell={cell} onClose={() => setOpen(null)} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellPopover({ cell, onClose }: { cell: Cell; onClose: () => void }) {
  return (
    <>
      {/* click-away backdrop */}
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-border bg-panel p-3 text-xs shadow-xl">
        {cell.confidence && (
          <span
            className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLE[cell.confidence].cls}`}
          >
            {CONFIDENCE_STYLE[cell.confidence].label}
          </span>
        )}
        {cell.raw && <p className="mt-2 italic text-muted leading-snug">“{cell.raw}”</p>}
        <div className="mt-2 space-y-0.5 text-muted/80">
          {cell.source &&
            (cell.source_url ? (
              <a
                href={cell.source_url}
                target="_blank"
                rel="noreferrer"
                className="block text-orange hover:underline break-words"
              >
                {cell.source}
              </a>
            ) : (
              <span className="block break-words">{cell.source}</span>
            ))}
          {cell.policy_year && <span className="block">Policy year: {cell.policy_year}</span>}
          {cell.diff?.note && <span className="block text-muted/60">Note: {cell.diff.note}</span>}
        </div>
      </div>
    </>
  );
}
