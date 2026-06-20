/**
 * OSM Protected-Areas connector (exclusion-plan.md §B4).
 *
 * States don't publish NP/WLS/reserve boundaries as GIS, so we use OSM relations
 * (ODbL): boundary=protected_area / national_park + leisure=nature_reserve. The
 * PA relation set is small enough for a live Overpass area query (unlike roads).
 *
 * Every PA is tier-5, is_legal_boundary=false — INDICATIVE, must be gazette-
 * verified before clearance use. WDPA is NEVER loaded (commercial restriction);
 * it's an offline cross-check only.
 *
 * Raw Overpass JSON is cached to data/by-source/osm_pa/raw/pa.json so re-runs
 * don't re-hit Overpass.
 */
import fs from "node:fs";
import path from "node:path";
import osmtogeojson from "osmtogeojson";
import type { Pool } from "pg";
import { loadPolygons, type LoadResult } from "../loader";
import { SOURCES } from "../registry";
import type { Feature, NormalisedFeature } from "../types";

const ROOT = path.resolve(import.meta.dir, "../../../.."); // apps/api
const RAW = path.join(ROOT, "data/by-source/osm_pa/raw/pa.json");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "wce-exclusions-ingest/1.0 (wind-energy siting; contact via repo)";

const PA_QUERY = `[out:json][timeout:300];
area["ISO3166-1"="IN"][admin_level=2]->.in;
(
  relation["boundary"="protected_area"](area.in);
  relation["boundary"="national_park"](area.in);
  relation["leisure"="nature_reserve"](area.in);
);
out geom;`;

/** Classify an OSM PA feature → layer_code. Defaults to national_park-grade red. */
function classifyPa(props: Record<string, unknown> | null): string {
  const title = `${props?.["protection_title"] ?? ""} ${props?.["protect_class"] ?? ""} ${props?.["boundary"] ?? ""} ${props?.["leisure"] ?? ""} ${props?.["name"] ?? ""}`.toLowerCase();
  if (title.includes("tiger reserve")) return "tiger_reserve_core";
  if (title.includes("wildlife sanctuary")) return "wildlife_sanctuary";
  if (title.includes("conservation reserve")) return "conservation_reserve";
  if (title.includes("community reserve")) return "community_reserve";
  if (title.includes("national park")) return "national_park";
  return "national_park"; // generic protected_area / nature_reserve → treat as PA red
}

export function paMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  const props = feature.properties ?? {};
  const layer_code = classifyPa(props);
  return {
    geometry: feature.geometry,
    layer_code,
    class: "red",
    source_id: "osm_pa",
    is_legal_boundary: false, // OSM = indicative; verify vs gazette before clearance
    attrs: {
      name: props["name"] ?? null,
      osm_id: props["id"] ?? props["@id"] ?? null,
      protect_class: props["protect_class"] ?? null,
      protection_title: props["protection_title"] ?? null,
      verify: "gazette",
    },
  };
}

async function fetchOverpass(): Promise<unknown> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: "data=" + encodeURIComponent(PA_QUERY),
        signal: AbortSignal.timeout(310_000),
      });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn(`[osm-pa] ${url} failed: ${(e as Error).message}; trying next…`);
    }
  }
  throw new Error(`All Overpass endpoints failed: ${(lastErr as Error)?.message}`);
}

/**
 * Ingest OSM PAs. Uses cached raw JSON if present (unless refresh=true), else
 * queries Overpass and caches. Converts with osmtogeojson and loads polygons.
 */
export async function ingestOsmPa(
  pool: Pool,
  opts: { refresh?: boolean; truncate?: boolean } = {},
): Promise<LoadResult> {
  fs.mkdirSync(path.dirname(RAW), { recursive: true });
  let raw: unknown;
  if (!opts.refresh && fs.existsSync(RAW)) {
    raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
    console.log(`[osm-pa] using cached ${RAW}`);
  } else {
    console.log("[osm-pa] querying Overpass for India PA relations…");
    raw = await fetchOverpass();
    fs.writeFileSync(RAW, JSON.stringify(raw));
    console.log(`[osm-pa] cached → ${RAW}`);
  }
  const fc = osmtogeojson(raw) as { features: Feature[] };
  const normalised = fc.features.map(paMapper).filter((f): f is NormalisedFeature => f !== null);
  console.log(`[osm-pa] ${fc.features.length} OSM features → ${normalised.length} polygonal PAs`);
  return loadPolygons(pool, SOURCES.osm_pa!, normalised, { truncate: opts.truncate ?? true });
}
