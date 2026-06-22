"use client";

/**
 * Wind Policy Comparison (Pro). Pivot table of Indian wind-energy policy across
 * jurisdictions, with per-cell source excerpts + confidence badges. Every value
 * is sourced to a real legal document (SERC order / state GR / national rule).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/auth-client";
import {
  fetchMeta,
  fetchCompare,
  type Meta,
  type CompareResult,
} from "@/lib/policy";
import JurisdictionPicker, { type CompareMode } from "@/components/policy/JurisdictionPicker";
import PolicyMatrix from "@/components/policy/PolicyMatrix";
import DimensionChoropleth from "@/components/policy/DimensionChoropleth";

const BASE_CODE = "national";
const DEFAULT_SELECTION = ["national", "TN", "GJ"];
const YEARS: { label: string; value: number | null }[] = [
  { label: "Latest", value: null },
  { label: "2025", value: 2025 },
  { label: "2024", value: 2024 },
  { label: "2023", value: 2023 },
];

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-muted">{children}</div>;
}

export default function PolicyPage() {
  const { data: session, isPending } = useSession();
  const user = session?.user as { email?: string; tier?: string | null } | undefined;
  const isPro = user?.tier === "PREMIUM";

  const [meta, setMeta] = useState<Meta | null>(null);
  const [mode, setMode] = useState<CompareMode>("compare");
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTION);
  const [year, setYear] = useState<number | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load meta once authorised.
  useEffect(() => {
    if (!isPro) return;
    fetchMeta().then(setMeta).catch((e) => setError(String(e.message ?? e)));
  }, [isPro]);

  // In diff mode the base is always part of the column set.
  const codes = useMemo(() => {
    if (mode === "diff") return Array.from(new Set([BASE_CODE, ...selected]));
    return selected;
  }, [mode, selected]);

  const reload = useCallback(async () => {
    if (!isPro || codes.length === 0) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchCompare(codes, year, mode === "diff" ? BASE_CODE : undefined);
      setResult(r);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [isPro, codes, year, mode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const jurName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const j of meta?.jurisdictions ?? []) m[j.code] = j.name;
    return m;
  }, [meta]);

  function toggle(code: string) {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  if (isPending) return <Centered>Loading…</Centered>;
  if (!isPro)
    return (
      <Centered>
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-text">Wind Policy Comparison</h1>
          <p className="mt-2 text-sm">
            This is a Pro feature. Sign in with a Pro account to compare wind-energy policy across Indian
            jurisdictions.
          </p>
        </div>
      </Centered>
    );

  return (
    <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4">
          <h1 className="text-xl font-semibold text-text">Wind Policy Comparison</h1>
          <p className="mt-1 text-sm text-muted">
            Indian wind-energy policy by jurisdiction. Every value links to its source order/policy; hover a
            cell for the excerpt and confidence.
          </p>
        </header>

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          {meta && (
            <JurisdictionPicker
              jurisdictions={meta.jurisdictions}
              selected={selected}
              mode={mode}
              baseCode={BASE_CODE}
              onToggle={toggle}
              onModeChange={setMode}
            />
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            Year
            <select
              value={year ?? "latest"}
              onChange={(e) => setYear(e.target.value === "latest" ? null : Number(e.target.value))}
              className="rounded-md border border-border bg-panel px-2 py-1.5 text-text"
            >
              {YEARS.map((y) => (
                <option key={y.label} value={y.value ?? "latest"}>
                  {y.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Legend />

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && !result && <div className="py-8 text-center text-muted">Loading comparison…</div>}

        {result && codes.length > 0 ? (
          <PolicyMatrix result={result} jurName={jurName} />
        ) : (
          !loading && <div className="py-8 text-center text-muted">Select at least one jurisdiction.</div>
        )}

        {meta && <DimensionChoropleth dimensions={meta.dimensions} year={year} />}
      </div>
    </main>
  );
}

function Legend() {
  const items = [
    { cls: "bg-emerald-500/20 border-emerald-500/40", label: "Aligned with baseline" },
    { cls: "bg-amber-500/20 border-amber-500/40", label: "Differs from baseline" },
    { cls: "bg-zinc-600/30 border-zinc-600/50", label: "State silent / no value" },
  ];
  const conf = [
    { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "Verified" },
    { cls: "bg-orange/15 text-orange border-orange/30", label: "Extracted" },
    { cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30", label: "Estimated" },
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      <span className="flex flex-wrap items-center gap-2">
        {items.map((i) => (
          <span key={i.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded border ${i.cls}`} />
            {i.label}
          </span>
        ))}
      </span>
      <span className="hidden text-border sm:inline">|</span>
      <span className="flex flex-wrap items-center gap-2">
        Confidence:
        {conf.map((c) => (
          <span key={c.label} className={`rounded border px-1.5 py-0.5 text-[10px] ${c.cls}`}>
            {c.label}
          </span>
        ))}
      </span>
    </div>
  );
}
