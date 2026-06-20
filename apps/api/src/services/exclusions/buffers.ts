/**
 * Buffer-derived legal zones (exclusion-plan.md Phase C). Each builder is
 * idempotent: it deletes its own derived source's rows, then re-derives. Runs
 * after the inputs exist (PA polygons for ESZ, ASI monument points, building
 * footprints for settlements).
 *
 * Geography buffering: cast geom→geography so ST_Buffer's distance is METRES,
 * not degrees. Then cast back to geometry(4326) for storage.
 */
import type { Pool } from "pg";
import { seedSource, SOURCES } from "./registry";

export type BufferResult = { rule: string; inserted: number };

async function resetBuffer(pool: Pool, sourceId: string): Promise<void> {
  await pool.query(`DELETE FROM wce.excl_buffer WHERE source_id = $1`, [sourceId]);
}

/**
 * C1 — ASI monument zones: 100 m prohibited (red) + 300 m regulated (amber),
 * buffered off institution points flagged attrs.asi=true.
 * is_legal_boundary stays false (buffer off a point — verify protected limit).
 */
export async function buildAsiBuffers(pool: Pool): Promise<BufferResult[]> {
  const def = SOURCES.derived_asi!;
  await seedSource(pool, def);
  await resetBuffer(pool, def.source_id);

  const r100 = await pool.query(
    `INSERT INTO wce.excl_buffer (source_id,layer_code,class,rule,geom,attrs)
     SELECT $1,'asi_prohibited_100m','red','asi_100m',
            ST_Multi(ST_Buffer(geom::geography,100)::geometry),
            jsonb_build_object('name', attrs->>'name', 'note','buffer off point — verify protected limit')
     FROM wce.infra_feature
     WHERE kind='institution' AND attrs->>'asi'='true'`,
    [def.source_id],
  );
  const r300 = await pool.query(
    `INSERT INTO wce.excl_buffer (source_id,layer_code,class,rule,geom,attrs)
     SELECT $1,'asi_regulated_300m','amber','asi_300m',
            ST_Multi(ST_Buffer(geom::geography,300)::geometry),
            jsonb_build_object('name', attrs->>'name', 'note','buffer off point — verify protected limit')
     FROM wce.infra_feature
     WHERE kind='institution' AND attrs->>'asi'='true'`,
    [def.source_id],
  );
  return [
    { rule: "asi_100m", inserted: r100.rowCount ?? 0 },
    { rule: "asi_300m", inserted: r300.rowCount ?? 0 },
  ];
}

/**
 * C2 — ESZ default 10 km (amber) around NP / WLS, as a ring OUTSIDE the PA,
 * skipping any PA that already has a notified ESZ (layer_code='esz_notified').
 * Notified ESZ (Phase D) supersedes this per-PA. is_legal_boundary=false.
 */
export async function buildEszDefault(pool: Pool): Promise<BufferResult[]> {
  const def = SOURCES.derived_esz!;
  await seedSource(pool, def);
  await resetBuffer(pool, def.source_id);

  const res = await pool.query(
    `INSERT INTO wce.excl_buffer (source_id,layer_code,class,rule,geom,attrs)
     SELECT $1,'esz_default_10km','amber','esz_10km',
            ST_Multi(ST_Difference(ST_Buffer(pa.geom::geography,10000)::geometry, pa.geom)),
            jsonb_build_object('pa_name', pa.attrs->>'name', 'pa_layer', pa.layer_code)
     FROM wce.excl_polygon pa
     WHERE pa.layer_code IN ('national_park','wildlife_sanctuary')
       AND NOT EXISTS (
         SELECT 1 FROM wce.excl_polygon e
         WHERE e.layer_code='esz_notified' AND ST_Intersects(e.geom, pa.geom))`,
    [def.source_id],
  );
  return [{ rule: "esz_10km", inserted: res.rowCount ?? 0 }];
}

/**
 * C3 — Settlement 500 m (red): DBSCAN-cluster building footprints (15+ per
 * cluster ≈ "inhabited"), convex-hull the cluster, buffer 500 m. eps≈150 m
 * (0.0015°) — tune per region. is_legal_boundary=false.
 */
export async function buildSettlementBuffers(
  pool: Pool,
  opts: { epsDeg?: number; minPoints?: number } = {},
): Promise<BufferResult[]> {
  const def = SOURCES.derived_settlement!;
  await seedSource(pool, def);
  await resetBuffer(pool, def.source_id);

  const eps = opts.epsDeg ?? 0.0015;
  const minPoints = opts.minPoints ?? 15;
  const res = await pool.query(
    `WITH clustered AS (
       SELECT ST_ClusterDBSCAN(geom, eps:=$2, minpoints:=$3) OVER () AS cid, geom
       FROM wce.infra_feature WHERE kind='building')
     INSERT INTO wce.excl_buffer (source_id,layer_code,class,rule,geom,attrs)
     SELECT $1,'settlement_500m','red','settlement_500m',
            ST_Multi(ST_Buffer(ST_ConvexHull(ST_Collect(geom))::geography,500)::geometry),
            jsonb_build_object('buildings', count(*))
     FROM clustered WHERE cid IS NOT NULL GROUP BY cid`,
    [def.source_id, eps, minPoints],
  );
  return [{ rule: "settlement_500m", inserted: res.rowCount ?? 0 }];
}

/** Run every buffer builder whose inputs exist. */
export async function buildAllBuffers(pool: Pool): Promise<BufferResult[]> {
  const out: BufferResult[] = [];
  out.push(...(await buildAsiBuffers(pool)));
  out.push(...(await buildEszDefault(pool)));
  out.push(...(await buildSettlementBuffers(pool)));
  return out;
}
