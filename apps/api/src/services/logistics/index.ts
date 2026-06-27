// Turbine-logistics orchestration (LOGISTICS_TOOL_PLAN.md §7 handlers).
//
// buildPlan(): resolve the OEM's component origins (auto-nearest or user
// override) → group by origin → route each leg (ORS HGV / estimate) → attach
// distances → compute the cost breakdown.
//
// quote(): a pure cost re-run over already-routed shipments. The web UI calls
// this on every assumptions edit so the cost math stays single-sourced on the
// server (no client-side duplication / drift).

import type {
  ComponentCategory,
  CostAssumptions,
  CostBreakdown,
  Facility,
  OEM,
  Shipment,
  TerrainType,
  TurbineModel,
} from "./types";
import {
  getFacility,
  resolveOrigin,
  type ResolvedOrigin,
} from "./facilities";
import { assembleSpecs, getTurbine, type ShipmentSpec } from "./turbines";
import { computeCost, DEFAULT_ASSUMPTIONS } from "./cost";
import {
  bindingRestrictions,
  routeLeg,
  type LineGeometry,
  type RouteResult,
  type RoutingMode,
} from "./routing";

export class LogisticsError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "LogisticsError";
  }
}

export interface Destination {
  lat: number;
  lon: number;
  name?: string;
}

export interface PlanRequest {
  oem: OEM;
  turbineModel: string;
  scope: "turbine" | "component";
  component?: ComponentCategory;
  destination: Destination;
  numTurbines: number;
  terrain: TerrainType;
  /** Per-component facility-id overrides (must belong to the same OEM). */
  origins?: Partial<Record<ComponentCategory, string>>;
  /** Cost-assumption overrides layered on top of DEFAULT_ASSUMPTIONS. */
  assumptions?: Partial<CostAssumptions>;
}

export interface PlanLeg {
  origin: Facility;
  distanceKm: number;
  durationHr: number;
  routingMode: RoutingMode;
  /** Road-line geometry [lon,lat][] for map plotting (straight line in estimate mode). */
  geometry: LineGeometry;
}

export interface PlanResponse {
  oem: OEM;
  turbine: TurbineModel;
  destination: Destination;
  numTurbines: number;
  terrain: TerrainType;
  legs: PlanLeg[];
  shipments: Shipment[];
  assumptions: CostAssumptions;
  breakdown: CostBreakdown;
}

// Immutable deep-ish merge of assumption overrides onto the defaults. Nested
// rate map / GST / crane tiers are merged explicitly; everything else is a
// shallow override. Returns a new object — never mutates the defaults.
export function mergeAssumptions(
  base: CostAssumptions,
  over?: Partial<CostAssumptions>,
): CostAssumptions {
  if (!over) return base;
  return {
    ...base,
    ...over,
    ratePerKm: { ...base.ratePerKm, ...(over.ratePerKm ?? {}) },
    gst: { ...base.gst, ...(over.gst ?? {}) },
    craneTiers: over.craneTiers ?? base.craneTiers,
  };
}

// Resolve where one component ships from: an explicit (same-OEM) override, or
// the OEM-scoped nearest producer. Throws on a bad/foreign override id.
function resolveSpecOrigin(
  oem: OEM,
  component: ComponentCategory,
  dest: Destination,
  overrideId: string | undefined,
): ResolvedOrigin {
  if (overrideId) {
    const facility = getFacility(overrideId);
    if (!facility) {
      throw new LogisticsError(`Unknown origin facility: ${overrideId}`, "UNKNOWN_ORIGIN");
    }
    if (facility.oem !== oem) {
      throw new LogisticsError(
        `Origin ${overrideId} belongs to ${facility.oem}, not ${oem}`,
        "ORIGIN_OEM_MISMATCH",
      );
    }
    // Explicit user choice — not an approximation.
    return { facility, sourcedLocally: false };
  }
  return resolveOrigin(oem, component, dest);
}

interface ResolvedSpec {
  spec: ShipmentSpec;
  origin: Facility;
  sourcedLocally: boolean;
}

export async function buildPlan(req: PlanRequest): Promise<PlanResponse> {
  const turbine = getTurbine(req.oem, req.turbineModel);
  if (!turbine) {
    throw new LogisticsError(
      `Unknown model "${req.turbineModel}" for OEM "${req.oem}"`,
      "UNKNOWN_MODEL",
    );
  }
  if (req.scope === "component" && !req.component) {
    throw new LogisticsError("scope=component requires a component", "MISSING_COMPONENT");
  }

  const component = req.scope === "component" ? req.component : undefined;
  const specs = assembleSpecs(turbine, component);

  // 1) Resolve each spec's origin (override or nearest producer).
  const resolved: ResolvedSpec[] = specs.map((spec) => {
    const { facility, sourcedLocally } = resolveSpecOrigin(
      req.oem,
      spec.component,
      req.destination,
      req.origins?.[spec.component],
    );
    return { spec, origin: facility, sourcedLocally };
  });

  // 2) Group by distinct origin → one route call per origin (≤ a few).
  const byOrigin = new Map<string, { origin: Facility; specs: ShipmentSpec[] }>();
  for (const r of resolved) {
    const entry = byOrigin.get(r.origin.id);
    if (entry) entry.specs.push(r.spec);
    else byOrigin.set(r.origin.id, { origin: r.origin, specs: [r.spec] });
  }

  // 3) Route every leg concurrently; degrade to estimate on any failure.
  const routeEntries = await Promise.all(
    [...byOrigin.values()].map(async ({ origin, specs: legSpecs }) => {
      const restrictions = bindingRestrictions(legSpecs);
      const route = await routeLeg(origin, req.destination, restrictions);
      return [origin.id, { origin, route }] as const;
    }),
  );
  const routeByOrigin = new Map<string, { origin: Facility; route: RouteResult }>(
    routeEntries,
  );

  // 4) Build full shipments (spec + origin + leg routing).
  const shipments: Shipment[] = resolved.map((r) => {
    const leg = routeByOrigin.get(r.origin.id)!;
    return {
      ...r.spec,
      origin: r.origin,
      towerSourcedLocally: r.sourcedLocally ? true : undefined,
      distanceKm: leg.route.distanceKm,
      durationHr: leg.route.durationHr,
      routingMode: leg.route.routingMode,
    };
  });

  const assumptions = mergeAssumptions(DEFAULT_ASSUMPTIONS, req.assumptions);
  const breakdown = computeCost(
    shipments,
    { ratedMW: turbine.ratedMW, numTurbines: req.numTurbines, terrain: req.terrain },
    assumptions,
  );

  const legs: PlanLeg[] = [...routeByOrigin.values()].map(({ origin, route }) => ({
    origin,
    distanceKm: route.distanceKm,
    durationHr: route.durationHr,
    routingMode: route.routingMode,
    geometry: route.geometry,
  }));

  return {
    oem: req.oem,
    turbine,
    destination: req.destination,
    numTurbines: req.numTurbines,
    terrain: req.terrain,
    legs,
    shipments,
    assumptions,
    breakdown,
  };
}

export interface QuoteRequest {
  shipments: Shipment[];
  ratedMW: number;
  numTurbines: number;
  terrain: TerrainType;
  assumptions: CostAssumptions;
}

// Pure cost re-run (no routing). Powers live assumption editing in the UI.
export function quote(req: QuoteRequest): CostBreakdown {
  const assumptions = mergeAssumptions(DEFAULT_ASSUMPTIONS, req.assumptions);
  return computeCost(
    req.shipments,
    { ratedMW: req.ratedMW, numTurbines: req.numTurbines, terrain: req.terrain },
    assumptions,
  );
}
