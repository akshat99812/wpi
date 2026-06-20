/**
 * Admin base connector (exclusion-plan.md Phase A) — the country clip mask + the
 * state polygons used to tag features by state. NOT exclusions.
 *
 * Country: india-composite.geojson is a small raw repo file (curl-downloadable).
 * States: india-geodata ships `admin/states` as `.parquet`; convert it to
 * GeoJSON first (`ogr2ogr -f GeoJSON states.geojson states.parquet`) — this
 * connector consumes the converted GeoJSON.
 */
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { loadAdminCountry, loadAdminStates } from "../loader";
import { SOURCES } from "../registry";
import type { Feature, Geometry } from "../types";

const ROOT = path.resolve(import.meta.dir, "../../../.."); // apps/api

export function adminPath(...p: string[]): string {
  return path.join(ROOT, "data/by-source", ...p);
}

type AnyGeo = {
  type?: string;
  features?: Feature[];
  geometry?: Geometry | null;
  geometries?: Geometry[];
  coordinates?: unknown;
};

/** Pull every geometry out of a file that may be a FC, a Feature, or a bare geometry. */
function extractGeometries(parsed: AnyGeo): Geometry[] {
  if (parsed.type === "FeatureCollection" && parsed.features)
    return parsed.features.map((f) => f.geometry).filter((g): g is Geometry => g != null);
  if (parsed.type === "Feature" && parsed.geometry) return [parsed.geometry];
  if (parsed.type === "GeometryCollection" && parsed.geometries) return parsed.geometries;
  if (parsed.type && parsed.coordinates) return [parsed as unknown as Geometry];
  return [];
}

/** Load the India outline into wce.admin_country. */
export async function ingestCountry(
  pool: Pool,
  filePath = adminPath("soi_country", "india-composite.geojson"),
  opts: { truncate?: boolean } = {},
): Promise<number> {
  if (!fs.existsSync(filePath))
    throw new Error(`Country outline not found: ${filePath} — download india-composite.geojson first (Phase A).`);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AnyGeo;
  const geoms = extractGeometries(parsed);
  if (geoms.length === 0) throw new Error(`No geometries in ${filePath}`);
  return loadAdminCountry(pool, SOURCES.soi_country!, geoms, "India", { truncate: opts.truncate ?? true });
}

/** First non-empty property value across likely state-name keys. */
function stateName(props: Record<string, unknown> | null): string | undefined {
  if (!props) return undefined;
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(props)) lower[k.toLowerCase()] = props[k];
  for (const k of ["state", "st_nm", "state_name", "name", "stname", "state_ut"]) {
    const v = lower[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return undefined;
}

/** Read GeoJSON features from either a `.geojsonl` (line-delimited) or `.geojson` FC. */
function readFeatures(filePath: string): Feature[] {
  const text = fs.readFileSync(filePath, "utf8");
  if (/\.(geojsonl|jsonl|ndjson)$/i.test(filePath)) {
    const out: Feature[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim().replace(/,\s*$/, "");
      if (!t || t === "[" || t === "]") continue;
      try {
        out.push(JSON.parse(t) as Feature);
      } catch {
        /* skip bad line */
      }
    }
    return out;
  }
  return (JSON.parse(text) as { features?: Feature[] }).features ?? [];
}

/** Load state polygons into wce.admin_state (accepts `.geojsonl` or `.geojson`). */
export async function ingestStates(
  pool: Pool,
  filePath = adminPath("soi_states", "raw", "SOI_States.geojsonl"),
  opts: { truncate?: boolean } = {},
): Promise<number> {
  if (!fs.existsSync(filePath))
    throw new Error(
      `States file not found: ${filePath}\n` +
        `  Download india-geodata admin/states (SOI_States.geojsonl.7z) into data/by-source/soi_states/raw/ and extract.`,
    );
  const features = readFeatures(filePath)
    .filter((f) => f.geometry != null)
    .map((f) => ({ geometry: f.geometry as Geometry, state: stateName(f.properties), attrs: f.properties ?? {} }));
  return loadAdminStates(pool, SOURCES.soi_states!, features, { truncate: opts.truncate ?? true });
}
