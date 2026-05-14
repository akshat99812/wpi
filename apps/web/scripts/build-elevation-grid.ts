/**
 * Pre-bake a coarse elevation grid covering India so the map's status-bar
 * readout can resolve elevation synchronously without any network round-trip.
 *
 * Data source: OpenTopoData (SRTM 30 m). Their public API supports up to
 * 100 locations per call and explicitly documents a 1-call-per-second
 * per-IP rate limit — much friendlier than Open-Meteo's burst limiter
 * for bulk-baking. Run once at build time:
 *
 *     bun run apps/web/scripts/build-elevation-grid.ts
 *
 * Output: apps/web/lib/elevation/india-grid.json
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// ── Grid spec ───────────────────────────────────────────────────────────
// India bbox + a 1° margin so coastal hovers don't fall off the edge.
const LAT_MIN  = 7;
const LAT_MAX  = 38;
const LNG_MIN  = 67;
const LNG_MAX  = 98;
const STEP     = 0.5;              // degrees — ~55 km cell size (fast bake)
const BATCH    = 100;              // OpenTopoData max per call
const BATCH_GAP_MS = 1100;         // respect 1 req/sec limit (with margin)
const MAX_ATTEMPTS = 5;

const ENDPOINT = 'https://api.opentopodata.org/v1/srtm30m';

function buildCoords(): { lat: number; lng: number; row: number; col: number }[] {
  const rows = Math.round((LAT_MAX - LAT_MIN) / STEP) + 1;
  const cols = Math.round((LNG_MAX - LNG_MIN) / STEP) + 1;
  const out: { lat: number; lng: number; row: number; col: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        lat: +(LAT_MIN + r * STEP).toFixed(4),
        lng: +(LNG_MIN + c * STEP).toFixed(4),
        row: r,
        col: c,
      });
    }
  }
  return out;
}

async function fetchBatch(coords: { lat: number; lng: number }[]): Promise<number[]> {
  // OpenTopoData syntax: locations=lat1,lng1|lat2,lng2|...
  const locations = coords.map(c => `${c.lat},${c.lng}`).join('|');
  const url = `${ENDPOINT}?locations=${locations}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 429) throw new Error('HTTP 429 (rate limited)');
  if (!res.ok) throw new Error(`HTTP ${res.status} on batch`);
  const json = (await res.json()) as { results: Array<{ elevation: number | null }> };
  if (!Array.isArray(json.results)) throw new Error('Bad response shape');
  return json.results.map(r => Math.round(r?.elevation ?? 0));
}

async function main() {
  const coords = buildCoords();
  const rows = Math.round((LAT_MAX - LAT_MIN) / STEP) + 1;
  const cols = Math.round((LNG_MAX - LNG_MIN) / STEP) + 1;
  console.log(`Sampling ${coords.length} cells (${rows} × ${cols}) at ${STEP}° resolution`);

  const data = new Array<number>(coords.length).fill(Number.NaN);

  let done = 0;
  for (let i = 0; i < coords.length; i += BATCH) {
    const batch = coords.slice(i, i + BATCH);
    let attempt = 0;
    while (true) {
      try {
        const elev = await fetchBatch(batch);
        if (elev.length !== batch.length) throw new Error(`Length mismatch: ${elev.length} vs ${batch.length}`);
        batch.forEach((p, k) => {
          const idx = p.row * cols + p.col;
          data[idx] = elev[k] as number;
        });
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(`Batch failed after ${attempt} attempts: ${(err as Error).message}`);
        }
        // Exponential backoff: 5s, 15s, 45s, 90s …
        const wait = Math.min(90_000, 5_000 * Math.pow(3, attempt - 1));
        process.stdout.write(`\n  retry ${attempt}/${MAX_ATTEMPTS} after ${(wait/1000).toFixed(0)}s (${(err as Error).message})`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    done += batch.length;
    process.stdout.write(`\r  fetched ${done}/${coords.length}        `);
    await new Promise(r => setTimeout(r, BATCH_GAP_MS));
  }
  process.stdout.write('\n');

  const holes = data.filter(v => Number.isNaN(v)).length;
  if (holes > 0) {
    console.warn(`Warning: ${holes} cells failed to populate; filling with 0`);
    for (let i = 0; i < data.length; i++) {
      if (Number.isNaN(data[i] as number)) data[i] = 0;
    }
  }

  const payload = {
    version:     1,
    source:      'NASA SRTM via OpenTopoData (srtm30m)',
    license:     'NASA SRTM v3 (public domain)',
    generatedAt: new Date().toISOString(),
    bbox:        [LAT_MIN, LNG_MIN, LAT_MAX, LNG_MAX],
    step:        STEP,
    shape:       [rows, cols],
    data,
  };

  const outDir  = path.resolve(import.meta.dir, '..', 'lib', 'elevation');
  const outFile = path.join(outDir, 'india-grid.json');
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));
  console.log(`Wrote ${outFile} · ${(JSON.stringify(payload).length / 1024).toFixed(1)} KB · rows=${rows} cols=${cols}`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
