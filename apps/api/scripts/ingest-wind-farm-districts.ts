/**
 * Load data/wind-farm-districts.geojson → PostGIS `wind_farm_districts`.
 *
 * The GeoJSON is produced by scripts/build-wind-farms.py: one Polygon /
 * MultiPolygon per WT-MARUT district that we could confidently match to a GADM
 * boundary, carrying the district's summed installed capacity (MW) + turbine
 * count (WEG). These polygons are what /api/turbine/:id point-in-polygon-joins
 * against to tell a clicked OSM turbine which wind-farm cluster it belongs to.
 *
 * Idempotent: TRUNCATE + INSERT inside one transaction, so the table is either
 * fully replaced or untouched (never left half-loaded). Re-run after a rebuild:
 *
 *   bun run apps/api/scripts/ingest-wind-farm-districts.ts
 *
 * Requires migration 005_wind_farm_districts.sql to have been applied first.
 */
import { pool } from "../src/lib/db";
import path from "node:path";

interface FarmFeature {
  type: "Feature";
  properties: {
    district: string;
    name: string;
    state: string;
    capacityMW: number;
    weg: number;
    variants: string[];
  };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

const GEOJSON = path.join(import.meta.dir, "..", "data", "wind-farm-districts.geojson");

async function main() {
  const raw = await Bun.file(GEOJSON).json();
  const features: FarmFeature[] = raw?.features ?? [];

  if (!Array.isArray(features) || features.length === 0) {
    throw new Error(`No features in ${GEOJSON} — run build-wind-farms.py first`);
  }

  // Validate every feature at the boundary before touching the DB (fail fast,
  // never load a row with a missing name / NaN capacity / wrong geometry type).
  for (const f of features) {
    const p = f.properties;
    if (!p?.district || !p.name || !p.state) {
      throw new Error(`Feature missing district/name/state: ${JSON.stringify(p)}`);
    }
    if (!Number.isFinite(p.capacityMW) || p.capacityMW < 0) {
      throw new Error(`Bad capacityMW for ${p.district}: ${p.capacityMW}`);
    }
    if (!Number.isInteger(p.weg) || p.weg < 0) {
      throw new Error(`Bad weg for ${p.district}: ${p.weg}`);
    }
    if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") {
      throw new Error(`${p.district} is not a (Multi)Polygon: ${f.geometry?.type}`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE wind_farm_districts");

    for (const f of features) {
      const p = f.properties;
      await client.query(
        `
        INSERT INTO wind_farm_districts
          (district, name, state, capacity_mw, weg, variants, geom)
        VALUES (
          $1, $2, $3, $4, $5, $6,
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))
        )
        `,
        [
          p.district,
          p.name,
          p.state,
          p.capacityMW,
          p.weg,
          p.variants ?? [],
          JSON.stringify(f.geometry),
        ],
      );
    }

    await client.query("COMMIT");

    const { rows } = await client.query(
      "SELECT count(*)::int AS n, round(sum(capacity_mw))::int AS mw, sum(weg)::int AS weg FROM wind_farm_districts",
    );
    console.log(
      `[wind-farm-districts] loaded ${rows[0].n} districts · ${rows[0].mw} MW · ${rows[0].weg} WEG`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("[wind-farm-districts] ingest failed:", err);
    await pool.end();
    process.exit(1);
  });
