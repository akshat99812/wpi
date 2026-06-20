/**
 * ASI monument connector (exclusion-plan.md Phase C1 input).
 *
 * No clean monument-boundary GIS exists, so we take Centrally Protected Monument
 * *locations* from OSM (historic=* with operator ~ "Archaeological Survey") and
 * load them as infra_feature(kind='institution', asi=true). buffers.ts then
 * derives the 100 m prohibited (red) + 300 m regulated (amber) zones off these
 * points — indicative (is_legal_boundary=false), verify the protected limit.
 *
 * Raw Overpass JSON cached to data/by-source/asi/raw/asi.json.
 */
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { loadInfra, type LoadResult } from "../loader";
import { SOURCES } from "../registry";
import type { Geometry } from "../types";

const ROOT = path.resolve(import.meta.dir, "../../../.."); // apps/api
const RAW = path.join(ROOT, "data/by-source/asi/raw/asi.json");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "wce-exclusions-ingest/1.0 (wind-energy siting; contact via repo)";

// Selective bbox query — `area` membership + broad `historic` + operator-regex
// over all India times out on public Overpass. Anchoring on specific historic
// values inside India's bbox is far cheaper and still catches ASI-operated sites.
const INDIA_BBOX = "6.5,68.0,37.6,97.5"; // S,W,N,E
const ASI_QUERY = `[out:json][timeout:150];
(
  nwr["historic"="archaeological_site"]["operator"~"Archaeolog",i](${INDIA_BBOX});
  nwr["historic"="monument"]["operator"~"Archaeolog",i](${INDIA_BBOX});
  nwr["historic"]["heritage:operator"~"archaeolog",i](${INDIA_BBOX});
);
out center;`;

type OverpassEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function fetchOverpass(): Promise<{ elements?: OverpassEl[] }> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: "data=" + encodeURIComponent(ASI_QUERY),
        signal: AbortSignal.timeout(160_000),
      });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return (await res.json()) as { elements?: OverpassEl[] };
    } catch (e) {
      lastErr = e;
      console.warn(`[asi] ${url} failed: ${(e as Error).message}; trying next…`);
    }
  }
  throw new Error(`All Overpass endpoints failed: ${(lastErr as Error)?.message}`);
}

/** Each element → a Point at its node coords / way-relation center. */
function toPoints(elements: OverpassEl[]): { geometry: Geometry; attrs: Record<string, unknown> }[] {
  const out: { geometry: Geometry; attrs: Record<string, unknown> }[] = [];
  for (const el of elements) {
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon == null || lat == null) continue;
    out.push({
      geometry: { type: "Point", coordinates: [lon, lat] },
      attrs: { asi: true, name: el.tags?.["name"] ?? null, osm_id: `${el.type}/${el.id}`, historic: el.tags?.["historic"] ?? null },
    });
  }
  return out;
}

export async function ingestAsi(
  pool: Pool,
  opts: { refresh?: boolean; truncate?: boolean } = {},
): Promise<LoadResult> {
  fs.mkdirSync(path.dirname(RAW), { recursive: true });
  let raw: { elements?: OverpassEl[] };
  if (!opts.refresh && fs.existsSync(RAW)) {
    raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
    console.log(`[asi] using cached ${RAW}`);
  } else {
    console.log("[asi] querying Overpass for ASI monument locations…");
    raw = await fetchOverpass();
    fs.writeFileSync(RAW, JSON.stringify(raw));
    console.log(`[asi] cached → ${RAW}`);
  }
  const points = toPoints(raw.elements ?? []);
  console.log(`[asi] ${raw.elements?.length ?? 0} elements → ${points.length} monument points`);
  return loadInfra(pool, SOURCES.asi!, "institution", points, { truncate: opts.truncate ?? true });
}
