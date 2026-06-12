/**
 * Phase 0 probe — power vector-tile decode spike (plan §4/Phase 0 item 4).
 *
 * Proves we can server-side-decode OpenInfraMap MVT tiles (the same tiles
 * our /api/tiles/power proxy serves), extract transmission lines +
 * substations with voltage, and compute a correct nearest-distance — before
 * Phase 2 builds grid.ts on this.
 *
 * Run: bun apps/api/scripts/probes/power_decode.ts
 *
 * Throwaway but re-runnable. Fetches DIRECTLY from upstream
 * openinframap.org (the local API server may not be running). Verifies the
 * tile-derived nearest substation against Overpass (same underlying OSM
 * data).
 */

// pbf v5 dropped the default export — the reader class is `PbfReader`.
import { PbfReader } from "pbf";
import { VectorTile } from "@mapbox/vector-tile";

// ── Reference point + probe geometry ─────────────────────────────────────
const REF_LAT = 8.26; // Muppandal wind corridor
const REF_LON = 77.55;
const BOX_HALF_KM = 15; // ~30 km box around the point
const DECODE_ZOOM = 10;
const LOW_ZOOM = 7; // compare feature classes at low zoom
const OVERPASS_RADIUS_M = 25_000;
const AGREEMENT_TOLERANCE_KM = 1.5;

const UPSTREAM_BASE = "https://openinframap.org/map/power";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "wce-analysis-probe";
const FETCH_TIMEOUT_MS = 20_000;

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

// ── Tile math (WebMercator XYZ) ──────────────────────────────────────────
interface TileCoord {
  z: number;
  x: number;
  y: number;
}

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number): number {
  const r = lat * DEG;
  return (
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
  );
}

