import { Router, Request, Response } from 'express';
import { parse } from 'csv-parse/sync';
import { requirePro } from '../middleware/requirePro';
import { displayNameFromLabel } from '../services/privateMastName';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/routes → src → apps/api, then into data/private (VPS bind mount in prod).
const CSV_PATH = path.resolve(__dirname, '../../data/private/privateMasts.csv');
// Ground elevation per mast, sampled from the GWA elevation layer by
// scripts/enrich-private-masts.ts (validated: median |Δ| 6 m vs the KMZ
// altitudes the CSV does carry). Keyed by `lat.toFixed(6)|lon.toFixed(6)`.
const ELEVATION_PATH = path.resolve(
  __dirname,
  '../../data/private/privateMasts.elevation.json',
);

/**
 * Proprietary private-mast inventory (privateMasts.csv) → GeoJSON, Pro-only.
 * Mirrors routes/boundaries.ts: parse + cache once at first request, the file
 * never changes at runtime.
 *
 * Payload is deliberately minimal — name, height and the same `hcat` height
 * bucket the public mast tiles carry (0 = <50 m · 1 = 50–100 m · 2 = >100 m ·
 * −1 = unknown) so the Layers-card height chips can filter both layers. The
 * internal QC columns (nearest_wra_*, match_confidence) are never shipped.
 */

type CsvRow = Record<string, string>;

// Mast height is embedded in free-form names ("..._65m_WM...", "Aladar150m",
// "Suriyakheda 100m _Pvt. WM") — first 2-3 digit run followed by "m" wins.
function heightFromName(name: string): number | null {
  const m = name.match(/(\d{2,3})\s*m\b/i) ?? name.match(/(\d{2,3})m/i);
  if (!m?.[1]) return null;
  const h = parseInt(m[1], 10);
  // Plausible met-mast range; anything else is a year/id fragment, not a height.
  return h >= 10 && h <= 200 ? h : null;
}

function hcatOf(heightM: number | null): number {
  if (heightM == null || heightM <= 0) return -1;
  if (heightM < 50) return 0;
  if (heightM <= 100) return 1;
  return 2;
}

let cache: string | null = null;

function loadElevations(): Record<string, number> {
  try {
    const parsed = JSON.parse(fs.readFileSync(ELEVATION_PATH, 'utf-8')) as {
      byCoord?: Record<string, number>;
    };
    return parsed.byCoord ?? {};
  } catch {
    // Enrichment not run (yet) on this host — masts ship without elevation.
    console.warn('[private-masts] no elevation file; run scripts/enrich-private-masts.ts');
    return {};
  }
}

function loadPrivateMasts(): string | null {
  if (cache) return cache;
  try {
    const text = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];
    const elevations = loadElevations();

    const features = rows.flatMap((r) => {
      const lat = Number(r.latitude);
      const lon = Number(r.longitude);
      const name = (r.name ?? '').trim();
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const heightM = heightFromName(name);
      const elevationMasl =
        elevations[`${lat.toFixed(6)}|${lon.toFixed(6)}`] ?? null;
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lon, lat] },
          properties: {
            // Labels are free-form ("Aladar150m Jul24-Jun25_Pvt. Mast") —
            // ship just the place name; height already travels separately.
            name: displayNameFromLabel(name),
            heightM,
            hcat: hcatOf(heightM),
            elevationMasl,
          },
        },
      ];
    });

    cache = JSON.stringify({ type: 'FeatureCollection', features });
    console.log(`[private-masts] loaded ${features.length}/${rows.length} masts`);
    return cache;
  } catch (err) {
    console.error('[private-masts] could not read privateMasts.csv', err);
    return null;
  }
}

// GET /api/private-masts — proprietary mast points (Pro-only GeoJSON).
router.get('/private-masts', ...requirePro, (_req: Request, res: Response) => {
  const data = loadPrivateMasts();
  if (!data) {
    res.status(503).json({ error: 'Private masts unavailable' });
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Cache-Control',
    process.env.NODE_ENV === 'production' ? 'private, max-age=3600' : 'no-store',
  );
  res.send(data);
});

export default router;
