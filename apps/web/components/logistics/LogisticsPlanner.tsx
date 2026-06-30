"use client";

/**
 * Turbine Logistics Planner (Pro). For a turbine from one of six Indian OEMs
 * going to a site, it shows where each over-dimensional part ships from and the
 * road route + distance (OpenRouteService HGV, or an honest estimate).
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
  formatKm,
  type Catalog,
  type ComponentCategory,
  type Facility,
  type OEM,
  type PlanRequest,
  type PlanResponse,
  type PlanScope,
  type TerrainType,
  type TrailerType,
} from "@/lib/logistics";
import { publishLogisticsRoutes } from "@/lib/logisticsRouteStore";
import {
  readLogisticsSnapshot,
  patchLogisticsSnapshot,
} from "@/lib/logisticsPlannerStore";

const INPUT =
  "w-full rounded-md bg-[#0b1120] border border-[#27324a] px-2.5 py-1.5 text-sm text-text focus:border-orange focus:outline-none";
const LABEL = "text-xs font-medium text-muted";
const CARD =
  "rounded-xl border border-[#1f2c44] bg-gradient-to-b from-[#0f1424] to-[#0a0f1c] p-4";

const COMPONENTS: ComponentCategory[] = ["blade", "nacelle", "hub", "tower"];

// Turbine-count bounds. MAX matches the logistics API cap
// (apps/api/src/routes/logistics.ts) AND the layout parser cap
// (lib/analysis/layout.ts), so an uploaded layout's count is never silently
// clamped on the way into the planner.
const MIN_TURBINES = 1;
const MAX_TURBINES = 1000;
const DEFAULT_TURBINES = 20;

/** Clamp a turbine count into [MIN_TURBINES, MAX_TURBINES] (integer). */
function clampTurbines(n: number): number {
  return Math.max(MIN_TURBINES, Math.min(MAX_TURBINES, Math.floor(n)));
}

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

const TRAILER_LABELS: Record<TrailerType, string> = {
  standardMultiAxle: "Multi-axle low-bed",
  extendableBlade: "Extendable blade trailer",
  hydraulicModular: "Hydraulic modular (SPMT)",
};

interface LogisticsPlannerProps {
  /** Pre-seeds the destination (used by the pro-map popup). Falls back to the
   *  /logistics?lat=&lon=&name= query params when absent. */
  initialDestination?: { lat: number; lon: number; name?: string };
  /** Pre-seeds the turbine count — an uploaded layout's exact count, or 1 for a
   *  single clicked turbine. Falls back to the default (20) when absent. */
  initialNumTurbines?: number;
  /** Hide the internal page header when shown inside a modal/embed. */
  embedded?: boolean;
  /** When embedded, lets the planner dismiss the modal (e.g. "view on map"). */
  onRequestClose?: () => void;
  /** When set, the planner's form + computed plan are cached under this key so
   *  they survive the pro-map tab unmounting (see logisticsPlannerStore). */
  persistKey?: string;
}

