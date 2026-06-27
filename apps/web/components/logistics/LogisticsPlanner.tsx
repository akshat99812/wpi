"use client";

/**
 * Turbine Logistics Planner (Pro). For a turbine from one of six Indian OEMs
 * going to a site, it shows where each over-dimensional part ships from, the
 * road route + distance (OpenRouteService HGV, or an honest estimate), and a
 * fully itemised, editable INR cost — per turbine, per project, and per MW.
 *
 * All cost math lives on the server: editing an assumption re-POSTs /quote
 * (debounced) so the numbers can never drift from the backend formula.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "@/lib/auth-client";
import {
  fetchCatalog,
  postPlan,
  postQuote,
  formatINR,
  formatINRCompact,
  formatKm,
  type Catalog,
  type ComponentCategory,
  type CostAssumptions,
  type CostBreakdown,
  type Facility,
  type OEM,
  type PlanRequest,
  type PlanResponse,
  type PlanScope,
  type TerrainType,
  type TrailerType,
} from "@/lib/logistics";
import { publishLogisticsRoutes } from "@/lib/logisticsRouteStore";

const INPUT =
  "w-full rounded-md bg-[#0b1120] border border-[#27324a] px-2.5 py-1.5 text-sm text-text focus:border-orange focus:outline-none";
const LABEL = "text-xs font-medium text-muted";
const CARD =
  "rounded-xl border border-[#1f2c44] bg-gradient-to-b from-[#0f1424] to-[#0a0f1c] p-4";

const COMPONENTS: ComponentCategory[] = ["blade", "nacelle", "hub", "tower"];

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-muted">
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[#27324a] bg-[#0b1120] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "bg-orange text-black"
              : "text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ tone, children }: { tone: "warn" | "info" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "bg-orange/15 text-orange border-orange/30"
      : tone === "info"
        ? "bg-link/15 text-link border-link/30"
        : "bg-white/5 text-muted border-white/10";
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

// ── Assumption knobs (dotted paths for the two nested objects) ───────────
const KNOBS: { key: string; label: string }[] = [
  { key: "ratePerKm.standardMultiAxle", label: "₹/km — multi-axle" },
  { key: "ratePerKm.extendableBlade", label: "₹/km — blade trailer" },
  { key: "ratePerKm.hydraulicModular", label: "₹/km — hydraulic modular" },
  { key: "bladeAdapterPremiumPerKm", label: "Blade hilly premium ₹/km" },
  { key: "avgKmPerDay", label: "Avg km / day" },
  { key: "escortVehicles", label: "Escort vehicles / convoy" },
  { key: "escortPerDay", label: "Escort ₹ / day" },
  { key: "policePerDay", label: "Police ₹ / day (super-ODC)" },
  { key: "nhPermitPer50Km", label: "NH permit ₹ / 50 km" },
  { key: "statePermitEach", label: "State permit ₹ each" },
  { key: "statesCrossed", label: "States crossed" },
  { key: "loadsPerConvoy", label: "Loads per convoy" },
  { key: "craneDaysPerTurbine", label: "Crane days / turbine" },
  { key: "craneMobilization", label: "Crane mobilization ₹" },
  { key: "gst.transportPct", label: "GST transport %" },
  { key: "gst.cranePct", label: "GST crane %" },
  { key: "turbinePricePerMW", label: "Turbine ₹ / MW (0 = skip)" },
];

function getKnob(a: CostAssumptions, key: string): number {
  if (key.startsWith("ratePerKm.")) return a.ratePerKm[key.slice(10) as TrailerType];
  if (key.startsWith("gst.")) return a.gst[key.slice(4) as "transportPct" | "cranePct"];
  return (a as unknown as Record<string, number>)[key];
}

function setKnob(a: CostAssumptions, key: string, v: number): CostAssumptions {
  if (key.startsWith("ratePerKm.")) {
    return { ...a, ratePerKm: { ...a.ratePerKm, [key.slice(10)]: v } };
  }
  if (key.startsWith("gst.")) {
    return { ...a, gst: { ...a.gst, [key.slice(4)]: v } };
  }
  return { ...a, [key]: v };
}

const TRAILER_LABELS: Record<TrailerType, string> = {
  standardMultiAxle: "Multi-axle low-bed",
  extendableBlade: "Extendable blade trailer",
  hydraulicModular: "Hydraulic modular (SPMT)",
};

interface LogisticsPlannerProps {
  /** Pre-seeds the destination (used by the pro-map popup). Falls back to the
   *  /logistics?lat=&lon=&name= query params when absent. */
  initialDestination?: { lat: number; lon: number; name?: string };
  /** Hide the internal page header when shown inside a modal/embed. */
  embedded?: boolean;
  /** When embedded, lets the planner dismiss the modal (e.g. "view on map"). */
  onRequestClose?: () => void;
}

