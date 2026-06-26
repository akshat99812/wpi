#!/usr/bin/env node
/**
 * Bake a small, self-hosted India state-boundary GeoJSON for the maps.
 *
 * WHY: the Pro map + main map previously fetched the full ~1 MB india_states
 * GeoJSON from an external GitHub gist on every load (cross-origin, uncacheable,
 * a single point of failure and the biggest map-load bottleneck). This bakes a
 * simplified copy into public/india-states.geojson so it's served same-origin,
 * gzipped, and cacheable. The gist stays wired as a runtime fallback.
 *
 * WHAT: Douglas–Peucker line simplification (epsilon ≈ EPSILON degrees) plus
 * coordinate rounding to ROUND decimals. Keeps ONLY the ST_NM property (the
 * single key both consumers read via extractStateName). Small states / island
 * rings are protected: a ring that would collapse below a triangle keeps its
 * original vertices, so no state or exclave disappears.
 *
 * USAGE:
 *   node apps/web/scripts/build-india-states.mjs             # fetch the gist
 *   node apps/web/scripts/build-india-states.mjs raw.geojson # use a local file
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '../public/india-states.geojson');

const GIST_URL =
  'https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson';

// Tuning. EPSILON in degrees: ~0.01° ≈ 1.1 km — invisible for a faint state
// divider at the zooms this map uses, yet halves the vertex count. ROUND keeps
// 3 decimals (~110 m), finer than EPSILON so it adds no visible error. Together
// these take the gist from ~1 MB to ~220 KB (≈65 KB gzipped, same-origin).
const EPSILON = 0.01;
const ROUND = 3;
// Rings at/under this many vertices are tiny islands / micro-UTs (e.g.
// Lakshadweep, already a coarse 7-point polygon in the source). Simplifying
// them collapses real area, so keep them as-is (rounded only) — DP only earns
// its keep on large, dense rings.
const SMALL_RING_KEEP = 8;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

// Perpendicular distance from point p to the line segment a→b (planar; fine at
// these scales for relative comparison).
function perpDist(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Iterative Douglas–Peucker (avoids deep recursion / stack overflow on big rings).
function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDist(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > epsilon && idx !== -1) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

const r = (n) => Math.round(n * 10 ** ROUND) / 10 ** ROUND;

function simplifyRing(ring) {
  // Closed rings: simplify the open path, then re-close.
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring;
  let simplified =
    open.length <= SMALL_RING_KEEP ? open : douglasPeucker(open, EPSILON);
  // Protect small states / islets: never let a polygon ring collapse below a
  // triangle — fall back to the original vertices if it would.
  if (simplified.length < 3) simplified = open;
  const rounded = simplified.map(([x, y]) => [r(x), r(y)]);
  if (closed && rounded.length) rounded.push([rounded[0][0], rounded[0][1]]);
  return rounded;
}

function simplifyGeometry(geom) {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(simplifyRing) };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) => poly.map(simplifyRing)),
    };
  }
  return geom;
}

function countVertices(fc) {
  let n = 0;
  for (const f of fc.features) {
    const walk = (a) => {
      if (typeof a[0] === 'number') n++;
      else a.forEach(walk);
    };
    walk(f.geometry.coordinates);
  }
  return n;
}

async function main() {
  const localArg = process.argv[2];
  const raw = localArg
    ? fs.readFileSync(localArg, 'utf8')
    : await fetchText(GIST_URL);
  const data = JSON.parse(raw);
  if (!data.features?.length) throw new Error('Invalid GeoJSON: no features');

  const before = countVertices(data);
  const simplified = {
    type: 'FeatureCollection',
    features: data.features.map((f, i) => ({
      type: 'Feature',
      id: i + 1,
      properties: { ST_NM: f.properties?.ST_NM ?? 'Unknown' },
      geometry: simplifyGeometry(f.geometry),
    })),
  };
  const after = countVertices(simplified);

  const json = JSON.stringify(simplified);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf8');
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(
    `✓ ${simplified.features.length} states · vertices ${before} → ${after} ` +
      `(${((1 - after / before) * 100).toFixed(0)}% fewer) · ${kb} KB → ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error('build-india-states failed:', err.message);
  process.exit(1);
});
