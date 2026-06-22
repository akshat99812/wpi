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
 * Client-side KML / KMZ → AOI ring parsing for the Analyze tool's file upload.
 *
 * A KMZ is a ZIP whose main document is `doc.kml` (or, defensively, the first
 * `.kml` entry). KML is parsed with the browser's native DOMParser, then
 * @tmcw/togeojson maps it to GeoJSON. We flatten every polygon ring out of the
 * feature collection and pick the LARGEST by area as the AOI — most site files
 * carry one boundary, but mixed files (boundary + annotations) are common.
 *
 * A point-only file (a dropped pin with no polygon) degrades to a 5×5 km square
 * around the point, mirroring the map's "point" draw mode so the server still
 * fingerprints it as point-mode.
 *
 * Cap/floor are checked here for a friendly message; the server re-validates
 * geometry (India bbox, self-intersection, exact area) authoritatively.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB — boundary files are tiny; guard junk.

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

/** Parse raw KML text into the best AOI ring. Throws KmlParseError on failure. */
function ringFromKmlText(kmlText: string): ParsedAoi {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(kmlText, "application/xml");
  } catch {
    throw new KmlParseError("Could not read the KML — the file is not valid XML.");
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new KmlParseError("Could not read the KML — the file is not valid XML.");
  }

  let fc: GeoJSON.FeatureCollection;
  try {
    fc = kml(doc) as GeoJSON.FeatureCollection;
  } catch {
    throw new KmlParseError("Could not convert the KML to a usable shape.");
  }

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
 * Parse a user-selected .kml or .kmz File into a validated AOI ring.
 * Rejects oversized files and shapes outside the analysis area bounds.
 */
export async function parseAoiFromFile(file: File): Promise<ParsedAoi> {
  if (file.size > MAX_FILE_BYTES) {
    throw new KmlParseError("File is too large (over 8 MB). Upload just the site boundary.");
  }

  const name = file.name.toLowerCase();
  const isKmz = name.endsWith(".kmz");
  const isKml = name.endsWith(".kml");
  if (!isKmz && !isKml) {
    throw new KmlParseError("Unsupported file — choose a .kml or .kmz file.");
  }

  let parsed: ParsedAoi;
  if (isKmz) {
    const buf = new Uint8Array(await file.arrayBuffer());
    parsed = ringFromKmlText(kmlTextFromKmz(buf));
  } else {
    parsed = ringFromKmlText(await file.text());
  }

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
