// Deterministic cost regression (LOGISTICS_TOOL_PLAN.md §10.1).
//
// computeCost is OEM-agnostic and pure, so we pin it with fixed distances and
// DEFAULT_ASSUMPTIONS. Input: Suzlon S144, 1 turbine, plains. Any drift in the
// §6 formulas changes grandTotal and fails here — that's the point.

import { test, expect } from "bun:test";
import { computeCost, DEFAULT_ASSUMPTIONS } from "./cost";
import { assembleSpecs, getTurbine, type ShipmentSpec } from "./turbines";
import { getFacility } from "./facilities";
import type { Shipment } from "./types";

// Cost ignores `origin`, but Shipment requires one — use any real facility.
const ORIGIN = getFacility("suz_gandhidham")!;

// Fixed haul distances from §10.1 (km), by component.
const DIST: Record<string, number> = { blade: 100, nacelle: 300, hub: 300, tower: 200 };

function withRouting(spec: ShipmentSpec): Shipment {
  return {
    ...spec,
    origin: ORIGIN,
    distanceKm: DIST[spec.component]!,
    durationHr: DIST[spec.component]! / 40,
    routingMode: "estimate",
  };
}

const CTX = { ratedMW: 3.15, numTurbines: 1, terrain: "plains" as const };

test("S144 assembly matches the §10.1 transport envelope", () => {
  const s144 = getTurbine("suzlon", "S144");
  expect(s144).toBeDefined();
  const specs = assembleSpecs(s144!);
  const byComponent = Object.fromEntries(specs.map((s) => [s.component, s]));

  expect(byComponent.blade).toMatchObject({ trailerType: "extendableBlade", weightT: 15, countPerTurbine: 3, superOdc: true });
  expect(byComponent.nacelle).toMatchObject({ trailerType: "hydraulicModular", weightT: 92, countPerTurbine: 1, superOdc: true });
  expect(byComponent.hub).toMatchObject({ trailerType: "standardMultiAxle", weightT: 28, countPerTurbine: 1, superOdc: false });
  expect(byComponent.tower).toMatchObject({ trailerType: "hydraulicModular", weightT: 60, countPerTurbine: 4, superOdc: true });
});

test("S144 §10.1 cost breakdown is exact (grandTotal === 4_175_900)", () => {
  const specs = assembleSpecs(getTurbine("suzlon", "S144")!);
  const shipments = specs.map(withRouting);

  const b = computeCost(shipments, CTX, DEFAULT_ASSUMPTIONS);
  const cost = Object.fromEntries(b.shipmentCosts.map((c) => [c.component, c]));

  // Per-shipment subtotals (§10.1 table).
  expect(cost.blade!).toMatchObject({ trucking: 34_500, escort: 18_000, police: 15_000, permits: 96_000, subtotal: 163_500 });
  expect(cost.nacelle!).toMatchObject({ trucking: 55_500, escort: 12_000, police: 10_000, permits: 36_000, subtotal: 113_500 });
  expect(cost.hub!).toMatchObject({ trucking: 21_000, escort: 12_000, police: 0, permits: 36_000, subtotal: 69_000 });
  expect(cost.tower!).toMatchObject({ trucking: 148_000, escort: 48_000, police: 40_000, permits: 136_000, subtotal: 372_000 });

  // Project rollup.
  expect(b.transportSubtotal).toBe(718_000);
  expect(b.craneCapacityT).toBe(400); // heaviest 92 t → 400 T tier
  expect(b.craneCost).toBe(2_900_000);
  expect(b.transportGst).toBe(35_900);
  expect(b.craneGst).toBe(522_000);
  expect(b.grandTotal).toBe(4_175_900);

  expect(b.perTurbine).toBe(4_175_900);
  expect(b.perMW).toBeCloseTo(1_325_682.54, 2);
  expect(b.pctOfTurbineCost).toBeCloseTo(2.2095, 3);
});

test("hilly terrain adds the blade-adapter premium (₹45/km) to blade trucking only", () => {
  const specs = assembleSpecs(getTurbine("suzlon", "S144")!);
  const shipments = specs.map(withRouting);

  const plains = computeCost(shipments, { ...CTX, terrain: "plains" }, DEFAULT_ASSUMPTIONS);
  const hilly = computeCost(shipments, { ...CTX, terrain: "hilly" }, DEFAULT_ASSUMPTIONS);

  // Blade: 3 loads × 100 km × ₹45 premium = +13,500 trucking; others unchanged.
  const plainsBlade = plains.shipmentCosts.find((c) => c.component === "blade")!;
  const hillyBlade = hilly.shipmentCosts.find((c) => c.component === "blade")!;
  expect(hillyBlade.trucking - plainsBlade.trucking).toBe(13_500);

  const plainsNacelle = plains.shipmentCosts.find((c) => c.component === "nacelle")!;
  const hillyNacelle = hilly.shipmentCosts.find((c) => c.component === "nacelle")!;
  expect(hillyNacelle.trucking).toBe(plainsNacelle.trucking);
});