/** Tiles covering a [west, south, east, north] bbox at zoom z. */
function tileCover(bbox: [number, number, number, number], z: number): TileCoord[] {
  const [west, south, east, north] = bbox;
  const xMin = Math.floor(lonToTileX(west, z));
  const xMax = Math.floor(lonToTileX(east, z));
  const yMin = Math.floor(latToTileY(north, z)); // y grows southward
  const yMax = Math.floor(latToTileY(south, z));
  const tiles: TileCoord[] = [];
  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

function boxAround(lat: number, lon: number, halfKm: number): [number, number, number, number] {
  const dLat = halfKm / 110.574;
  const dLon = halfKm / (111.32 * Math.cos(lat * DEG));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

// ── Distance helpers ─────────────────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Point-to-segment distance in km. Projects to a local tangent plane
 * (equirectangular about the reference point — accurate at <100 km scales),
 * clamps the projection parameter, and measures planar distance.
 */
function pointToSegmentKm(
  refLat: number,
  refLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const cosRef = Math.cos(refLat * DEG);
  const toXY = (lat: number, lon: number): [number, number] => [
    (lon - refLon) * DEG * cosRef * EARTH_RADIUS_KM,
    (lat - refLat) * DEG * EARTH_RADIUS_KM,
  ];
  const [ax, ay] = toXY(aLat, aLon);
  const [bx, by] = toXY(bLat, bLon);
  const dx = bx - ax;
  const dy = by - ay;
  const segLenSq = dx * dx + dy * dy;
  const t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / segLenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

// ── Voltage parsing ──────────────────────────────────────────────────────
/**
 * Tile `voltage` is kV: NUMBER on power_line, STRING like
 * "220.0000000000000000" on power_substation_point. Defensively also handle
 * semicolon-joined multi-voltage strings ("400;220") → max. Missing/zero →
 * null (feature is KEPT — plan hard rule).
 */
function parseVoltageKv(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const parts = String(raw)
    .split(";")
    .map((p) => Number.parseFloat(p))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return null;
  return Math.max(...parts);
}

// ── Tile fetch + decode ──────────────────────────────────────────────────
async function fetchTile(t: TileCoord): Promise<VectorTile | null> {
  const url = `${UPSTREAM_BASE}/${t.z}/${t.x}/${t.y}.pbf`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null; // empty tile
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  // Bun fetch auto-decompresses the gzip body → identity-encoded protobuf.
  const buf = new Uint8Array(await res.arrayBuffer());
  return new VectorTile(new PbfReader(buf));
}

// ── Feature extraction ───────────────────────────────────────────────────
interface ExtractedLine {
  coords: [number, number][][]; // one or more line parts, [lon, lat]
  voltageKv: number | null;
  voltageRaw: unknown;
  name: string | null;
  tile: string;
}

interface ExtractedSubstation {
  lon: number;
  lat: number;
  kind: "point" | "polygon-centroid";
  voltageKv: number | null;
  voltageRaw: unknown;
  name: string | null;
  tile: string;
}

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

function lineParts(geom: GeoJsonGeometry): [number, number][][] {
  if (geom.type === "LineString") return [geom.coordinates as [number, number][]];
  if (geom.type === "MultiLineString") return geom.coordinates as [number, number][][];
  return [];
}

function ringCentroid(ring: [number, number][]): [number, number] {
  // Vertex average — fine for the spike (substation footprints are tiny).
  const n = ring.length;
  const sum = ring.reduce<[number, number]>(
    (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
    [0, 0],
  );
  return [sum[0] / n, sum[1] / n];
}

function pointLike(geom: GeoJsonGeometry): { lon: number; lat: number; kind: ExtractedSubstation["kind"] } | null {
  if (geom.type === "Point") {
    const [lon, lat] = geom.coordinates as [number, number];
    return { lon, lat, kind: "point" };
  }
  if (geom.type === "MultiPoint") {
    const first = (geom.coordinates as [number, number][])[0];
    if (!first) return null;
    const [lon, lat] = first;
    return { lon, lat, kind: "point" };
  }
  if (geom.type === "Polygon") {
    const outer = (geom.coordinates as [number, number][][])[0];
    if (!outer) return null;
    const [lon, lat] = ringCentroid(outer);
    return { lon, lat, kind: "polygon-centroid" };
  }
  if (geom.type === "MultiPolygon") {
    const outer = (geom.coordinates as [number, number][][][])[0]?.[0];
    if (!outer) return null;
    const [lon, lat] = ringCentroid(outer);
    return { lon, lat, kind: "polygon-centroid" };
  }
  return null;
}

const LINE_LAYER = "power_line";
const SUBSTATION_LAYERS = ["power_substation_point", "power_substation"];

interface TileScan {
  layerCounts: Record<string, number>;
  lines: ExtractedLine[];
  substations: ExtractedSubstation[];
}

function scanTile(vt: VectorTile, t: TileCoord): TileScan {
  const layerCounts: Record<string, number> = {};
  const lines: ExtractedLine[] = [];
  const substations: ExtractedSubstation[] = [];
  const tileId = `${t.z}/${t.x}/${t.y}`;

  for (const [name, layer] of Object.entries(vt.layers)) {
    layerCounts[name] = layer.length;
  }

  const lineLayer = vt.layers[LINE_LAYER];
  if (lineLayer) {
    for (let i = 0; i < lineLayer.length; i += 1) {
      const f = lineLayer.feature(i);
      const geom = f.toGeoJSON(t.x, t.y, t.z).geometry as GeoJsonGeometry;
      const parts = lineParts(geom);
      if (parts.length === 0) continue;
      const props = f.properties as Record<string, unknown>;
      lines.push({
        coords: parts,
        voltageKv: parseVoltageKv(props.voltage),
        voltageRaw: props.voltage ?? null,
        name: typeof props.name === "string" && props.name ? props.name : null,
        tile: tileId,
      });
    }
  }

  for (const layerName of SUBSTATION_LAYERS) {
    const layer = vt.layers[layerName];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i += 1) {
      const f = layer.feature(i);
      const geom = f.toGeoJSON(t.x, t.y, t.z).geometry as GeoJsonGeometry;
      const pt = pointLike(geom);
      if (!pt) continue;
      const props = f.properties as Record<string, unknown>;
      substations.push({
        lon: pt.lon,
        lat: pt.lat,
        kind: layerName === "power_substation" ? "polygon-centroid" : pt.kind,
        voltageKv: parseVoltageKv(props.voltage),
        voltageRaw: props.voltage ?? null,
        name: typeof props.name === "string" && props.name ? props.name : null,
        tile: tileId,
      });
    }
  }

  return { layerCounts, lines, substations };
}

// ── Nearest computations ─────────────────────────────────────────────────
function nearestLine(lines: ExtractedLine[]): { line: ExtractedLine; distanceKm: number } | null {
  let best: { line: ExtractedLine; distanceKm: number } | null = null;
  for (const line of lines) {
    for (const part of line.coords) {
      for (let i = 0; i < part.length - 1; i += 1) {
        const segStart = part[i];
        const segEnd = part[i + 1];
        if (!segStart || !segEnd) continue;
        const d = pointToSegmentKm(
          REF_LAT, REF_LON,
          segStart[1], segStart[0],
          segEnd[1], segEnd[0],
        );
        if (!best || d < best.distanceKm) best = { line, distanceKm: d };
      }
    }
  }
  return best;
}

function nearestSubstation(
  subs: ExtractedSubstation[],
): { sub: ExtractedSubstation; distanceKm: number } | null {
  let best: { sub: ExtractedSubstation; distanceKm: number } | null = null;
  for (const sub of subs) {
    const d = haversineKm(REF_LAT, REF_LON, sub.lat, sub.lon);
    if (!best || d < best.distanceKm) best = { sub, distanceKm: d };
  }
  return best;
}

// ── Overpass independent verification ────────────────────────────────────
interface OverpassSubstation {
  name: string | null;
  lat: number;
  lon: number;
  voltageRaw: string | null;
  osmType: string;
  osmId: number;
}

async function fetchOverpassSubstations(): Promise<OverpassSubstation[]> {
  const query = `
[out:json][timeout:60];
(
  node["power"="substation"](around:${OVERPASS_RADIUS_M},${REF_LAT},${REF_LON});
  way["power"="substation"](around:${OVERPASS_RADIUS_M},${REF_LAT},${REF_LON});
  relation["power"="substation"](around:${OVERPASS_RADIUS_M},${REF_LAT},${REF_LON});
);
out center tags;
`;
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const json = (await res.json()) as {
    elements: Array<{
      type: string;
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };
  return json.elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) return null;
      return {
        name: el.tags?.name ?? null,
        lat,
        lon,
        voltageRaw: el.tags?.voltage ?? null,
        osmType: el.type,
        osmId: el.id,
      };
    })
    .filter((s): s is OverpassSubstation => s !== null);
}

// ── Reporting helpers ────────────────────────────────────────────────────
function round(n: number, dp = 3): number {
  return Math.round(n * 10 ** dp) / 10 ** dp;
}

function voltageHistogram(lines: ExtractedLine[]): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const l of lines) {
    const key = l.voltageKv === null ? "null" : String(l.voltageKv);
    hist[key] = (hist[key] ?? 0) + 1;
  }
  return hist;
}

