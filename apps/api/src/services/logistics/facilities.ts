import type { ComponentCategory, Facility, OEM } from "./types";

// India manufacturing footprints for the six OEMs the planner covers. A
// turbine's components ship only from its own OEM's plants (origins are
// OEM-scoped). Coordinates are city/site level — good for road-distance
// planning, not survey grade. Blade plants matter most: blades are the
// dimension-binding load. IDs are OEM-prefixed and globally unique (both
// Suzlon and Inox operate a Bhuj plant).
//
// Sources: each OEM's factsheet/press + thewindpower.net / wind-turbine-models.com.
// See LOGISTICS_TOOL_PLAN.md §4.1 and §12 for the full citation list.
export const FACILITIES: Facility[] = [
  // ── Suzlon ────────────────────────────────────────────────────────────
  { id: "suz_bhuj", oem: "suzlon", name: "Suzlon Bhuj Blade Plant", city: "Bhuj (Kutch)", state: "Gujarat", lat: 23.24, lon: 69.67, products: ["blade"] },
  { id: "suz_dhule", oem: "suzlon", name: "Suzlon Dhule Blade Plant", city: "Dhule", state: "Maharashtra", lat: 20.9, lon: 74.77, products: ["blade"] },
  { id: "suz_anantapur", oem: "suzlon", name: "Suzlon Anantapur Blade Plant", city: "Anantapur", state: "Andhra Pradesh", lat: 14.68, lon: 77.6, products: ["blade"] },
  { id: "suz_ratlam", oem: "suzlon", name: "Suzlon Badnawar Blade Plant", city: "Badnawar (Ratlam)", state: "Madhya Pradesh", lat: 23.33, lon: 75.04, products: ["blade"] },
  { id: "suz_jaisalmer", oem: "suzlon", name: "Suzlon Jaisalmer Blade Plant", city: "Jaisalmer", state: "Rajasthan", lat: 26.91, lon: 70.9, products: ["blade"] },
  { id: "suz_daman", oem: "suzlon", name: "Suzlon Daman Nacelle Plant", city: "Daman", state: "Daman & Diu", lat: 20.4, lon: 72.85, products: ["nacelle", "hub"] },
  { id: "suz_pondicherry", oem: "suzlon", name: "Suzlon Puducherry Nacelle Plant", city: "Puducherry", state: "Puducherry", lat: 11.93, lon: 79.83, products: ["nacelle", "hub"] },
  { id: "suz_gandhidham", oem: "suzlon", name: "Suzlon Gandhidham Tower Plant", city: "Gandhidham (Kutch)", state: "Gujarat", lat: 23.07, lon: 70.13, products: ["tower"] },
  { id: "suz_coimbatore", oem: "suzlon", name: "SE Forge Coimbatore (castings)", city: "Coimbatore", state: "Tamil Nadu", lat: 11.12, lon: 77.02, products: ["forging"], note: "Main frames, hubs & bearing-housing castings (SE Forge)." },
  { id: "suz_vadodara", oem: "suzlon", name: "Suzlon Vadodara (transformers / forgings)", city: "Vadodara", state: "Gujarat", lat: 22.31, lon: 73.18, products: ["transformer", "forging"], note: "Transformers; SE Forge ring forgings." },
  { id: "suz_padubidri", oem: "suzlon", name: "Suzlon Padubidri (legacy)", city: "Padubidri (Udupi)", state: "Karnataka", lat: 13.18, lon: 74.75, products: ["blade", "nacelle"], legacy: true, note: "Earliest Suzlon site; production largely consolidated to newer plants." },

  // ── Inox Wind ─────────────────────────────────────────────────────────
  { id: "inox_rohika", oem: "inox", name: "Inox Wind Rohika Plant", city: "Rohika (Ahmedabad)", state: "Gujarat", lat: 22.85, lon: 71.95, products: ["blade", "tower"] },
  { id: "inox_barwani", oem: "inox", name: "Inox Wind Barwani (integrated)", city: "Barwani", state: "Madhya Pradesh", lat: 22.03, lon: 74.9, products: ["blade", "tower", "nacelle", "hub"] },
  { id: "inox_una", oem: "inox", name: "Inox Wind Una Plant", city: "Una (Basal)", state: "Himachal Pradesh", lat: 31.47, lon: 76.27, products: ["nacelle", "hub"] },
  { id: "inox_bhuj", oem: "inox", name: "Inox Wind Bhuj Plant", city: "Bhuj", state: "Gujarat", lat: 23.25, lon: 69.67, products: ["nacelle", "hub"] },
  { id: "inox_kalyangarh", oem: "inox", name: "Inox Wind Kalyangarh Plant", city: "Kalyangarh (Ahmedabad)", state: "Gujarat", lat: 22.95, lon: 72.35, products: ["nacelle", "hub"], note: "Commissioned Dec 2025; 3 MW & upcoming 4.X MW class." },

  // ── Vestas (towers sourced locally) ───────────────────────────────────
  { id: "ves_ahmedabad", oem: "vestas", name: "Vestas Blade Plant (Bavla)", city: "Bavla (Ahmedabad)", state: "Gujarat", lat: 22.83, lon: 72.35, products: ["blade"] },
  { id: "ves_chennai", oem: "vestas", name: "Vestas Nacelle & Hub Plant", city: "Sriperumbudur (Chennai)", state: "Tamil Nadu", lat: 12.7, lon: 79.95, products: ["nacelle", "hub"] },

  // ── Siemens Gamesa / Vayona ───────────────────────────────────────────
  { id: "sg_nellore", oem: "siemensgamesa", name: "SG/Vayona Nellore Blade Plant", city: "Nellore", state: "Andhra Pradesh", lat: 14.45, lon: 79.99, products: ["blade"], note: "Primary blade plant; also generators." },
  { id: "sg_halol", oem: "siemensgamesa", name: "SG/Vayona Halol Plant", city: "Halol", state: "Gujarat", lat: 22.68, lon: 73.47, products: ["blade", "tower"] },
  { id: "sg_mamandur", oem: "siemensgamesa", name: "SG/Vayona Mamandur Nacelle Plant", city: "Mamandur (Kancheepuram)", state: "Tamil Nadu", lat: 12.72, lon: 79.86, products: ["nacelle", "hub"] },

  // ── Envision (towers sourced locally) ─────────────────────────────────
  { id: "env_trichy", oem: "envision", name: "Envision Trichy Blade Plant", city: "Tiruchirappalli", state: "Tamil Nadu", lat: 10.79, lon: 78.7, products: ["blade"], note: "Primary blade plant (since ~2023)." },
  { id: "env_dabaspet", oem: "envision", name: "Envision Dabaspet Blade Plant", city: "Dabaspet (Bengaluru)", state: "Karnataka", lat: 13.13, lon: 77.37, products: ["blade"] },
  { id: "env_bavla", oem: "envision", name: "Envision Bavla Blade Plant", city: "Bavla (Ahmedabad)", state: "Gujarat", lat: 22.85, lon: 72.38, products: ["blade"], note: "Under construction; operational ~2027." },
  { id: "env_chakan", oem: "envision", name: "Envision Chakan Nacelle Plant", city: "Chakan (Pune)", state: "Maharashtra", lat: 18.76, lon: 73.86, products: ["nacelle", "hub"] },

  // ── Adani Wind (towers sourced locally) ───────────────────────────────
  { id: "adani_mundra", oem: "adani", name: "Adani Wind Mundra (integrated)", city: "Mundra (beside Mundra Port)", state: "Gujarat", lat: 22.84, lon: 69.72, products: ["blade", "nacelle", "hub"], note: "Integrated WTG plant; LM-licensed blades up to 91.2 m." },
];

