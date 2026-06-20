/**
 * india-geodata connectors — CRZ (coastal), wetlands (Ramsar + notified), and
 * forest (RF/PF legal vs FSI cover). Each maps a raw feature's attribute bag to
 * the right layer_code/class/is_legal_boundary per exclusion-plan.md §B.
 *
 * NOTE on attribute keys: india-geodata's exact property names aren't known
 * until the `.geojsonl` is downloaded and inspected. The classifiers read keys
 * case-insensitively across the likely candidates and fall back to a safe
 * default (amber, verify). After the first download, run the driver's
 * `inspect <source>` command, eyeball the keys, and tighten these maps.
 */
import path from "node:path";
import type { Pool } from "pg";
import { ingestPolygonFile } from "./geojsonl";
import type { LoadResult } from "../loader";
import { seedSource, SOURCES } from "../registry";
import type { Feature, NormalisedFeature } from "../types";

const ROOT = path.resolve(import.meta.dir, "../../../.."); // apps/api
export function rawDir(sourceId: string): string {
  return path.join(ROOT, "data/by-source", sourceId, "raw");
}

/** First matching property value (case-insensitive key), as a lowercased string. */
function prop(props: Record<string, unknown> | null, ...keys: string[]): string {
  if (!props) return "";
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(props)) lower[k.toLowerCase()] = props[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).toLowerCase();
  }
  return "";
}

// ── B1. CRZ ──────────────────────────────────────────────────────────────────
/**
 * CRZ-I family → crz_1 (red); everything else → crz_other (amber).
 * Real Bharatmaps_Parivesh_CRZ2019 categories: "CRZ - IA", "CRZ - IB", "ITZ-IB"
 * (intertidal, all CRZ-I → red) vs "CRZ - II", "No Development Zone", "CRZ - IVB"
 * (→ amber). Spaces are stripped before matching ("crz - ia" → "crz-ia"), and
 * the regex is anchored so "crz-ii"/"crz-ivb" are NOT misread as CRZ-I.
 */
export function crzMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  const cat = prop(feature.properties, "category", "zone", "crz_type", "zone_type", "class", "crz");
  const norm = cat.replace(/\s+/g, "");
  const red = /^crz-i[ab]?$/.test(norm) || norm === "itz-ib" || norm.includes("mangrove");
  return {
    geometry: feature.geometry,
    layer_code: red ? "crz_1" : "crz_other",
    class: red ? "red" : "amber",
    source_id: "crz",
    is_legal_boundary: true,
    attrs: { ...(feature.properties ?? {}), czmp: "2019" },
  };
}

export async function ingestCrz(pool: Pool, filePath: string, opts: { truncate?: boolean } = {}): Promise<LoadResult> {
  return ingestPolygonFile(pool, SOURCES.crz!, filePath, crzMapper, opts);
}

// ── B2b. Ramsar (dedicated file — every feature is a Ramsar wetland) ───────────
export function ramsarMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  return {
    geometry: feature.geometry,
    layer_code: "ramsar",
    class: "red",
    source_id: "wetlands",
    is_legal_boundary: true,
    attrs: { ...(feature.properties ?? {}), subset: "ramsar" },
  };
}

export async function ingestRamsar(pool: Pool, filePath: string, opts: { truncate?: boolean } = {}): Promise<LoadResult> {
  return ingestPolygonFile(pool, SOURCES.wetlands!, filePath, ramsarMapper, opts);
}

// ── B4b. GatiShakti protected areas (official NP/WLS) ──────────────────────────
function paLayerFromCategory(cat: string): string {
  if (cat.includes("national park")) return "national_park";
  if (cat.includes("tiger")) return "tiger_reserve_core";
  if (cat.includes("conservation reserve")) return "conservation_reserve";
  if (cat.includes("community reserve")) return "community_reserve";
  return "wildlife_sanctuary"; // "Sanctuary" default
}

export function gatiPaMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  const cat = prop(feature.properties, "category", "category1", "type");
  return {
    geometry: feature.geometry,
    layer_code: paLayerFromCategory(cat),
    class: "red",
    source_id: "gatishakti_pa",
    is_legal_boundary: true,
    attrs: { ...(feature.properties ?? {}) },
  };
}

export async function ingestGatiPa(pool: Pool, filePath: string, opts: { truncate?: boolean } = {}): Promise<LoadResult> {
  return ingestPolygonFile(pool, SOURCES.gatishakti_pa!, filePath, gatiPaMapper, opts);
}

// ── Notified ESZ (published GIS — supersedes the default 10 km buffer) ─────────
export function eszMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  return {
    geometry: feature.geometry,
    layer_code: "esz_notified",
    class: "amber",
    source_id: "esz_notified",
    is_legal_boundary: true,
    attrs: { ...(feature.properties ?? {}) },
  };
}