export default function LogisticsPlanner({
  initialDestination,
  embedded = false,
  onRequestClose,
}: LogisticsPlannerProps) {
  const { data: session, isPending } = useSession();
  const user = session?.user as { tier?: string | null } | undefined;
  const isPro = user?.tier === "PREMIUM";

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Form state
  const [oem, setOem] = useState<OEM>("suzlon");
  const [model, setModel] = useState<string>("");
  const [scope, setScope] = useState<PlanScope>("turbine");
  const [component, setComponent] = useState<ComponentCategory>("blade");
  const [presetIdx, setPresetIdx] = useState<number>(0);
  const [lat, setLat] = useState<string>("");
  const [lon, setLon] = useState<string>("");
  const [siteName, setSiteName] = useState<string>("");
  const [numTurbines, setNumTurbines] = useState<number>(20);
  const [terrain, setTerrain] = useState<TerrainType>("plains");
  const [origins, setOrigins] = useState<Partial<Record<ComponentCategory, string>>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Plan + cost state
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [assumptions, setAssumptions] = useState<CostAssumptions | null>(null);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [computing, setComputing] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPro) return;
    fetchCatalog()
      .then(setCatalog)
      .catch((e) => setCatalogError(String((e as Error).message ?? e)));
  }, [isPro]);

  const modelsForOem = useMemo(
    () => (catalog ? catalog.turbines.filter((t) => t.oem === oem) : []),
    [catalog, oem],
  );

  // Keep a valid model selected for the chosen OEM.
  useEffect(() => {
    if (modelsForOem.length && !modelsForOem.some((m) => m.model === model)) {
      setModel(modelsForOem[0].model);
    }
  }, [modelsForOem, model]);

  // Seed the destination from the first preset once the catalog arrives.
  useEffect(() => {
    if (catalog && catalog.presetSites.length && !lat && !lon) {
      const p = catalog.presetSites[0];
      setLat(String(p.lat));
      setLon(String(p.lon));
      setSiteName(p.name);
    }
  }, [catalog, lat, lon]);

  // Switching OEM invalidates origin overrides (facilities are OEM-scoped).
  useEffect(() => {
    setOrigins({});
  }, [oem]);

  // Seed the destination from an explicit prop (pro-map popup) or, on the
  // standalone /logistics page, from ?lat=&lon=&name= query params. Read once
  // on mount (window.location avoids the Suspense boundary useSearchParams
  // needs); runs before the catalog resolves, so the first-preset seed below
  // sees lat/lon already set and skips.
  useEffect(() => {
    let seedLat: string | undefined;
    let seedLon: string | undefined;
    let seedName: string | undefined;
    if (initialDestination) {
      seedLat = String(initialDestination.lat);
      seedLon = String(initialDestination.lon);
      seedName = initialDestination.name ?? "Selected site";
    } else {
      const sp = new URLSearchParams(window.location.search);
      const qLat = sp.get("lat");
      const qLon = sp.get("lon");
      if (qLat && qLon) {
        seedLat = qLat;
        seedLon = qLon;
        seedName = sp.get("name") ?? "Selected site";
      }
    }
    if (seedLat && seedLon && Number.isFinite(parseFloat(seedLat)) && Number.isFinite(parseFloat(seedLon))) {
      setLat(seedLat);
      setLon(seedLon);
      setSiteName(seedName ?? "Selected site");
      setPresetIdx(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const facilitiesForOem = useMemo(
    () => (catalog ? catalog.facilities.filter((f) => f.oem === oem) : []),
    [catalog, oem],
  );

  function onPreset(i: number) {
    setPresetIdx(i);
    if (i >= 0 && catalog) {
      const p = catalog.presetSites[i];
      setLat(String(p.lat));
      setLon(String(p.lon));
      setSiteName(p.name);
    }
  }

  const compute = useCallback(async () => {
    if (!catalog || !model) return;
    const latN = parseFloat(lat);
    const lonN = parseFloat(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
      setError("Enter a valid destination latitude and longitude.");
      return;
    }
    setComputing(true);
    setError(null);
    try {
      const req: PlanRequest = {
        oem,
        turbineModel: model,
        scope,
        component: scope === "component" ? component : undefined,
        destination: { lat: latN, lon: lonN, name: siteName || undefined },
        numTurbines,
        terrain,
        origins: Object.keys(origins).length ? origins : undefined,
      };
      const p = await postPlan(req);
      setPlan(p);
      setAssumptions(p.assumptions);
      setBreakdown(p.breakdown);
      // Hand the legs to the pro-map (if mounted) to plot the routes + power
      // the per-origin click card (company, parts shipped, distance).
      publishLogisticsRoutes({
        legs: p.legs,
        destination: p.destination,
        turbineLabel: `${p.turbine.model} · ${p.turbine.ratedMW} MW`,
        oemLabel: catalog?.oems.find((o) => o.id === p.oem)?.label ?? p.oem,
        shipments: p.shipments.map((s) => ({
          originId: s.origin.id,
          component: s.component,
          label: s.label,
          count: s.countPerTurbine,
        })),
      });
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setPlan(null);
      setBreakdown(null);
      publishLogisticsRoutes(null);
    } finally {
      setComputing(false);
    }
  }, [catalog, model, lat, lon, oem, scope, component, siteName, numTurbines, terrain, origins]);

  // Live re-quote: any change to assumptions / fleet size / terrain after a
  // plan exists re-runs the server cost math (debounced). Skips the no-op
  // right after compute() when nothing has actually changed.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!plan || !assumptions) return;
    const unchanged =
      assumptions === plan.assumptions &&
      numTurbines === plan.numTurbines &&
      terrain === plan.terrain;
    if (unchanged) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setQuoting(true);
      try {
        const { breakdown: b } = await postQuote({
          shipments: plan.shipments,
          ratedMW: plan.turbine.ratedMW,
          numTurbines,
          terrain,
          assumptions,
        });
        setBreakdown(b);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      } finally {
        setQuoting(false);
      }
    }, 250);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [assumptions, numTurbines, terrain, plan]);

  if (isPending) return <Centered>Loading…</Centered>;
  if (!isPro)
    return (
      <Centered>
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-text">Turbine Logistics Planner</h1>
          <p className="mt-2 text-sm">
            This is a Pro feature. Sign in with a Pro account to plan over-dimensional
            turbine transport and costs across India.
          </p>
        </div>
      </Centered>
    );

  return (
    <div
      className={
        embedded
          ? "px-3 py-3"
          : "flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"
      }
    >
      <div className={embedded ? "" : "mx-auto max-w-6xl"}>
        {!embedded && (
          <header className="mb-4">
            <h1 className="text-xl font-semibold text-text">Turbine Logistics Planner</h1>
            <p className="mt-1 text-sm text-muted">
              Where the big parts ship from, how they move, and what the road logistics
              cost — for any major Indian-market turbine.
            </p>
          </header>
        )}

        {catalogError && (
          <div className="mb-4 rounded-lg border border-orange/30 bg-orange/10 p-3 text-sm text-orange">
            Couldn’t load the planner catalog: {catalogError}
          </div>
        )}

        <div className={embedded ? "space-y-3" : "grid gap-5 lg:grid-cols-3"}>
          {/* ── Form ─────────────────────────────────────────────── */}
          <div className={embedded ? CARD : `${CARD} lg:col-span-1 h-fit`}>
            <FormPanel
              catalog={catalog}
              oem={oem}
              setOem={setOem}
              model={model}
              setModel={setModel}
              modelsForOem={modelsForOem}
              scope={scope}
              setScope={setScope}
              component={component}
              setComponent={setComponent}
              presetIdx={presetIdx}
              onPreset={onPreset}
              lat={lat}
              setLat={(v) => { setLat(v); setPresetIdx(-1); }}
              lon={lon}
              setLon={(v) => { setLon(v); setPresetIdx(-1); }}
              numTurbines={numTurbines}
              setNumTurbines={setNumTurbines}
              terrain={terrain}
              setTerrain={setTerrain}
              facilities={facilitiesForOem}
              origins={origins}
              setOrigins={setOrigins}
              showAdvanced={showAdvanced}
              setShowAdvanced={setShowAdvanced}
              computing={computing}
              onCompute={compute}
            />
          </div>

          {/* ── Results ──────────────────────────────────────────── */}
          <div className={embedded ? "space-y-3" : "lg:col-span-2 space-y-5"}>
            {error && (
              <div className="rounded-lg border border-orange/30 bg-orange/10 p-3 text-sm text-orange">
                {error}
              </div>
            )}

            {embedded && plan && onRequestClose && (
              <button
                type="button"
                onClick={onRequestClose}
                className="w-full rounded-lg border border-orange/40 bg-orange/10 px-3 py-2 text-xs font-medium text-orange transition-colors hover:border-orange/70 hover:bg-orange/20"
              >
                Routes plotted on the map ✓ — hide this panel
              </button>
            )}

            {!plan && !computing && (
              <div className={`${CARD} text-sm text-muted`}>
                Choose an OEM, model, and destination, then{" "}
                <span className="text-text">Compute plan</span> to see the shipment
                breakdown and costs.
              </div>
            )}

            {plan && breakdown && assumptions && (
              <Results
                plan={plan}
                breakdown={breakdown}
                assumptions={assumptions}
                setAssumptions={setAssumptions}
                quoting={quoting}
                numTurbines={numTurbines}
                compact={embedded}
              />
            )}
          </div>
        </div>

        <p className="mt-6 text-xs text-muted">
          Component weights and dimensions are engineering estimates; ₹ figures are
          indicative Indian ODC market ranges (2024–2026), not contract quotes. Every
          rate is an editable assumption. Siemens Gamesa’s onshore India business is now
          Vayona Energy.
        </p>
      </div>
    </div>
  );
}

