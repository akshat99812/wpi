"use client";

/**
 * Offscreen MapLibre capture for the site-report PDF (plan §4).
 *
 * Only the browser has a live GL canvas, so the three report maps are captured
 * client-side. We use a DEDICATED offscreen map per shot (not the visible map)
 * so framing is deterministic regardless of what the user is currently looking
 * at, and so `preserveDrawingBuffer` (required for toDataURL) is set without
 * touching the interactive map's context.
 *
 * Three shots, reusing the app's own styles + DEM (DRY):
 *   street  — top-down OSM raster, AOI fitBounds
 *   terrain — top-down OpenTopoMap (hillshaded topo)
 *   threeD  — liberty vector + AWS raster-dem terrain mesh, pitched ~60°
 *
 * Robustness (plan §4 senior note): each shot has its own timeout and is
 * isolated — a failed shot returns `null` (the template renders a placeholder)
 * rather than failing the whole export. Tile attribution is burned into each
 * PNG so the redistributed image carries its credit (plan §9.3).
 */

import maplibregl, { type Map as MlMap } from "maplibre-gl";

import { getStyle } from "../constants";
import {
  DEM_SOURCE_ID,
  ensureDemSource,
  overlayAnchor,
  registerDemProtocol,
} from "../utils/demShared";

export interface MapCaptureInput {
  /** AOI outer ring, lon/lat, closed. Drives framing + the drawn polygon. */
  ring: [number, number][];
}

export interface MapCaptureResult {
  street: string | null;
  terrain: string | null;
  threeD: string | null;
}

type Shot = "street" | "terrain" | "threeD";

/** 3:2 capture target (plan §4). Device-pixel size of the offscreen canvas. */
export const CAPTURE_SIZE = { width: 1200, height: 800 } as const;

const SHOT_TIMEOUT_MS = 20_000;
const FIT_PADDING = 64;
const THREE_D_PITCH = 60;
const THREE_D_EXAGGERATION = 1.4;

/** Plain-text attribution burned into each shot (HTML credits stripped). */
const ATTRIBUTION: Record<Shot, string> = {
  street: "© OpenStreetMap contributors",
  terrain: "© OpenStreetMap · OpenTopoMap (CC-BY-SA)",
  threeD: "© OpenStreetMap · Terrain: © Terrain Tiles (Mapzen / Joerd)",
};

/** The base style id each shot borrows from the app (DRY with the live map). */
const SHOT_STYLE: Record<Shot, "street" | "terrain" | "pro"> = {
  street: "street",
  terrain: "terrain",
  threeD: "pro",
};

const AOI_FILL_SOURCE = "report-aoi";
const AOI_POINT_SOURCE = "report-aoi-centroid";

function ringBbox(
  ring: [number, number][],
): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

function ringCentroid(ring: [number, number][]): [number, number] {
  const [w, s, e, n] = ringBbox(ring);
  return [(w + e) / 2, (s + n) / 2];
}

/** A detached, off-viewport container MapLibre can render a real GL canvas into. */
function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  div.style.position = "absolute";
  div.style.top = "0";
  div.style.left = "-99999px";
  div.style.width = `${CAPTURE_SIZE.width}px`;
  div.style.height = `${CAPTURE_SIZE.height}px`;
  div.style.pointerEvents = "none";
  document.body.appendChild(div);
  return div;
}

/** Resolve when the map next goes idle (tiles + terrain settled), or reject on timeout. */
function waitForIdle(map: MlMap, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.off("idle", onIdle);
      reject(new Error("map idle timeout"));
    }, timeoutMs);
    function onIdle() {
      clearTimeout(timer);
      map.off("idle", onIdle);
      resolve();
    }
    map.on("idle", onIdle);
  });
}

