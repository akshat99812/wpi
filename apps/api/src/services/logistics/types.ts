// Shared types for the turbine-logistics planner.
//
// The planner answers: "to put a Suzlon turbine of model X on the ground at
// site Y, where do the big (over-dimensional) parts ship FROM, how do they
// move, and what does the road logistics cost?" Blades are the binding
// constraint (70 m+ on the S144), but the model covers every major ODC load.

export type ComponentCategory =
  | "blade"
  | "nacelle"
  | "hub"
  | "tower"; // tower = one tubular tower section

// Terrain affects the blade trailer rate (hilly ghats need a blade adapter).
export type TerrainType = "plains" | "hilly";

// A plan covers either the whole turbine or a single component leg.
export type PlanScope = "turbine" | "component";

// Turbine OEMs covered. Components ship only from the matching OEM's plants.
export type OEM =
  | "suzlon"
  | "inox"
  | "vestas"
  | "siemensgamesa" // onshore India business now branded Vayona Energy (Dec 2025)
  | "envision"
  | "adani";

export const OEM_LABELS: Record<OEM, string> = {
  suzlon: "Suzlon",
  inox: "Inox Wind",
  vestas: "Vestas",
  siemensgamesa: "Siemens Gamesa / Vayona",
  envision: "Envision",
  adani: "Adani Wind",
};

// What a factory can originate. "forging"/"transformer" are informational
// (castings/electricals) and are not routed as ODC loads by the planner.
export type FacilityProduct =
  | ComponentCategory
  | "forging"
  | "transformer";

export interface Facility {
  id: string; // OEM-prefixed & globally unique, e.g. "suz_bhuj" (Suzlon & Inox both have a Bhuj)
  oem: OEM;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  products: FacilityProduct[];
  /** Legacy/consolidated sites are kept selectable but never auto-picked. */
  legacy?: boolean;
  note?: string;
}

// Trailer / axle systems used for Indian wind ODC. Rates are ₹/km and live
// in the (editable) cost assumptions, keyed by this string.
export type TrailerType =
  | "standardMultiAxle" // multi-axle low-bed: hubs, lighter tower cans
  | "extendableBlade" // telescopic blade trailer (extends to the blade length)
  | "hydraulicModular"; // SPMT / hydraulic axles: nacelles, heavy base cans

export interface TurbineModel {
  model: string; // e.g. "S144"
  oem: OEM;
  ratedMW: number;
  rotorDiameterM: number;
  bladeLengthM: number;
  bladeWeightT: number;
  bladeMaxChordM: number; // transport width of a blade
  nacelleWeightT: number; // Suzlon DFIG: drivetrain (gearbox+generator) is inside
  hubWeightT: number;
  towerSections: number;
  towerSectionLengthM: number;
  towerSectionWeightT: number; // average per section
  towerBaseDiameterM: number; // transport width/height of the base can
  hubHeightsM: number[];
  era?: "classic" | "current" | "next";
  /** True when most dimensions/weights are engineering estimates, not
   *  officially published by Suzlon. Surfaced as a disclaimer in the UI. */
  estimated: boolean;
  note?: string;
}

// One distinct ODC load type within a plan (e.g. "blade ×3 from Bhuj").
export interface Shipment {
  component: ComponentCategory;
  label: string; // human label, e.g. "Rotor blade (70.5 m)"
  countPerTurbine: number;
  trailerType: TrailerType;
  weightT: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  superOdc: boolean; // triggers police escort + flags special permits
  origin: Facility;
  /** True when the OEM owns no plant for this component (e.g. towers for
   *  Vestas/Envision/Adani) and the origin is approximated by the OEM's
   *  nearest plant — the user should override with the real fabricator. */
  towerSourcedLocally?: boolean;
  distanceKm: number;
  durationHr: number;
  routingMode: "ors" | "estimate";
}

// Every knob the cost model exposes. The web UI lets the user edit all of
// these and re-quotes. INR throughout.
export interface CostAssumptions {
  ratePerKm: Record<TrailerType, number>;
  bladeAdapterPremiumPerKm: number; // added to blade trailer on hilly terrain
  avgKmPerDay: number; // ODC moves daylight-only and slow
  escortVehicles: number; // pilot vehicles per convoy
  escortPerDay: number;
  policePerDay: number; // applied only to super-ODC convoys
  nhPermitPer50Km: number; // MoRTH OWC national-highway permit
  statePermitEach: number; // per state crossed
  statesCrossed: number;
  loadsPerConvoy: number; // batching factor (1 = each load runs alone)
  craneTiers: CraneTier[];
  craneDaysPerTurbine: number; // load-in + erection crane days
  craneMobilization: number; // once per project
  gst: { transportPct: number; cranePct: number };
  turbinePricePerMW: number; // optional; 0 => skip "% of turbine cost"
}

export interface CraneTier {
  maxLoadT: number; // use this crane when the heaviest load <= maxLoadT
  capacityT: number;
  dayRate: number;
}

export interface CostLine {
  key: string;
  label: string;
  amount: number;
  note?: string;
}

export interface ShipmentCost {
  component: ComponentCategory;
  label: string;
  trailerLabel: string;
  totalLoads: number;
  trucking: number;
  escort: number;
  police: number;
  permits: number;
  subtotal: number;
}

export interface CostBreakdown {
  currency: "INR";
  shipmentCosts: ShipmentCost[];
  lines: CostLine[]; // top-level itemised lines (transport, gst, crane, ...)
  transportSubtotal: number;
  transportGst: number;
  craneCost: number;
  craneGst: number;
  craneCapacityT: number;
  grandTotal: number;
  perTurbine: number;
  perMW: number;
  pctOfTurbineCost: number | null;
}
