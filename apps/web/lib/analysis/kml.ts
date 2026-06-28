import { kml } from "@tmcw/togeojson";
import { unzipSync, strFromU8 } from "fflate";
import {
  AOI_MAX_KM2,
  AOI_MIN_KM2,
  POINT_MODE_SQUARE_KM,
  ringAreaKm2,
  squareRingAround,
} from "./geometry";

/**
 * Client-side KML / KMZ → GeoJSON reading for the Analyze tool's file uploads.
 *
 * A KMZ is a ZIP whose main document is `doc.kml` (or, defensively, the first
 * `.kml` entry). KML is parsed with the browser's native DOMParser, then
 * @tmcw/togeojson maps it to GeoJSON.
 *
 * Two consumers build on `featureCollectionFromFile`:
 *  - `parseAoiFromFile` (here) flattens every polygon ring and picks the LARGEST
 *    by area as the AOI boundary — most site files carry one boundary, but mixed
 *    files (boundary + annotations) are common. A point-only file degrades to a
 *    5×5 km square around the point, mirroring the map's "point" draw mode so the
 *    server still fingerprints it as point-mode.
 *  - `parseLayoutFromFile` (lib/analysis/layout.ts) collects every POINT as an
 *    exact micro-sited turbine position.
 *
 * Cap/floor are checked here for a friendly message; the server re-validates
 * geometry (India bbox, self-intersection, exact area) authoritatively.
 */

/** Max upload size — boundary/layout files are tiny; guard junk. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

export class KmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmlParseError";
  }
}

export interface ParsedAoi {
  /** Closed lon/lat ring, ready for postAnalyze. */
  ring: [number, number][];
  areaKm2: number;
  /** True when the source was a bare point expanded to a 5×5 km square. */
  fromPoint: boolean;
}

/** Strip altitude / extra ordinates down to [lon, lat]. */
function toLonLat(position: number[]): [number, number] {
  return [position[0], position[1]];
}

/**
 * Walk any GeoJSON geometry, collecting each polygon's OUTER ring (lon/lat) and
 * any standalone point. Holes are ignored — the AOI is the outer boundary.
 */
function collectGeometry(
  geometry: GeoJSON.Geometry | null,
  rings: [number, number][][],
  points: [number, number][],
): void {
  if (!geometry) return;
  switch (geometry.type) {
    case "Polygon": {
      const outer = geometry.coordinates[0];
      if (outer && outer.length >= 4) rings.push(outer.map(toLonLat));
      return;
    }
    case "MultiPolygon": {
      for (const poly of geometry.coordinates) {
        const outer = poly[0];
        if (outer && outer.length >= 4) rings.push(outer.map(toLonLat));
      }
      return;
    }
    case "Point":
      points.push(toLonLat(geometry.coordinates));
      return;
    case "MultiPoint":
      for (const p of geometry.coordinates) points.push(toLonLat(p));
      return;
    case "GeometryCollection":
      for (const g of geometry.geometries) collectGeometry(g, rings, points);
      return;
    default:
      // LineString / MultiLineString: not a usable AOI boundary — skip.
      return;
  }
}

/** Parse raw KML text into a GeoJSON FeatureCollection. Throws on bad XML. */
function featureCollectionFromKmlText(kmlText: string): GeoJSON.FeatureCollection {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(kmlText, "application/xml");
  } catch {
    throw new KmlParseError("Could not read the KML — the file is not valid XML.");
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new KmlParseError("Could not read the KML — the file is not valid XML.");
  }
  try {
    return kml(doc) as GeoJSON.FeatureCollection;
  } catch {
    throw new KmlParseError("Could not convert the KML to a usable shape.");
  }
}

/** Pull the primary KML document text out of a KMZ archive. */
function kmlTextFromKmz(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new KmlParseError("Could not open the KMZ — it is not a valid archive.");
  }
  const names = Object.keys(entries);
  const docName =
    names.find((n) => n.toLowerCase() === "doc.kml") ??
    names.find((n) => n.toLowerCase().endsWith(".kml"));
  if (!docName) {
    throw new KmlParseError("The KMZ contains no .kml document.");
  }
  return strFromU8(entries[docName]);
}

/**
 * Read a user-selected .kml or .kmz File into a GeoJSON FeatureCollection.
 * Rejects oversized files and unsupported extensions. Shared by the boundary
 * (AOI) and turbine-layout parsers so the ZIP/XML handling lives in one place.
 */
export async function featureCollectionFromFile(
  file: File,
): Promise<GeoJSON.FeatureCollection> {
  if (file.size > MAX_FILE_BYTES) {
    throw new KmlParseError("File is too large (over 8 MB). Upload just the site data.");
  }
  const name = file.name.toLowerCase();
  const isKmz = name.endsWith(".kmz");
  const isKml = name.endsWith(".kml");
  if (!isKmz && !isKml) {
    throw new KmlParseError("Unsupported file — choose a .kml or .kmz file.");
  }
  if (isKmz) {
    const buf = new Uint8Array(await file.arrayBuffer());
    return featureCollectionFromKmlText(kmlTextFromKmz(buf));
  }
  return featureCollectionFromKmlText(await file.text());
}

/** Pick the largest polygon ring (or a 5×5 km square around a lone point). */
function ringFromFeatureCollection(fc: GeoJSON.FeatureCollection): ParsedAoi {
  const rings: [number, number][][] = [];
  const points: [number, number][] = [];
  for (const feature of fc.features ?? []) {
    collectGeometry(feature.geometry, rings, points);
  }

  if (rings.length === 0) {
    if (points.length > 0) {
      const [lon, lat] = points[0];
      const ring = squareRingAround(lon, lat, POINT_MODE_SQUARE_KM);
      return { ring, areaKm2: ringAreaKm2(ring), fromPoint: true };
    }
    throw new KmlParseError(
      "No polygon or point found in the file. Draw the site boundary in your KML editor and re-export.",
    );
  }

  // Largest outer ring wins — annotation polygons are smaller than the site.
  let best = rings[0];
  let bestArea = ringAreaKm2(best);
  for (let i = 1; i < rings.length; i++) {
    const area = ringAreaKm2(rings[i]);
    if (area > bestArea) {
      best = rings[i];
      bestArea = area;
    }
  }
  return { ring: best, areaKm2: bestArea, fromPoint: false };
}

/**
 * Parse a user-selected .kml or .kmz File into a validated AOI ring.
 * Rejects shapes outside the analysis area bounds.
 */
export async function parseAoiFromFile(file: File): Promise<ParsedAoi> {
  const fc = await featureCollectionFromFile(file);
  const parsed = ringFromFeatureCollection(fc);

  if (parsed.areaKm2 < AOI_MIN_KM2) {
    throw new KmlParseError(
      `Area is too small (${parsed.areaKm2.toFixed(2)} km²). The minimum is ${AOI_MIN_KM2} km².`,
    );
  }
  if (parsed.areaKm2 > AOI_MAX_KM2) {
    throw new KmlParseError(
      `Area is too large (${Math.round(parsed.areaKm2).toLocaleString()} km²). ` +
        `The maximum is ${AOI_MAX_KM2.toLocaleString()} km² — upload a smaller boundary.`,
    );
  }

  return parsed;
}