const R_EARTH_KM = 6371;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

export function getFacility(id: string): Facility | undefined {
  return FACILITIES.find((f) => f.id === id);
}

export function facilitiesForOem(oem: OEM): Facility[] {
  return FACILITIES.filter((f) => f.oem === oem);
}

// Non-legacy plants of a given OEM that produce a given component.
export function facilitiesProducing(
  oem: OEM,
  component: ComponentCategory,
): Facility[] {
  return FACILITIES.filter(
    (f) => f.oem === oem && !f.legacy && f.products.includes(component),
  );
}

function nearestOf(
  pool: Facility[],
  dest: { lat: number; lon: number },
): Facility | undefined {
  let best: Facility | undefined;
  let bestD = Infinity;
  for (const f of pool) {
    const d = haversineKm(f, dest);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export interface ResolvedOrigin {
  facility: Facility;
  /** True when the OEM owns no plant for this component (e.g. towers for
   *  Vestas/Envision/Adani) and the origin is approximated by the nearest
   *  plant of any kind. The UI should flag this and invite an override. */
  sourcedLocally: boolean;
}

// OEM-scoped origin resolution. Prefers the nearest non-legacy plant that
// actually makes the component; otherwise falls back to the OEM's nearest
// plant of any kind (sourcedLocally=true) — used for towers at OEMs without
// a tower factory.
export function resolveOrigin(
  oem: OEM,
  component: ComponentCategory,
  dest: { lat: number; lon: number },
): ResolvedOrigin {
  const producers = facilitiesProducing(oem, component);
  const nearestProducer = nearestOf(producers, dest);
  if (nearestProducer) return { facility: nearestProducer, sourcedLocally: false };

  // Every covered OEM has at least one facility, so the [0] fallback is safe.
  const anyPlant =
    nearestOf(
      facilitiesForOem(oem).filter((f) => !f.legacy),
      dest,
    ) ?? facilitiesForOem(oem)[0]!;
  return { facility: anyPlant, sourcedLocally: true };
}