async function scanZoom(z: number): Promise<{
  tiles: string[];
  emptyTiles: string[];
  layerCounts: Record<string, number>;
  lines: ExtractedLine[];
  substations: ExtractedSubstation[];
}> {
  const bbox = boxAround(REF_LAT, REF_LON, BOX_HALF_KM);
  const cover = tileCover(bbox, z);
  const layerCounts: Record<string, number> = {};
  const lines: ExtractedLine[] = [];
  const substations: ExtractedSubstation[] = [];
  const emptyTiles: string[] = [];

  for (const t of cover) {
    const vt = await fetchTile(t);
    if (!vt) {
      emptyTiles.push(`${t.z}/${t.x}/${t.y}`);
      continue;
    }
    const scan = scanTile(vt, t);
    for (const [name, count] of Object.entries(scan.layerCounts)) {
      layerCounts[name] = (layerCounts[name] ?? 0) + count;
    }
    lines.push(...scan.lines);
    substations.push(...scan.substations);
  }

  return {
    tiles: cover.map((t) => `${t.z}/${t.x}/${t.y}`),
    emptyTiles,
    layerCounts,
    lines,
    substations,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`Probe point: Muppandal ${REF_LAT} N, ${REF_LON} E`);
  console.log(`Tile source: upstream ${UPSTREAM_BASE}/{z}/{x}/{y}.pbf (direct; local proxy not assumed running)\n`);

  // 1. Decode at the working zoom.
  const main10 = await scanZoom(DECODE_ZOOM);
  console.log(`── z${DECODE_ZOOM} cover (${main10.tiles.length} tiles): ${main10.tiles.join(", ")}`);
  if (main10.emptyTiles.length > 0) console.log(`   empty (404): ${main10.emptyTiles.join(", ")}`);
  console.log(`   layer feature counts (summed across tiles; features clipped at tile borders may be counted twice):`);
  console.log(`   ${JSON.stringify(main10.layerCounts)}`);
  console.log(`   power lines extracted: ${main10.lines.length}, voltage histogram (kV): ${JSON.stringify(voltageHistogram(main10.lines))}`);
  console.log(`   substations extracted: ${main10.substations.length} (kinds: ${JSON.stringify(main10.substations.reduce<Record<string, number>>((a, s) => ({ ...a, [s.kind]: (a[s.kind] ?? 0) + 1 }), {}))})`);

  const sampleLine = main10.lines.find((l) => l.voltageKv !== null);
  if (sampleLine) {
    console.log(`   sample line voltage raw value: ${JSON.stringify(sampleLine.voltageRaw)} (type ${typeof sampleLine.voltageRaw}) → ${sampleLine.voltageKv} kV`);
  }
  const sampleSub = main10.substations.find((s) => s.voltageKv !== null);
  if (sampleSub) {
    console.log(`   sample substation voltage raw value: ${JSON.stringify(sampleSub.voltageRaw)} (type ${typeof sampleSub.voltageRaw}) → ${sampleSub.voltageKv} kV`);
  }
  const nullVoltageLines = main10.lines.filter((l) => l.voltageKv === null).length;
  const nullVoltageSubs = main10.substations.filter((s) => s.voltageKv === null).length;
  console.log(`   missing-voltage features KEPT with voltageKv=null: lines=${nullVoltageLines}, substations=${nullVoltageSubs}`);

  // 2. Nearest line + substation from the reference point.
  const nl = nearestLine(main10.lines);
  const ns = nearestSubstation(main10.substations);
  console.log(`\n── Nearest from reference point`);
  if (nl) {
    console.log(`   line: ${nl.line.voltageKv ?? "unknown"} kV${nl.line.name ? ` "${nl.line.name}"` : ""} @ ${round(nl.distanceKm)} km (tile ${nl.line.tile})`);
  } else {
    console.log(`   line: NONE FOUND`);
  }
  if (ns) {
    console.log(`   substation: ${ns.sub.name ?? "(unnamed)"} ${ns.sub.voltageKv ?? "unknown"} kV @ ${round(ns.distanceKm)} km [${ns.sub.kind}] (${round(ns.sub.lat, 5)}, ${round(ns.sub.lon, 5)}) (tile ${ns.sub.tile})`);
  } else {
    console.log(`   substation: NONE FOUND`);
  }

  // 3. Low-zoom comparison (which classes survive at z7?).
  const low = await scanZoom(LOW_ZOOM);
  console.log(`\n── z${LOW_ZOOM} cover (${low.tiles.length} tiles): ${low.tiles.join(", ")}`);
  console.log(`   layer feature counts: ${JSON.stringify(low.layerCounts)}`);
  console.log(`   line voltage histogram (kV): ${JSON.stringify(voltageHistogram(low.lines))}`);
  console.log(`   substations: ${low.substations.length}`);

  // 4. Independent Overpass verification of the nearest substation.
  console.log(`\n── Overpass verification (power=substation within ${OVERPASS_RADIUS_M / 1000} km)`);
  let verification: {
    method: string;
    agreed: boolean;
    detail: string;
  };
  try {
    const overpassSubs = await fetchOverpassSubstations();
    console.log(`   overpass returned ${overpassSubs.length} substations`);
    let bestOp: { sub: OverpassSubstation; distanceKm: number } | null = null;
    for (const sub of overpassSubs) {
      const d = haversineKm(REF_LAT, REF_LON, sub.lat, sub.lon);
      if (!bestOp || d < bestOp.distanceKm) bestOp = { sub, distanceKm: d };
    }
    if (bestOp && ns) {
      const gapKm = haversineKm(ns.sub.lat, ns.sub.lon, bestOp.sub.lat, bestOp.sub.lon);
      const distDeltaKm = Math.abs(ns.distanceKm - bestOp.distanceKm);
      const agreed = gapKm <= AGREEMENT_TOLERANCE_KM || distDeltaKm <= AGREEMENT_TOLERANCE_KM;
      console.log(`   overpass nearest: ${bestOp.sub.name ?? "(unnamed)"} [${bestOp.sub.osmType}/${bestOp.sub.osmId}] voltage="${bestOp.sub.voltageRaw}" @ ${round(bestOp.distanceKm)} km (${round(bestOp.sub.lat, 5)}, ${round(bestOp.sub.lon, 5)})`);
      console.log(`   tile-vs-overpass: position gap ${round(gapKm)} km, distance delta ${round(distDeltaKm)} km → ${agreed ? "AGREE" : "DISAGREE"} (tolerance ${AGREEMENT_TOLERANCE_KM} km)`);
      verification = {
        method: "Overpass API power=substation around:25km, nearest by haversine",
        agreed,
        detail:
          `tile nearest "${ns.sub.name ?? "(unnamed)"}" @ ${round(ns.distanceKm)} km vs overpass nearest ` +
          `"${bestOp.sub.name ?? "(unnamed)"}" [${bestOp.sub.osmType}/${bestOp.sub.osmId}] @ ${round(bestOp.distanceKm)} km; ` +
          `position gap ${round(gapKm)} km, distance delta ${round(distDeltaKm)} km`,
      };
    } else {
      verification = {
        method: "Overpass API power=substation around:25km",
        agreed: false,
        detail: `missing side: tile nearest=${ns ? "ok" : "none"}, overpass nearest=${bestOp ? "ok" : "none"}`,
      };
    }
  } catch (err) {
    verification = {
      method: "Overpass API power=substation around:25km",
      agreed: false,
      detail: `overpass fetch failed: ${(err as Error).message}`,
    };
    console.log(`   FAILED: ${(err as Error).message}`);
  }

  // 5. Machine-readable summary (consumed by the orchestrator).
  const summary = {
    decodeWorked: main10.lines.length > 0 && main10.substations.length > 0,
    zoom: DECODE_ZOOM,
    tileSource: `${UPSTREAM_BASE}/{z}/{x}/{y}.pbf (direct upstream)`,
    layersAtZ10: Object.keys(main10.layerCounts).sort(),
    layersAtZ7: Object.keys(low.layerCounts).sort(),
    z10LineVoltages: voltageHistogram(main10.lines),
    z7LineVoltages: voltageHistogram(low.lines),
    z10SubstationCount: main10.substations.length,
    z7SubstationCount: low.substations.length,
    nearestLine: nl
      ? { voltageKv: nl.line.voltageKv, name: nl.line.name, distanceKm: round(nl.distanceKm) }
      : null,
    nearestSubstation: ns
      ? {
          name: ns.sub.name,
          voltageKv: ns.sub.voltageKv,
          distanceKm: round(ns.distanceKm),
          kind: ns.sub.kind,
        }
      : null,
    missingVoltageKept: { lines: nullVoltageLines, substations: nullVoltageSubs },
    verification,
  };
  console.log(`\n── SUMMARY_JSON\n${JSON.stringify(summary, null, 2)}`);
}

main().catch((err) => {
  console.error("PROBE FAILED:", err);
  process.exit(1);
});
