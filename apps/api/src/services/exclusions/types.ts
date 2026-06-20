/**
 * Shared contract for the legal exclusion-zone pipeline (exclusion-plan.md).
 *
 * Every connector normalises its source into `NormalisedFeature[]` (EPSG:4326),
 * and `loader.ts` streams those into PostGIS (`wce.excl_polygon` / `infra_feature`).
 *
 * The API tsconfig ships no `@types/geojson` (and no DOM lib), so we declare the
 * minimal GeoJSON shapes we actually touch here rather than depending on globals.
 */

export type Position = number[]; // [lon, lat] (, elevation?)

export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

export type Feature = {
  type: "Feature";
  geometry: Geometry | null;
  properties: Record<string, unknown> | null;
};

export type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

/** red = hard exclusion · amber = verify-before-use flag. */
export type ExclClass = "red" | "amber";

/**
 * 1 gazette · 2 official govt GIS · 3 official aggregated open data
 * · 4 authoritative global third-party (reference only) · 5 community/OSM
 * · 6 derived/computed buffer · 7 indicative screening proxy.
 */
export type LegalTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The connector contract from the engine runbook. */
export type NormalisedFeature = {
  geometry: Geometry; // EPSG:4326
  layer_code: string;
  class: ExclClass;
  source_id: string;
  is_legal_boundary: boolean;
  attrs?: Record<string, unknown>; // name, notification_no, gazette_date, iucn, etc.
};

/** infra_feature.kind — inputs for dynamic setbacks + buffer derivations. */
export type InfraKind =
  | "road"
  | "rail"
  | "ehv"
  | "building"
  | "institution"
  | "airport";

export function isPolygonal(g: Geometry | null | undefined): boolean {
  if (!g) return false;
  if (g.type === "Polygon" || g.type === "MultiPolygon") return true;
  if (g.type === "GeometryCollection") return g.geometries.some(isPolygonal);
  return false;
}
