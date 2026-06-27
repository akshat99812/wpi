// Client-side types + fetchers for the Turbine Logistics Planner API.
// Mirrors apps/api/src/services/logistics. All cost math lives on the server
// (POST /quote) — this module only renders what the server returns.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type OEM = "suzlon" | "inox" | "vestas" | "siemensgamesa" | "envision" | "adani";
export type ComponentCategory = "blade" | "nacelle" | "hub" | "tower";
export type TerrainType = "plains" | "hilly";
export type PlanScope = "turbine" | "component";
export type TrailerType = "standardMultiAxle" | "extendableBlade" | "hydraulicModular";
export type RoutingMode = "ors" | "estimate";

export interface Facility {
  id: string;
  oem: OEM;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  products: string[];
  legacy?: boolean;
  note?: string;
}

export interface TurbineModel {
  model: string;
  oem: OEM;
  ratedMW: number;
  rotorDiameterM: number;
  bladeLengthM: number;
  bladeWeightT: number;
  bladeMaxChordM: number;
  nacelleWeightT: number;
  hubWeightT: number;
  towerSections: number;
  towerSectionLengthM: number;
  towerSectionWeightT: number;
  towerBaseDiameterM: number;
  hubHeightsM: number[];
  era?: "classic" | "current" | "next";
  estimated: boolean;
  note?: string;
}

export interface Shipment {
  component: ComponentCategory;
  label: string;
  countPerTurbine: number;
  trailerType: TrailerType;
  weightT: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  superOdc: boolean;
  origin: Facility;
  towerSourcedLocally?: boolean;
  distanceKm: number;
  durationHr: number;
  routingMode: RoutingMode;
}

export interface CraneTier {
  maxLoadT: number;
  capacityT: number;
  dayRate: number;
}

export interface CostAssumptions {
  ratePerKm: Record<TrailerType, number>;
  bladeAdapterPremiumPerKm: number;
  avgKmPerDay: number;
  escortVehicles: number;
  escortPerDay: number;
  policePerDay: number;
  nhPermitPer50Km: number;
  statePermitEach: number;
  statesCrossed: number;
  loadsPerConvoy: number;
  craneTiers: CraneTier[];
  craneDaysPerTurbine: number;
  craneMobilization: number;
  gst: { transportPct: number; cranePct: number };
  turbinePricePerMW: number;
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
  lines: CostLine[];
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

export interface PresetSite {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export interface PlanLeg {
  origin: Facility;
  distanceKm: number;
  durationHr: number;
  routingMode: RoutingMode;
  /** Road-line geometry [lon,lat][] for map plotting (straight line in estimate mode). */
  geometry: [number, number][];
}

/** One part shipped from a given origin, for the on-map click card. */
export interface RouteOriginPart {
  originId: string;
  component: ComponentCategory;
  label: string;
  count: number;
}

/** What the planner publishes for the pro-map to draw (origins → site). */
export interface LogisticsRoutesPayload {
  legs: PlanLeg[];
  destination: Destination;
  turbineLabel: string;
  /** Company (OEM) display name, shown on the origin click card. */
  oemLabel: string;
  /** Parts shipped, grouped by origin id — powers the origin click card. */
  shipments: RouteOriginPart[];
}

export interface Destination {
  lat: number;
  lon: number;
  name?: string;
}

export interface Catalog {
  oems: { id: OEM; label: string }[];
  turbines: TurbineModel[];
  facilities: Facility[];
  trailerTypes: { id: TrailerType; label: string }[];
  presetSites: PresetSite[];
  defaultAssumptions: CostAssumptions;
}

export interface PlanRequest {
  oem: OEM;
  turbineModel: string;
  scope: PlanScope;
  component?: ComponentCategory;
  destination: Destination;
  numTurbines: number;
  terrain: TerrainType;
  origins?: Partial<Record<ComponentCategory, string>>;
  assumptions?: Partial<CostAssumptions>;
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

export interface QuoteRequest {
  shipments: Shipment[];
  ratedMW: number;
  numTurbines: number;
  terrain: TerrainType;
  assumptions: CostAssumptions;
}

// ── Fetchers (all Pro endpoints → credentials: "include") ────────────────
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body?.error || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body?.error || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchCatalog(): Promise<Catalog> {
  return getJson<Catalog>("/api/logistics/catalog");
}

export function postPlan(req: PlanRequest): Promise<PlanResponse> {
  return postJson<PlanResponse>("/api/logistics/plan", req);
}

export function postQuote(req: QuoteRequest): Promise<{ breakdown: CostBreakdown }> {
  return postJson<{ breakdown: CostBreakdown }>("/api/logistics/quote", req);
}

// ── Formatting ───────────────────────────────────────────────────────────
const INR0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatINR(n: number): string {
  return `₹${INR0.format(Math.round(n))}`;
}

// Compact lakh/crore label for headline figures (Indian numbering).
export function formatINRCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatINR(n);
}

export function formatKm(n: number): string {
  return `${INR0.format(Math.round(n))} km`;
}