export default function LogisticsPlanner({
  initialDestination,
  initialNumTurbines,
  embedded = false,
  onRequestClose,
  persistKey,
}: LogisticsPlannerProps) {
  const { data: session, isPending } = useSession();
  const user = session?.user as { tier?: string | null } | undefined;
  const isPro = user?.tier === "PREMIUM";

  // Restore cached panel state once (frozen at first mount) so a tab switch and
  // back doesn't wipe the form + computed plan. null when not persisting / fresh.
  const restoredRef = useRef(
    persistKey ? readLogisticsSnapshot(persistKey) : null,
  );
  const restored = restoredRef.current;
  const rForm = restored?.form;

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Form state
  const [oem, setOem] = useState<OEM>(() => (rForm?.oem as OEM) ?? "suzlon");
  const [model, setModel] = useState<string>(() => rForm?.model ?? "");
  const [scope, setScope] = useState<PlanScope>(
    () => (rForm?.scope as PlanScope) ?? "turbine",
  );
  const [component, setComponent] = useState<ComponentCategory>(
    () => (rForm?.component as ComponentCategory) ?? "blade",
  );
  const [lat, setLat] = useState<string>(() => rForm?.lat ?? "");
  const [lon, setLon] = useState<string>(() => rForm?.lon ?? "");
  const [siteName, setSiteName] = useState<string>(() => rForm?.siteName ?? "");
  const [numTurbines, setNumTurbines] = useState<number>(
    () => rForm?.numTurbines ?? DEFAULT_TURBINES,
  );
  const [terrain, setTerrain] = useState<TerrainType>(
    () => (rForm?.terrain as TerrainType) ?? "plains",
  );
  const [origins, setOrigins] = useState<
    Partial<Record<ComponentCategory, string>>
  >(() => rForm?.origins ?? {});
  const [showAdvanced, setShowAdvanced] = useState(
    () => rForm?.showAdvanced ?? false,
  );

  // Plan state
  const [plan, setPlan] = useState<PlanResponse | null>(
    () => restored?.plan ?? null,
  );
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(
    () => restored?.error ?? null,
  );

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

  // Switching OEM invalidates origin overrides (facilities are OEM-scoped).
  // Skip the first run so restoring a cached panel keeps its origin overrides.
  const oemMounted = useRef(false);
  useEffect(() => {
    if (!oemMounted.current) {
      oemMounted.current = true;
      return;
    }
    setOrigins({});
  }, [oem]);

  // The delivery site comes ONLY from the selected AOI — an explicit prop
  // (pro-map site-analysis popup) or, on the standalone /logistics page, the
  // ?lat=&lon=&name= query params. There is no preset / manual location entry.
  useEffect(() => {
    // A restored panel already carries the destination + count; don't re-seed
    // over the user's cached values.
    if (restored) return;
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
    }
    // Pre-fill the turbine count from an uploaded layout / single turbine.
    if (typeof initialNumTurbines === "number" && Number.isFinite(initialNumTurbines)) {
      setNumTurbines(clampTurbines(initialNumTurbines));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache the panel state on every change so it survives a tab unmount/remount.
  useEffect(() => {
    if (!persistKey) return;
    patchLogisticsSnapshot(persistKey, {
      form: {
        oem,
        model,
        scope,
        component,
        lat,
        lon,
        siteName,
        numTurbines,
        terrain,
        origins: origins as Record<string, string>,
        showAdvanced,
      },
      plan,
      error,
    });
  }, [
    persistKey,
    oem,
    model,
    scope,
    component,
    lat,
    lon,
    siteName,
    numTurbines,
    terrain,
    origins,
    showAdvanced,
    plan,
    error,
  ]);

  const facilitiesForOem = useMemo(
    () => (catalog ? catalog.facilities.filter((f) => f.oem === oem) : []),
    [catalog, oem],
  );

  // Destination is AOI-only — present iff seeded with valid coordinates.
  const hasDestination =
    Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lon));

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
      publishLogisticsRoutes(null);
    } finally {
      setComputing(false);
    }
  }, [catalog, model, lat, lon, oem, scope, component, siteName, numTurbines, terrain, origins]);

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
              lat={lat}
              lon={lon}
              siteName={siteName}
              hasDestination={hasDestination}
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
                <span className="text-text">Compute plan</span> to see the routes and
                shipment breakdown.
              </div>
            )}

            {plan && (
              <Results plan={plan} numTurbines={numTurbines} compact={embedded} />
            )}
          </div>
        </div>

        <p className="mt-6 text-xs text-muted">
          Component weights and dimensions are engineering estimates; routes use
          OpenRouteService HGV profiles where available, otherwise an honest road
          estimate. Siemens Gamesa’s onshore India business is now Vayona Energy.
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
  lat: string;
  lon: string;
  siteName: string;
  hasDestination: boolean;
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
        <label className={LABEL}>Delivery site</label>
        {p.hasDestination ? (
          <div className="mt-1 rounded-md border border-[#27324a] bg-[#0b1120] px-2.5 py-2 text-xs">
            <div className="font-medium text-text">{p.siteName || "Selected site"}</div>
            <div className="mt-0.5 tabular-nums text-muted">{p.lat}, {p.lon}</div>
          </div>
        ) : (
          <div className="mt-1 rounded-md border border-dashed border-[#27324a] bg-[#0b1120] px-2.5 py-2 text-[11px] leading-snug text-muted">
            Draw a point, rectangle, or polygon on the map, then open the planner from
            the site-analysis results.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL} htmlFor="lp-turbines">Turbines</label>
          <input
            id="lp-turbines"
            className={`${INPUT} mt-1 tabular-nums`}
            type="number"
            min={MIN_TURBINES}
            max={MAX_TURBINES}
            value={p.numTurbines}
            onChange={(e) => p.setNumTurbines(clampTurbines(Number(e.target.value) || MIN_TURBINES))}
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
        disabled={p.computing || !p.model || !p.hasDestination}
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
  numTurbines,
  compact,
}: {
  plan: PlanResponse;
  numTurbines: number;
  compact: boolean;
}) {
  return (
    <>
      {/* Headline */}
      <div className={CARD}>
        <h2 className="text-sm font-semibold leading-snug text-text">
          {plan.turbine.model} · {plan.turbine.ratedMW} MW · {numTurbines} turbine{numTurbines > 1 ? "s" : ""}
        </h2>
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
    </>
  );
}