/** Resolve on the map's first `load`, or reject on timeout. */
function waitForLoad(map: MlMap, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("map load timeout")),
      timeoutMs,
    );
    map.once("load", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function addAoiOverlay(map: MlMap, ring: [number, number][]): void {
  const polygon: GeoJSON.Feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
  const point: GeoJSON.Feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: ringCentroid(ring) },
  };
  map.addSource(AOI_FILL_SOURCE, { type: "geojson", data: polygon });
  map.addLayer({
    id: "report-aoi-fill",
    type: "fill",
    source: AOI_FILL_SOURCE,
    paint: { "fill-color": "#1d4ed8", "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: "report-aoi-line",
    type: "line",
    source: AOI_FILL_SOURCE,
    paint: { "line-color": "#1d4ed8", "line-width": 2.5 },
  });
  map.addSource(AOI_POINT_SOURCE, { type: "geojson", data: point });
  map.addLayer({
    id: "report-aoi-centroid",
    type: "circle",
    source: AOI_POINT_SOURCE,
    paint: {
      "circle-radius": 5,
      "circle-color": "#b91c1c",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

/** Add the DEM terrain mesh + hillshade for the 3-D shot. */
function enableCaptureTerrain(map: MlMap): void {
  registerDemProtocol();
  if (!ensureDemSource(map)) return;
  if (!map.getLayer("report-hillshade")) {
    map.addLayer(
      {
        id: "report-hillshade",
        type: "hillshade",
        source: DEM_SOURCE_ID,
        paint: { "hillshade-exaggeration": 0.5 },
      },
      overlayAnchor(map),
    );
  }
  map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: THREE_D_EXAGGERATION });
}

/** Composite the map canvas + a burned-in attribution bar → PNG data URL. */
function burnInAttribution(
  mapCanvas: HTMLCanvasElement,
  attribution: string,
): string {
  const out = document.createElement("canvas");
  out.width = mapCanvas.width;
  out.height = mapCanvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return mapCanvas.toDataURL("image/png");
  ctx.drawImage(mapCanvas, 0, 0);

  const pad = Math.round(out.height * 0.01);
  const fontPx = Math.max(11, Math.round(out.height * 0.018));
  ctx.font = `${fontPx}px -apple-system, Helvetica, Arial, sans-serif`;
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(attribution).width;
  const barH = fontPx + pad * 2;
  const barW = textW + pad * 2;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(out.width - barW, out.height - barH, barW, barH);
  ctx.fillStyle = "#374151";
  ctx.fillText(attribution, out.width - barW + pad, out.height - barH / 2);
  return out.toDataURL("image/png");
}

async function captureShot(shot: Shot, input: MapCaptureInput): Promise<string> {
  const container = makeContainer();
  let map: MlMap | null = null;
  try {
    const [w, s, e, n] = ringBbox(input.ring);
    map = new maplibregl.Map({
      container,
      style: getStyle(SHOT_STYLE[shot]),
      bounds: [
        [w, s],
        [e, n],
      ],
      fitBoundsOptions: { padding: FIT_PADDING },
      pitch: shot === "threeD" ? THREE_D_PITCH : 0,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      // Required so getCanvas().toDataURL() returns the rendered frame (v5 API).
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    await waitForLoad(map, SHOT_TIMEOUT_MS);
    addAoiOverlay(map, input.ring);
    if (shot === "threeD") enableCaptureTerrain(map);
    await waitForIdle(map, SHOT_TIMEOUT_MS);
    return burnInAttribution(map.getCanvas(), ATTRIBUTION[shot]);
  } finally {
    map?.remove();
    container.remove();
  }
}

/**
 * Capture the three report maps for an AOI. Shots run sequentially (one GL
 * context at a time) and each is independent — a failed/timed-out shot resolves
 * to `null` so the report can render a placeholder rather than failing export.
 */
export async function captureMapImages(
  input: MapCaptureInput,
): Promise<MapCaptureResult> {
  const safe = (shot: Shot) =>
    captureShot(shot, input).catch((err) => {
      console.warn(`[mapCapture] ${shot} shot failed`, err);
      return null;
    });
  return {
    street: await safe("street"),
    terrain: await safe("terrain"),
    threeD: await safe("threeD"),
  };
}