// ── Form panel ────────────────────────────────────────────────────────────
interface FormPanelProps {
  catalog: Catalog | null;
  oem: OEM;
  setOem: (v: OEM) => void;
  model: string;
  setModel: (v: string) => void;
  modelsForOem: Catalog["turbines"];
  scope: PlanScope;
  setScope: (v: PlanScope) => void;
  component: ComponentCategory;
  setComponent: (v: ComponentCategory) => void;
  presetIdx: number;
  onPreset: (i: number) => void;
  lat: string;
  setLat: (v: string) => void;
  lon: string;
  setLon: (v: string) => void;
  numTurbines: number;
  setNumTurbines: (v: number) => void;
  terrain: TerrainType;
  setTerrain: (v: TerrainType) => void;
  facilities: Facility[];
  origins: Partial<Record<ComponentCategory, string>>;
  setOrigins: (v: Partial<Record<ComponentCategory, string>>) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  computing: boolean;
  onCompute: () => void;
}

function FormPanel(p: FormPanelProps) {
  const activeComponents = p.scope === "component" ? [p.component] : COMPONENTS;

  return (
    <div className="space-y-3.5">
      <div>
        <label className={LABEL} htmlFor="lp-oem">Manufacturer (OEM)</label>
        <select id="lp-oem" className={`${INPUT} mt-1`} value={p.oem} onChange={(e) => p.setOem(e.target.value as OEM)}>
          {p.catalog?.oems.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL} htmlFor="lp-model">Turbine model</label>
        <select id="lp-model" className={`${INPUT} mt-1`} value={p.model} onChange={(e) => p.setModel(e.target.value)}>
          {p.modelsForOem.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model} — {m.ratedMW} MW, {m.bladeLengthM} m blade
            </option>
          ))}
        </select>
      </div>

      <div>
        {/* Segmented is a button group — labelled via aria-labelledby, not htmlFor. */}
        <label className={LABEL} id="lp-scope-label">Scope</label>
        <div className="mt-1 flex flex-wrap items-center gap-2" role="group" aria-labelledby="lp-scope-label">
          <Segmented
            value={p.scope}
            onChange={p.setScope}
            options={[
              { value: "turbine", label: "Whole turbine" },
              { value: "component", label: "Single component" },
            ]}
          />
          {p.scope === "component" && (
            <select aria-label="Component" className={INPUT} value={p.component} onChange={(e) => p.setComponent(e.target.value as ComponentCategory)}>
              {COMPONENTS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="lp-dest">Destination site</label>
        <select
          id="lp-dest"
          className={`${INPUT} mt-1`}
          value={p.presetIdx}
          onChange={(e) => p.onPreset(Number(e.target.value))}
        >
          <option value={-1}>Custom (enter lat/lon)</option>
          {p.catalog?.presetSites.map((s, i) => (
            <option key={s.name} value={i}>{s.name} — {s.state}</option>
          ))}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input aria-label="Latitude" className={INPUT} inputMode="decimal" placeholder="lat" value={p.lat} onChange={(e) => p.setLat(e.target.value)} />
          <input aria-label="Longitude" className={INPUT} inputMode="decimal" placeholder="lon" value={p.lon} onChange={(e) => p.setLon(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL} htmlFor="lp-turbines">Turbines</label>
          <input
            id="lp-turbines"
            className={`${INPUT} mt-1 tabular-nums`}
            type="number"
            min={1}
            max={1000}
            value={p.numTurbines}
            onChange={(e) => p.setNumTurbines(Math.max(1, Math.min(1000, Math.floor(Number(e.target.value) || 1))))}
          />
        </div>
        <div>
          <label className={LABEL} id="lp-terrain-label">Terrain</label>
          <div className="mt-1" role="group" aria-labelledby="lp-terrain-label">
            <Segmented
              value={p.terrain}
              onChange={p.setTerrain}
              options={[
                { value: "plains", label: "Plains" },
                { value: "hilly", label: "Hilly" },
              ]}
            />
          </div>
        </div>
      </div>

      <div>
        <button
          type="button"
          className="text-xs text-link hover:underline"
          aria-expanded={p.showAdvanced}
          aria-controls="lp-advanced"
          onClick={() => p.setShowAdvanced(!p.showAdvanced)}
        >
          <span aria-hidden="true">{p.showAdvanced ? "▾" : "▸"}</span> Advanced — origin overrides
        </button>
        {p.showAdvanced && (
          <div id="lp-advanced" className="mt-2 space-y-2">
            {activeComponents.map((c) => (
              <div key={c}>
                <label className={`${LABEL} capitalize`} htmlFor={`lp-origin-${c}`}>{c} origin</label>
                <select
                  id={`lp-origin-${c}`}
                  className={`${INPUT} mt-1`}
                  value={p.origins[c] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const next = { ...p.origins };
                    if (v) next[c] = v;
                    else delete next[c];
                    p.setOrigins(next);
                  }}
                >
                  <option value="">Auto — nearest plant</option>
                  {p.facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.city}){f.legacy ? " — legacy" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={p.computing || !p.model}
        onClick={p.onCompute}
        className="w-full rounded-md bg-orange py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {p.computing ? "Computing…" : "Compute plan"}
      </button>
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────────
function Results({
  plan,
  breakdown,
  assumptions,
  setAssumptions,
  quoting,
  numTurbines,
  compact,
}: {
  plan: PlanResponse;
  breakdown: CostBreakdown;
  assumptions: CostAssumptions;
  setAssumptions: (a: CostAssumptions) => void;
  quoting: boolean;
  numTurbines: number;
  compact: boolean;
}) {
  const headline = [
    { label: "Grand total", value: formatINRCompact(breakdown.grandTotal) },
    { label: "Per turbine", value: formatINRCompact(breakdown.perTurbine) },
    { label: "Per MW", value: formatINRCompact(breakdown.perMW) },
    {
      label: "% of turbine",
      value: breakdown.pctOfTurbineCost == null ? "—" : `${breakdown.pctOfTurbineCost.toFixed(2)}%`,
    },
  ];

  return (
    <>
      {/* Headline figures */}
      <div className={CARD}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold leading-snug text-text">
            {plan.turbine.model} · {plan.turbine.ratedMW} MW · {numTurbines} turbine{numTurbines > 1 ? "s" : ""}
          </h2>
          {quoting && <span className="shrink-0 text-[11px] text-muted">updating…</span>}
        </div>
        <div className={`grid grid-cols-2 gap-3 ${compact ? "" : "sm:grid-cols-4"}`}>
          {headline.map((h) => (
            <div key={h.label}>
              <div className="text-[10px] uppercase tracking-wide text-muted">{h.label}</div>
              <div className="mt-0.5 text-base font-semibold tabular-nums text-orange">{h.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Routes */}
      <div className={CARD}>
        <h3 className="mb-2 text-sm font-semibold text-text">Routes</h3>
        <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
          {plan.legs.map((leg) => (
            <div key={leg.origin.id} className="rounded-lg border border-[#1a2540] bg-[#0b1120] px-2.5 py-2">
              <div className="text-xs font-medium leading-snug text-text">{leg.origin.name}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">
                {leg.origin.city}, {leg.origin.state} → {plan.destination.name ?? "site"}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums text-muted">
                <span className="text-text">{formatKm(leg.distanceKm)}</span>
                <span>·</span>
                <span>{leg.durationHr.toFixed(1)} h</span>
                <Chip tone={leg.routingMode === "ors" ? "info" : "muted"}>
                  {leg.routingMode === "ors" ? "routed" : "estimate"}
                </Chip>
              </div>
            </div>
          ))}
        </div>
        {plan.shipments.some((s) => s.towerSourcedLocally) && (
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Towers are sourced locally for this OEM — origin approximated by the nearest
            plant; override it in Advanced.
          </p>
        )}
      </div>

      {/* Transport plan — stacked cards (narrow-safe) */}
      <div className={CARD}>
        <h3 className="mb-2 text-sm font-semibold text-text">Transport plan</h3>
        <div className="space-y-1.5">
          {plan.shipments.map((s, i) => (
            <div
              key={`${s.component}-${i}`}
              className="rounded-lg border border-[#1a2540] bg-[#0b1120] px-2.5 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium leading-snug text-text">{s.label}</span>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {s.superOdc && <Chip tone="warn">super-ODC</Chip>}
                  {s.towerSourcedLocally && <Chip tone="muted">local</Chip>}
                </div>
              </div>
              <div className="mt-1 text-[11px] leading-snug tabular-nums text-muted">
                {s.countPerTurbine}× · {s.weightT} t · {s.lengthM}×{s.widthM}×{s.heightM} m ·{" "}
                {TRAILER_LABELS[s.trailerType]}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Financials — stacked per-shipment cards + summary lines */}
      <div className={CARD}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Financials</h3>
          <span className="text-[10px] uppercase tracking-wide text-muted">INR</span>
        </div>
        <div className="space-y-1.5">
          {breakdown.shipmentCosts.map((c, i) => (
            <div
              key={`${c.component}-${i}`}
              className="rounded-lg border border-[#1a2540] bg-[#0b1120] px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-text">{c.label}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-text">
                  {formatINR(c.subtotal)}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-snug tabular-nums text-muted">
                {c.totalLoads} load{c.totalLoads > 1 ? "s" : ""} · truck {formatINRCompact(c.trucking)} · escort{" "}
                {formatINRCompact(c.escort)}
                {c.police ? ` · police ${formatINRCompact(c.police)}` : ""} · permits{" "}
                {formatINRCompact(c.permits)}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1 border-t border-[#1a2540] pt-2 text-xs">
          {breakdown.lines.map((line) => (
            <div
              key={line.key}
              className={`flex items-center justify-between gap-2 ${
                line.key === "grand_total"
                  ? "mt-0.5 border-t border-[#1a2540] pt-1.5 text-sm font-semibold text-text"
                  : "text-muted"
              }`}
            >
              <span className="min-w-0">
                {line.label}
                {line.note && !compact && (
                  <span className="ml-1 text-[10px] text-muted/70">· {line.note}</span>
                )}
              </span>
              <span
                className={`shrink-0 tabular-nums ${
                  line.key === "grand_total" ? "text-orange" : "text-text"
                }`}
              >
                {formatINR(line.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Assumptions editor */}
      <details className={CARD}>
        <summary className="cursor-pointer text-sm font-semibold text-text">
          Cost assumptions — edit to re-quote
        </summary>
        <div className={`mt-3 grid grid-cols-2 gap-x-2 gap-y-2 ${compact ? "" : "sm:grid-cols-3"}`}>
          {KNOBS.map((k) => (
            <div key={k.key} className="min-w-0">
              <label className="block truncate text-[10px] font-medium text-muted" title={k.label}>
                {k.label}
              </label>
              <input
                className={`${INPUT} mt-1 tabular-nums`}
                type="number"
                value={getKnob(assumptions, k.key)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0) setAssumptions(setKnob(assumptions, k.key, v));
                }}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Crane tiers are fixed defaults; the selected tier ({breakdown.craneCapacityT} T)
          follows the heaviest load.
        </p>
      </details>
    </>
  );
}