export async function ingestEsz(pool: Pool, filePath: string, opts: { truncate?: boolean } = {}): Promise<LoadResult> {
  return ingestPolygonFile(pool, SOURCES.esz_notified!, filePath, eszMapper, opts);
}

// ── B2. Wetlands ──────────────────────────────────────────────────────────────
/** Ramsar-designated → ramsar; PARIVESH notified → wetland_notified; SOI inventory → screening. */
export function wetlandMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  const ramsar = prop(feature.properties, "ramsar", "ramsar_site", "is_ramsar", "designation");
  const src = prop(feature.properties, "source", "src", "origin", "type", "category");
  const isRamsar = ramsar.includes("ramsar") || ramsar === "yes" || ramsar === "true" || src.includes("ramsar");
  const isInventory = src.includes("soi") || src.includes("inventory") || src.includes("salt") || src.includes("swamp");
  if (isRamsar) {
    return {
      geometry: feature.geometry,
      layer_code: "ramsar",
      class: "red",
      source_id: "wetlands",
      is_legal_boundary: true,
      attrs: { ...(feature.properties ?? {}), subset: "ramsar" },
    };
  }
  return {
    geometry: feature.geometry,
    layer_code: "wetland_notified",
    class: "red",
    source_id: "wetlands",
    is_legal_boundary: !isInventory, // notified set = legal; SOI inventory = screening
    attrs: { ...(feature.properties ?? {}), subset: isInventory ? "inventory" : "notified" },
  };
}

export async function ingestWetlands(pool: Pool, filePath: string, opts: { truncate?: boolean } = {}): Promise<LoadResult> {
  return ingestPolygonFile(pool, SOURCES.wetlands!, filePath, wetlandMapper, opts);
}

// ── B3. Forest ────────────────────────────────────────────────────────────────
/** GatiShakti/SOI RF/PF → forest_legal (red, legal); FSI cover → forest_cover (screening). */
export function forestMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  const src = prop(feature.properties, "source", "src", "origin", "dataset", "layer");
  const cls = prop(feature.properties, "class", "forest_class", "category", "type");
  const isCover = src.includes("fsi") || cls.includes("cover") || cls.includes("density");
  if (isCover) {
    return {
      geometry: feature.geometry,
      layer_code: "forest_cover",
      class: "amber",
      source_id: "forest_cover",
      is_legal_boundary: false, // cover ≠ legal forest
      attrs: { ...(feature.properties ?? {}), kind: "fsi_cover" },
    };
  }
  return {
    geometry: feature.geometry,
    layer_code: "forest_legal",
    class: "red",
    source_id: "forest_legal",
    is_legal_boundary: true, // RF/PF reserve/protected forest boundary
    attrs: { ...(feature.properties ?? {}), kind: "rf_pf" },
  };
}

/**
 * The forest file mixes legal RF/PF and FSI cover, so it routes per-feature to
 * two source_ids. Seed + truncate BOTH up front, then stream with truncate off
 * (loadPolygons would otherwise only clear forest_legal).
 */
export async function ingestForest(pool: Pool, filePath: string, opts: { truncate?: boolean } = {}): Promise<LoadResult> {
  await seedSource(pool, SOURCES.forest_legal!);
  await seedSource(pool, SOURCES.forest_cover!);
  if (opts.truncate ?? true) {
    await pool.query(`DELETE FROM wce.excl_polygon WHERE source_id IN ('forest_legal','forest_cover')`);
  }
  return ingestPolygonFile(pool, SOURCES.forest_legal!, filePath, forestMapper, { truncate: false });
}

// ── B3b. Bharatmaps RFA (Recorded Forest Area — legal, own source) ────────────
export function rfaMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  return {
    geometry: feature.geometry,
    layer_code: "forest_legal",
    class: "red",
    source_id: "bharatmaps_rfa",
    is_legal_boundary: true,
    attrs: { ...(feature.properties ?? {}), kind: "rfa" },
  };
}

export async function ingestRfa(pool: Pool, filePath: string, opts: { truncate?: boolean } = {}): Promise<LoadResult> {
  return ingestPolygonFile(pool, SOURCES.bharatmaps_rfa!, filePath, rfaMapper, opts);
}

// ── B2c. National Wetland Atlas inventory (screening only, is_legal=false) ─────
export function wetlandInventoryMapper(feature: Feature): NormalisedFeature | null {
  if (!feature.geometry) return null;
  return {
    geometry: feature.geometry,
    layer_code: "wetland_inventory",
    class: "amber",
    source_id: "wetland_inventory",
    is_legal_boundary: false, // inventory ≠ notified legal wetland
    attrs: { ...(feature.properties ?? {}), kind: "nwai_inventory" },
  };
}

export async function ingestWetlandInventory(
  pool: Pool,
  filePath: string,
  opts: { truncate?: boolean } = {},
): Promise<LoadResult> {
  return ingestPolygonFile(pool, SOURCES.wetland_inventory!, filePath, wetlandInventoryMapper, opts);
}
