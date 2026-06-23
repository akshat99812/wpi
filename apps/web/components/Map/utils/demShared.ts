import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

type DemProvider =
  | {
      kind: 'pmtiles';
      url: string;
      encoding: 'terrarium' | 'mapbox';
      tileSize: number;
      maxzoom: number;
      attribution: string;
    }
  | {
      kind: 'raster';
      tiles: string[];
      encoding: 'terrarium' | 'mapbox';
      tileSize: number;
      maxzoom: number;
      attribution: string;
    };

const PROVIDERS = {
  // DEFAULT — verified working end-to-end (terrain mesh + hillshade + color
  // relief all render; sampled elevations accurate, e.g. Delhi ≈220 m): AWS
  // Terrain Tiles (Mapzen/Joerd, SRTM-era terrarium PNG, research §3). A plain
  // raster-dem XYZ source with zero protocol dependency, and — unlike the
  // global Mapterhorn archive — it warms up in a couple of seconds.
  aws: {
    kind: 'raster',
    tiles: [
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    ],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 15,
    attribution:
      '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">© Terrain Tiles</a> (Mapzen / Joerd)',
  },
  // ACCURACY UPGRADE (research §3) — Mapterhorn: global Copernicus GLO-30,
  // terrarium, z0–12, commercial-OK, best free 30 m accuracy. Renders correctly
  // via this single-archive `url` form, BUT the GLOBAL planet.pmtiles is slow to
  // warm up (many byte-range directory round-trips before relief appears) — a
  // poor first-paint for a Pro feature. PRODUCTION path (research §B1): self-host
  // an India extract — `pmtiles extract planet.pmtiles india-terrain.pmtiles
  // --bbox=68,6,98,37.5` — and point the URL at it; the tiny archive resolves
  // fast AND keeps Copernicus accuracy. Then flip ACTIVE_PROVIDER to this.
  mapterhorn: {
    kind: 'pmtiles',
    url: 'pmtiles://https://download.mapterhorn.com/planet.pmtiles',
    encoding: 'terrarium',
    tileSize: 512,
    maxzoom: 12,
    attribution:
      '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a> · Copernicus GLO-30',
  },
} satisfies Record<string, DemProvider>;

/** The DEM source in use. One-line swap to Mapterhorn / a self-hosted extract. */
const ACTIVE_PROVIDER: DemProvider = PROVIDERS.aws;

// ── Shared ids ──────────────────────────────────────────────────────────────
export const DEM_SOURCE_ID = 'terrain-dem';
export const HILLSHADE_LAYER_ID = 'terrain-hillshade';

// Everything DEM-driven (hillshade, elevation tint, the terrain mesh) inserts
// BELOW the first of these that exists, so the vector overlays + pins always
// stay on top — the same anchor the wind-resource raster uses (page.tsx).
const OVERLAY_ANCHORS = ['pro-state-casing', 'windmills-pts'];

/** First existing overlay anchor, or undefined to append on top. */
export function overlayAnchor(map: MlMap): string | undefined {
  return OVERLAY_ANCHORS.find((id) => map.getLayer(id));
}

// ── pmtiles protocol ────────────────────────────────────────────────────────
let protocolRegistered = false;

/**
 * Register the `pmtiles://` protocol once per page load so a PMTiles DEM source
 * can byte-range its tiles. No-op for the raster (XYZ) provider, and idempotent
 * across map re-creations / HMR.
 */
export function registerDemProtocol(): void {
  if (protocolRegistered || ACTIVE_PROVIDER.kind !== 'pmtiles') {
    protocolRegistered = true;
    return;
  }
  try {
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    protocolRegistered = true;
  } catch (err) {
    console.error('[terrain] could not register pmtiles protocol', err);
  }
}

// ── DEM source ──────────────────────────────────────────────────────────────
/**
 * Lazily add the shared `raster-dem` source (idempotent). Returns true once the
 * source exists, false if the map isn't ready yet (caller should retry on the
 * next idle). A raster-dem source with no referencing layer/terrain fetches no
 * tiles, so leaving it after both features are turned off costs nothing.
 */
export function ensureDemSource(map: MlMap): boolean {
  try {
    if (map.getSource(DEM_SOURCE_ID)) return true;
    if (!map.getCanvas() || !map.isStyleLoaded()) return false;

    const p = ACTIVE_PROVIDER;
    const common = {
      type: 'raster-dem' as const,
      encoding: p.encoding,
      tileSize: p.tileSize,
      maxzoom: p.maxzoom,
      attribution: p.attribution,
    };
    if (p.kind === 'pmtiles') {
      map.addSource(DEM_SOURCE_ID, { ...common, url: p.url });
    } else {
      map.addSource(DEM_SOURCE_ID, { ...common, tiles: p.tiles });
    }
    return true;
  } catch (err) {
    console.error('[terrain] could not add DEM source', err);
    return false;
  }
}
