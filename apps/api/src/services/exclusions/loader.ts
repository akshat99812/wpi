/**
 * Loader — streams NormalisedFeature[] into PostGIS (the connector→DB step of
 * the engine runbook). Always seeds the `source_registry` row first (the FK
 * requires it), then batch-inserts.
 *
 * Geometry hygiene at insert time:
 *   ST_GeomFromGeoJSON → ST_MakeValid → ST_CollectionExtract(...,3) → ST_Multi
 * so a self-intersecting polygon or a GeometryCollection from MakeValid still
 * lands as a clean MultiPolygon. Rows MakeValid reduces to empty are dropped.
 */
import type { Pool } from "pg";
import { seedSource, type SourceDef } from "./registry";
import { isPolygonal, type InfraKind, type NormalisedFeature } from "./types";

const BATCH_SIZE = 200; // features per multi-row INSERT (5 params each → 1000 params)

export type LoadResult = {
  source_id: string;
  inserted: number;
  skipped: number;
};

/** Build the `VALUES (...)` placeholder list + flat params for a polygon batch. */
function polygonValues(features: NormalisedFeature[]): { values: string; params: unknown[]; skipped: number } {
  const rows: string[] = [];
  const params: unknown[] = [];
  let p = 0;
  let skipped = 0;
  for (const f of features) {
    if (!isPolygonal(f.geometry)) {
      skipped++;
      continue;
    }
    rows.push(`($${++p},$${++p},$${++p},$${++p}::text,$${++p}::jsonb)`);
    params.push(
      f.source_id,
      f.layer_code,
      f.class,
      JSON.stringify(f.geometry),
      JSON.stringify({ ...(f.attrs ?? {}), is_legal_boundary: f.is_legal_boundary }),
    );
  }
  return { values: rows.join(","), params, skipped };
}

/**
 * Clean + insert a batch. Geometry is validated and multified ONCE in an inner
 * SELECT, empties are filtered, then geohash is computed on what survives.
 */
async function insertPolygonBatch(pool: Pool, values: string, params: unknown[]): Promise<number> {
  if (!values) return 0;
  const sql = `
    INSERT INTO wce.excl_polygon (source_id, layer_code, class, geom, attrs, geohash)
    SELECT source_id, layer_code, class, g, attrs, ST_GeoHash(ST_PointOnSurface(g), 12)
    FROM (
      SELECT source_id, layer_code, class, attrs,
             ST_Force2D(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(geojson)), 3))) AS g
      FROM ( VALUES ${values} ) AS v(source_id, layer_code, class, geojson, attrs)
    ) cleaned
    WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)`;
  const res = await pool.query(sql, params);
  return res.rowCount ?? 0;
}

/**
 * Load polygonal exclusion features. Non-polygonal geometries are skipped (an
 * exclusion zone is an area). class/is_legal_boundary come from the feature, not
 * the source default, so connectors can flag a notified subset.
 */
export async function loadPolygons(
  pool: Pool,
  def: SourceDef,
  features: NormalisedFeature[],
  opts: { truncate?: boolean } = {},
): Promise<LoadResult> {
  await seedSource(pool, def);
  if (opts.truncate) await pool.query(`DELETE FROM wce.excl_polygon WHERE source_id = $1`, [def.source_id]);

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const { values, params, skipped: s } = polygonValues(features.slice(i, i + BATCH_SIZE));
    const n = await insertPolygonBatch(pool, values, params);
    inserted += n;
    skipped += s;
  }
  return { source_id: def.source_id, inserted, skipped };
}

/** Load infra inputs (points/lines/polys) for dynamic setbacks + buffer inputs. */
export async function loadInfra(
  pool: Pool,
  def: SourceDef,
  kind: InfraKind,
  features: { geometry: NormalisedFeature["geometry"] | null; attrs?: Record<string, unknown> }[],
  opts: { truncate?: boolean } = {},
): Promise<LoadResult> {
  await seedSource(pool, def);
  if (opts.truncate)
    await pool.query(`DELETE FROM wce.infra_feature WHERE source_id=$1 AND kind=$2`, [def.source_id, kind]);

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);
    const rows: string[] = [];
    const params: unknown[] = [];
    let p = 0;
    for (const f of batch) {
      if (!f.geometry) {
        skipped++;
        continue;
      }
      rows.push(`($${++p},$${++p},ST_Force2D(ST_MakeValid(ST_GeomFromGeoJSON($${++p}))),$${++p}::jsonb)`);
      params.push(def.source_id, kind, JSON.stringify(f.geometry), JSON.stringify(f.attrs ?? {}));
    }
    if (rows.length === 0) continue;
    const res = await pool.query(
      `INSERT INTO wce.infra_feature (source_id,kind,geom,attrs) VALUES ${rows.join(",")}`,
      params,
    );
    inserted += res.rowCount ?? 0;
  }
  return { source_id: def.source_id, inserted, skipped };
}

/** Load the country clip mask (one row per polygonal geometry; dissolve later). */
export async function loadAdminCountry(
  pool: Pool,
  def: SourceDef,
  geometries: NormalisedFeature["geometry"][],
  name = "India",
  opts: { truncate?: boolean } = {},
): Promise<number> {
  await seedSource(pool, def);
  if (opts.truncate) await pool.query(`DELETE FROM wce.admin_country`);
  let inserted = 0;
  for (const g of geometries) {
    if (!isPolygonal(g)) continue;
    const res = await pool.query(
      `INSERT INTO wce.admin_country (name,geom)
       VALUES ($1, ST_Force2D(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($2)),3))))`,
      [name, JSON.stringify(g)],
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

/** Load state polygons for tagging/clipping. */
export async function loadAdminStates(
  pool: Pool,
  def: SourceDef,
  features: { geometry: NormalisedFeature["geometry"]; state?: string; attrs?: Record<string, unknown> }[],
  opts: { truncate?: boolean } = {},
): Promise<number> {
  await seedSource(pool, def);
  if (opts.truncate) await pool.query(`DELETE FROM wce.admin_state`);
  let inserted = 0;
  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);
    const rows: string[] = [];
    const params: unknown[] = [];
    let p = 0;
    for (const f of batch) {
      if (!isPolygonal(f.geometry)) continue;
      rows.push(`($${++p}, ST_Force2D(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($${++p})),3))), $${++p}::jsonb)`);
      params.push(f.state ?? null, JSON.stringify(f.geometry), JSON.stringify(f.attrs ?? {}));
    }
    if (rows.length === 0) continue;
    const res = await pool.query(
      `INSERT INTO wce.admin_state (state,geom,attrs) VALUES ${rows.join(",")}`,
      params,
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}
