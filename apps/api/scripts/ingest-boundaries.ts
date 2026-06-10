/**
 * Convert data/private/boundaries.kmz → data/private/boundaries.geojson.
 *
 * The source is a Google-Earth export: 152 wind-farm site-boundary polygons
 * grouped by state. KMZ is just a zip, so we extract doc.kml with the `unzip`
 * CLI, parse it with @tmcw/togeojson, keep only the polygon features, and write
 * a compact GeoJSON FeatureCollection.
 *
 * Re-run whenever the source KMZ changes:
 *   bun scripts/ingest-boundaries.ts
 */
import { kml } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import { $ } from 'bun';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..'); // apps/api
const KMZ = path.join(ROOT, 'data/private/boundaries.kmz');
const OUT = path.join(ROOT, 'data/private/boundaries.geojson');

const kmlText = await $`unzip -p ${KMZ} doc.kml`.text();

const dom = new DOMParser().parseFromString(kmlText, 'text/xml');

// The API tsconfig has no DOM lib, so type the bits we use locally instead of
// leaning on togeojson's DOM-typed signature / @types/geojson.
type Feat = { geometry: { type: string } | null };
const geo = kml(dom as never) as { type: 'FeatureCollection'; features: Feat[] };

geo.features = geo.features.filter(
  (f) =>
    f.geometry != null &&
    (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'),
);

if (geo.features.length === 0) {
  throw new Error('No polygon features found in boundaries.kmz');
}

await Bun.write(OUT, JSON.stringify(geo));
console.log(`Wrote ${geo.features.length} boundary features → ${OUT}`);
