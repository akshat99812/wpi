/**
 * Bake the legal exclusion-zone PMTiles pyramid served by routes/exclusions.ts.
 *
 * The wce.* corpus (721k polygons, incl. 422k RFA forest compartments) is static
 * between quarterly re-ingests, so we pre-generate the whole tile pyramid once
 * with tippecanoe instead of generating tiles live per request. tippecanoe's
 * --drop-densest-as-needed / --coalesce-smallest-as-needed do proper low-zoom
 * generalization (far better than a SQL feature cap).
 *
 * Re-run after any ingest-exclusions.ts change:
 *   bun run apps/api/scripts/bake-exclusions-pmtiles.ts
 *
 * Requires: psql + tippecanoe on PATH; DATABASE_URL in env (Bun loads .env).
 */
import { $ } from "bun";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, ".."); // apps/api
const OUT_DIR = path.join(ROOT, "data/by-source");
const GEOJSONL = path.join(OUT_DIR, "exclusions.geojsonl");
const PMTILES = path.join(OUT_DIR, "exclusions.pmtiles");

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("✗ DATABASE_URL not set");
  process.exit(1);
}

// One GeoJSON Feature per row; props kept tiny (lc/cls/legal/src/kind). 6-dp
// geometry (~0.1 m) keeps the export small without visible loss.
const COPY_SQL = `\\copy (
  SELECT json_build_object('type','Feature','geometry',ST_AsGeoJSON(geom,5)::json,
    'properties',json_build_object('lc',layer_code,'cls',class,
      'legal',COALESCE((attrs->>'is_legal_boundary')::boolean,false),'src',source_id,'kind','zone'))::text
  FROM wce.excl_polygon
  UNION ALL
  SELECT json_build_object('type','Feature','geometry',ST_AsGeoJSON(geom,5)::json,
    'properties',json_build_object('lc',layer_code,'cls',class,'legal',false,'src',source_id,'kind','buffer'))::text
  FROM wce.excl_buffer
) TO STDOUT`;

console.log("[bake] exporting features → geojsonl…");
await $`psql ${DB} -v ON_ERROR_STOP=1 -c ${COPY_SQL} > ${GEOJSONL}`;

// -Z4 so zones still show when zoomed out to the map's min zoom (MAST_MIN_ZOOM=4);
// --coalesce-smallest-as-needed merges dense features into visible regions at low z.
console.log("[bake] tippecanoe → exclusions.pmtiles (z4–14)…");
await $`tippecanoe -o ${PMTILES} -l exclusions -Z4 -z14 \
  --drop-densest-as-needed --coalesce-smallest-as-needed --extend-zooms-if-still-dropping \
  --simplification=10 --force ${GEOJSONL}`;

await $`rm -f ${GEOJSONL}`;
console.log(`✓ baked ${PMTILES}`);
