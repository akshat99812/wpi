// Road routing for ODC legs (LOGISTICS_TOOL_PLAN.md §5).
//
// Primary: OpenRouteService `driving-hgv` (heavy-goods) with the leg's binding
// weight/height/width passed as profile restrictions. We call the GeoJSON
// variant so we get the road-line geometry back (for plotting the route on the
// map), alongside distance + duration. Free tier: 2,500 req/day, 40 req/min,
// ≤6,000 km — India hauls fit easily.
//
// Fallback (no key, ORS error, or no route): great-circle distance × 1.3 road
// circuity, 40 km/h average, and a straight origin→dest line as the geometry.
// `routingMode` is surfaced so the UI/map can badge an estimate honestly rather
// than passing it off as a real route.

import { haversineKm } from "./facilities";

const ORS_URL =
  "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson";
const ROAD_CIRCUITY = 1.3; // great-circle → road distance multiplier
const FALLBACK_AVG_KMPH = 40;
const ORS_TIMEOUT_MS = 10_000;
const DEFAULT_AXLE_LOAD_T = 12;

export type RoutingMode = "ors" | "estimate";

// [lon, lat] pairs (GeoJSON order) tracing the road (or a straight line in
// estimate mode).
export type LineGeometry = [number, number][];

export interface RouteResult {
  distanceKm: number;
  durationHr: number;
  routingMode: RoutingMode;
  geometry: LineGeometry;
}

export interface LatLon {
  lat: number;
  lon: number;
}

// Binding restrictions for an HGV leg — the max across the loads on it.
export interface LegRestrictions {
  weightT: number;
  heightM: number;
  widthM: number;
}

function getApiKey(): string | undefined {
  return process.env.ORS_API_KEY || process.env.OPENROUTESERVICE_API_KEY;
}

function fallback(origin: LatLon, dest: LatLon): RouteResult {
  const distanceKm = haversineKm(origin, dest) * ROAD_CIRCUITY;
  return {
    distanceKm,
    durationHr: distanceKm / FALLBACK_AVG_KMPH,
    routingMode: "estimate",
    geometry: [
      [origin.lon, origin.lat],
      [dest.lon, dest.lat],
    ],
  };
}

interface OrsGeoJson {
  features?: {
    properties?: { summary?: { distance?: number; duration?: number } };
    geometry?: { coordinates?: [number, number][] };
  }[];
}

// Route one leg (origin → dest) for an HGV carrying the given binding loads.
// Never throws — any failure degrades to the haversine estimate so a single bad
// leg can't 500 the whole plan.
export async function routeLeg(
  origin: LatLon,
  dest: LatLon,
  restrictions: LegRestrictions,
): Promise<RouteResult> {
  const apiKey = getApiKey();
  if (!apiKey) return fallback(origin, dest);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORS_TIMEOUT_MS);
  try {
    const res = await fetch(ORS_URL, {
      method: "POST",
      headers: {
        // ORS wants the raw key — NO "Bearer " prefix.
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      // GeoJSON coordinate order is [lon, lat]. `length` is intentionally
      // omitted — it is poorly tagged in OSM and risks empty routes (§5).
      body: JSON.stringify({
        coordinates: [
          [origin.lon, origin.lat],
          [dest.lon, dest.lat],
        ],
        // Wind sites (and some plants) sit far from mapped roads; without an
        // unlimited snap radius ORS returns 2010 "no routable point" and we
        // lose the route to a straight-line estimate. -1 = snap to the nearest
        // road however far.
        radiuses: [-1, -1],
        options: {
          vehicle_type: "hgv",
          profile_params: {
            restrictions: {
              weight: restrictions.weightT,
              height: restrictions.heightM,
              width: restrictions.widthM,
              axleload: DEFAULT_AXLE_LOAD_T,
            },
          },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[logistics/routing] ORS ${res.status}; using estimate`);
      return fallback(origin, dest);
    }

    const json = (await res.json()) as OrsGeoJson;
    const feature = json.features?.[0];
    const summary = feature?.properties?.summary;
    const coords = feature?.geometry?.coordinates;
    if (
      !summary ||
      typeof summary.distance !== "number" ||
      typeof summary.duration !== "number" ||
      !Array.isArray(coords) ||
      coords.length === 0
    ) {
      console.warn("[logistics/routing] ORS returned no route; using estimate");
      return fallback(origin, dest);
    }

    return {
      distanceKm: summary.distance / 1000,
      durationHr: summary.duration / 3600,
      routingMode: "ors",
      geometry: coords,
    };
  } catch (err) {
    const why = err instanceof Error ? err.message : "unknown error";
    console.warn(`[logistics/routing] ORS request failed (${why}); using estimate`);
    return fallback(origin, dest);
  } finally {
    clearTimeout(timer);
  }
}

// Binding restriction = the heaviest/tallest/widest load on the leg.
export function bindingRestrictions(
  loads: { weightT: number; heightM: number; widthM: number }[],
): LegRestrictions {
  return {
    weightT: Math.max(...loads.map((l) => l.weightT)),
    heightM: Math.max(...loads.map((l) => l.heightM)),
    widthM: Math.max(...loads.map((l) => l.widthM)),
  };
}
