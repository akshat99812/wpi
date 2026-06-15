/**
 * Bakes ONE static India 10 m wind-vector field for the free-tier "Wind flow"
 * particle animation (earth.nullschool-style). Output is a tiny JSON grid of
 * u/v components consumed by components/Map/utils/windFlow.ts.
 *
 * Source: Open-Meteo (https://open-meteo.com) — current 10 m wind, sampled on
 * a coarse India grid. This is a ONE-TIME static snapshot (per the product
 * decision), not a live feed; re-run this script to refresh it.
 *
 *   node scripts/build-wind-flow.mjs
 *
 * If the network is unavailable, a physically-plausible synthetic field is
 * written instead so the feature still renders; the JSON `source` field always
 * records which path produced the data.
 *
 * Grid convention (row-major): row 0 = NORTH edge, col 0 = WEST edge.
 *   lon = W + col * dLon,  lat = N - row * dLat
 *   index = row * width + col
 * u = eastward m/s, v = northward m/s (meteorological dir → vector below).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// India bake extent [W, S, E, N] — matches the wind-atlas bounds.
const BBOX = [68.0, 6.0, 98.0, 38.0];
const WIDTH = 20; // longitude samples
const HEIGHT = 22; // latitude samples
const CHUNK = 90; // points per Open-Meteo request
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/wind-flow/india-wind.json",
);

function gridPoints() {
  const [w, s, e, n] = BBOX;
  const dLon = (e - w) / (WIDTH - 1);
  const dLat = (n - s) / (HEIGHT - 1);
  const pts = [];
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      pts.push({ lat: +(n - row * dLat).toFixed(4), lon: +(w + col * dLon).toFixed(4) });
    }
  }
  return pts;
}

/** Meteorological speed (m/s) + direction (deg, FROM) → eastward/northward m/s. */
function toUV(speed, dirDeg) {
  const r = (dirDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

async function fetchChunk(points) {
  const lat = points.map((p) => p.lat).join(",");
  const lon = points.map((p) => p.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  // Open-Meteo returns an array when multiple coords are requested, else one obj.
  return Array.isArray(json) ? json : [json];
}

async function bakeFromOpenMeteo() {
  const pts = gridPoints();
  const u = new Array(pts.length).fill(0);
  const v = new Array(pts.length).fill(0);
  for (let i = 0; i < pts.length; i += CHUNK) {
    const slice = pts.slice(i, i + CHUNK);
    const results = await fetchChunk(slice);
    results.forEach((r, j) => {
      const speed = r?.current?.wind_speed_10m ?? 0;
      const dir = r?.current?.wind_direction_10m ?? 0;
      const { u: uu, v: vv } = toUV(speed, dir);
      u[i + j] = +uu.toFixed(3);
      v[i + j] = +vv.toFixed(3);
    });
    process.stdout.write(`  fetched ${Math.min(i + CHUNK, pts.length)}/${pts.length}\n`);
  }
  return { u, v, source: "open-meteo (10 m current, static snapshot)" };
}

/** Smooth monsoon-ish fallback: SW-erly over the peninsula, drier NW flow up
 *  north. Plausible-looking, NOT real — only used if the fetch fails. */
function bakeSynthetic() {
  const [w, s, e, n] = BBOX;
  const dLon = (e - w) / (WIDTH - 1);
  const dLat = (n - s) / (HEIGHT - 1);
  const u = [];
  const v = [];
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const lon = w + col * dLon;
      const lat = n - row * dLat;
      // Base SW monsoon (toward NE) strengthening toward the south/coast.
      const strength = 4 + 5 * Math.max(0, (24 - lat) / 18);
      const swirl = Math.sin((lon - 78) / 8) * 1.5;
      const uu = strength * 0.8 + swirl; // eastward
      const vv = strength * 0.55 - Math.cos((lat - 20) / 10) * 1.2; // northward
      u.push(+uu.toFixed(3));
      v.push(+vv.toFixed(3));
    }
  }
  return { u, v, source: "synthetic monsoon approximation (network unavailable)" };
}

async function main() {
  let baked;
  try {
    console.log("[wind-flow] fetching Open-Meteo current wind…");
    baked = await bakeFromOpenMeteo();
  } catch (err) {
    console.warn(`[wind-flow] fetch failed (${err.message}); writing synthetic field.`);
    baked = bakeSynthetic();
  }

  let speedMax = 0;
  for (let i = 0; i < baked.u.length; i++) {
    speedMax = Math.max(speedMax, Math.hypot(baked.u[i], baked.v[i]));
  }

  const out = {
    bbox: BBOX,
    width: WIDTH,
    height: HEIGHT,
    speedMax: +speedMax.toFixed(2),
    source: baked.source,
    generatedAt: new Date().toISOString(),
    u: baked.u,
    v: baked.v,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(`[wind-flow] wrote ${OUT}`);
  console.log(`[wind-flow] source=${out.source} speedMax=${out.speedMax} m/s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
