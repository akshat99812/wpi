// ODC logistics cost model (LOGISTICS_TOOL_PLAN.md §4.4–4.5 defaults, §6
// formulas). OEM-agnostic and pure: given pre-routed shipments + assumptions it
// returns a fully itemised INR breakdown. Indian ODC is a negotiated,
// project-specific market — every figure here is an order-of-magnitude default
// the UI lets the user edit, then re-quotes against this same function.
//
// The §10.1 deterministic test pins this function: Suzlon S144 / 1 turbine /
// plains with the fixed distances there must yield grandTotal === 4_175_900.
// Any drift is a bug.

import type {
  CostAssumptions,
  CostBreakdown,
  CostLine,
  CraneTier,
  Shipment,
  ShipmentCost,
  TerrainType,
  TrailerType,
} from "./types";

export const TRAILER_LABELS: Record<TrailerType, string> = {
  standardMultiAxle: "Multi-axle low-bed",
  extendableBlade: "Extendable blade trailer",
  hydraulicModular: "Hydraulic modular (SPMT)",
};

// §4.4 + §4.5. INR throughout. Crane tiers sorted ascending by maxLoadT.
export const DEFAULT_ASSUMPTIONS: CostAssumptions = {
  ratePerKm: {
    standardMultiAxle: 70,
    extendableBlade: 115,
    hydraulicModular: 185,
  },
  bladeAdapterPremiumPerKm: 45,
  avgKmPerDay: 150,
  escortVehicles: 2,
  escortPerDay: 3_000,
  policePerDay: 5_000,
  nhPermitPer50Km: 1_000,
  statePermitEach: 15_000,
  statesCrossed: 2,
  loadsPerConvoy: 1,
  craneTiers: [
    { maxLoadT: 40, capacityT: 100, dayRate: 30_000 },
    { maxLoadT: 80, capacityT: 250, dayRate: 90_000 },
    { maxLoadT: 120, capacityT: 400, dayRate: 300_000 },
    { maxLoadT: 1e12, capacityT: 750, dayRate: 600_000 },
  ],
  craneDaysPerTurbine: 3,
  craneMobilization: 2_000_000,
  gst: { transportPct: 5, cranePct: 18 },
  turbinePricePerMW: 60_000_000,
};

export interface CostContext {
  ratedMW: number;
  numTurbines: number;
  terrain: TerrainType;
}

// First tier whose maxLoadT covers the heaviest load; falls back to the
// largest tier if nothing covers it (tiers assumed ascending).
export function selectCraneTier(heaviestT: number, tiers: CraneTier[]): CraneTier {
  return tiers.find((t) => heaviestT <= t.maxLoadT) ?? tiers[tiers.length - 1]!;
}

function ratePerKmFor(
  s: Shipment,
  terrain: TerrainType,
  A: CostAssumptions,
): number {
  const base = A.ratePerKm[s.trailerType];
  const hillyBladePremium =
    s.component === "blade" && terrain === "hilly"
      ? A.bladeAdapterPremiumPerKm
      : 0;
  return base + hillyBladePremium;
}

function costForShipment(
  s: Shipment,
  ctx: CostContext,
  A: CostAssumptions,
): ShipmentCost {
  const totalLoads = s.countPerTurbine * ctx.numTurbines;
  const ratePerKm = ratePerKmFor(s, ctx.terrain, A);
  const trucking = totalLoads * s.distanceKm * ratePerKm;

  const convoys = Math.ceil(totalLoads / A.loadsPerConvoy);
  const transitDays = Math.max(1, Math.ceil(s.distanceKm / A.avgKmPerDay));

  const escort = convoys * A.escortVehicles * A.escortPerDay * transitDays;
  const police = s.superOdc ? convoys * A.policePerDay * transitDays : 0;

  // Permits are per-vehicle: every load pays the NH-permit-per-50 km plus a
  // flat per-state permit for each state crossed.
  const permits =
    totalLoads *
    (Math.ceil(s.distanceKm / 50) * A.nhPermitPer50Km +
      A.statesCrossed * A.statePermitEach);

  const subtotal = trucking + escort + police + permits;

  return {
    component: s.component,
    label: s.label,
    trailerLabel: TRAILER_LABELS[s.trailerType],
    totalLoads,
    trucking,
    escort,
    police,
    permits,
    subtotal,
  };
}

export function computeCost(
  shipments: Shipment[],
  ctx: CostContext,
  A: CostAssumptions,
): CostBreakdown {
  const shipmentCosts = shipments.map((s) => costForShipment(s, ctx, A));
  const transportSubtotal = shipmentCosts.reduce((sum, c) => sum + c.subtotal, 0);

  const heaviestT = shipments.length
    ? Math.max(...shipments.map((s) => s.weightT))
    : 0;
  const craneTier = selectCraneTier(heaviestT, A.craneTiers);
  const craneCost =
    craneTier.dayRate * A.craneDaysPerTurbine * ctx.numTurbines +
    A.craneMobilization;

  const transportGst = (transportSubtotal * A.gst.transportPct) / 100;
  const craneGst = (craneCost * A.gst.cranePct) / 100;
  const grandTotal = transportSubtotal + transportGst + craneCost + craneGst;

  const perTurbine = ctx.numTurbines > 0 ? grandTotal / ctx.numTurbines : 0;
  const perMW =
    ctx.numTurbines > 0 && ctx.ratedMW > 0
      ? grandTotal / (ctx.numTurbines * ctx.ratedMW)
      : 0;
  const pctOfTurbineCost =
    A.turbinePricePerMW > 0 && ctx.ratedMW > 0 && ctx.numTurbines > 0
      ? (grandTotal / (A.turbinePricePerMW * ctx.ratedMW * ctx.numTurbines)) *
        100
      : null;

  const lines: CostLine[] = [
    { key: "transport", label: "Transport subtotal", amount: transportSubtotal },
    {
      key: "transport_gst",
      label: `Transport GST (${A.gst.transportPct}%)`,
      amount: transportGst,
      note: "GTA under RCM (SAC 9965)",
    },
    {
      key: "crane",
      label: `Crane & erection (${craneTier.capacityT} T)`,
      amount: craneCost,
      note: `${A.craneDaysPerTurbine} day(s)/turbine + mobilization`,
    },
    {
      key: "crane_gst",
      label: `Crane GST (${A.gst.cranePct}%)`,
      amount: craneGst,
      note: "Equipment + operator (SAC 9973/9987)",
    },
    { key: "grand_total", label: "Grand total", amount: grandTotal },
  ];

  return {
    currency: "INR",
    shipmentCosts,
    lines,
    transportSubtotal,
    transportGst,
    craneCost,
    craneGst,
    craneCapacityT: craneTier.capacityT,
    grandTotal,
    perTurbine,
    perMW,
    pctOfTurbineCost,
  };
}
