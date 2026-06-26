import { assetPath } from '@/lib/basePath';
import type { BasemapId, StateMeta } from './types';

// ── Basemap labels (icons replaced with professional inline SVG in BasemapSwitcher) ──
export const BASEMAP_LABELS: Record<BasemapId, string> = {
  satellite: 'Satellite',
  terrain:   'Terrain',
  wind:      'Wind',
  windflow:  'Wind flow',
  street:    'Street',
  pro:       'Pro',
};

// 'pro' is currently locked — only these are selectable.
export const ENABLED_BASEMAPS: BasemapId[] = ['satellite', 'terrain', 'street', 'wind', 'windflow', 'pro'];
export const LOCKED_BASEMAPS: BasemapId[]  = ['pro'];

// ── Tile styles ────────────────────────────────────────────────────────────
export const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    sat: {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
    },
  },
  layers: [{ id: 'sat', type: 'raster' as const, source: 'sat' }],
};

// Wind-profile basemap: same satellite tiles, but darkened + desaturated
// so the GWA-style heatmap reads clearly without hiding boundaries.
// Mirrors the reference portal's `raster-brightness-max: 0.45,
// raster-saturation: -0.35` on the basemap raster layer.
export const SATELLITE_DARKENED_STYLE = {
  version: 8 as const,
  sources: {
    sat: {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
    },
  },
  layers: [{
    id: 'sat',
    type: 'raster' as const,
    source: 'sat',
    paint: {
      'raster-brightness-max': 0.45,
      'raster-saturation': -0.35,
    },
  }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStyle(mode: BasemapId): any {
  if (mode === 'satellite') return SATELLITE_STYLE;
  if (mode === 'wind')      return SATELLITE_DARKENED_STYLE;
  // Wind-flow particle mode: dark, desaturated imagery so the cyan/white
  // particle trails (drawn on a canvas overlay above) read clearly.
  if (mode === 'windflow')  return SATELLITE_DARKENED_STYLE;
  if (mode === 'terrain') return {
    // OpenTopoMap tiles — full topo style with SRTM-derived contour lines,
    // hillshading, and peak labels. CC-BY-SA · OSM ODbL — both credited in
    // the attribution string below per the licence.
    version: 8,
    sources: {
      ter: {
        type: 'raster',
        tiles: [
          'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 17,
        attribution:
          'Map data: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, ' +
          'SRTM | Map style: © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> ' +
          '(<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC-BY-SA</a>)',
      },
    },
    layers: [{ id: 'ter', type: 'raster', source: 'ter' }],
  };
  if (mode === 'street') return {
    // Standard OpenStreetMap raster tiles. ODbL — credited via attribution.
    // Sub-domains a/b/c shard so tiles load in parallel.
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
  return 'https://tiles.openfreemap.org/styles/liberty';
}

// ── State wind data (NIWE / GWA @ 100 m AGL) ───────────────────────────────
// Installed MW values from MNRE RE-Statistics 2024-25 (Table 8.2, cumulative
// as on 31 Mar 2025). State-wise FY26 table is not yet published — these
// remain at FY25 close, while the India aggregate elsewhere on the page is
// the latest MNRE physical-progress snapshot (56,437 MW as of 30 Apr 2026;
// FY26 close was 56,090 MW on 31 Mar 2026).
// All numbers rounded to nearest MW. Potential GW values are NIWE @150 m AGL.
export const STATE_DATA: Record<string, StateMeta> = {
  'Gujarat':          { lon: 71.57, lat: 22.26, mw: 12677, plf: 34, windMs: 7.2, potential: 180.8 },
  'Tamil Nadu':       { lon: 78.66, lat: 11.13, mw: 11740, plf: 36, windMs: 7.8, potential: 95.1 },
  'Karnataka':        { lon: 75.71, lat: 15.32, mw: 7351,  plf: 30, windMs: 6.8, potential: 169.3 },
  'Maharashtra':      { lon: 75.71, lat: 19.75, mw: 5285,  plf: 26, windMs: 6.2, potential: 173.9 },
  'Rajasthan':        { lon: 74.22, lat: 27.02, mw: 5209,  plf: 32, windMs: 7.5, potential: 284.2 },
  'Andhra Pradesh':   { lon: 79.74, lat: 15.91, mw: 4377,  plf: 28, windMs: 7.0, potential: 123.3 },
  'Madhya Pradesh':   { lon: 78.66, lat: 22.97, mw: 3195,  plf: 26, windMs: 5.8, potential: 55.4 },
  'Telangana':        { lon: 79.02, lat: 18.11, mw: 128,   plf: 22, windMs: 6.5, potential: 54.7 },
  // Kerala — Palakkad gap (Agali / Ramakkalmedu cluster). Small installed
  // base, modest PLF; NIWE pegs the @100 m potential at ~1.7 GW.
  'Kerala':           { lon: 76.70, lat: 10.85, mw: 71,    plf: 20, windMs: 5.5, potential: 3   },
};

// GeoJSON NAME_1 → STATE_DATA key
export const GEOJSON_NAME_MAP: Record<string, string> = {
  'Gujarat':        'Gujarat',
  'Tamil Nadu':     'Tamil Nadu',
  'Rajasthan':      'Rajasthan',
  'Karnataka':      'Karnataka',
  'Andhra Pradesh': 'Andhra Pradesh',
  'Maharashtra':    'Maharashtra',
  'Madhya Pradesh': 'Madhya Pradesh',
  'Telangana':      'Telangana',
  'Kerala':         'Kerala',
};

// Capacity legend colour (also used for the SE corner badge)
export function mwColor(mw: number): string {
  if (mw >= 8000) return '#4cc87a';
  if (mw >= 5000) return '#ffb066';
  if (mw >= 2000) return '#f5a623';
  return '#e85c5c';
}

// Mean wind speed @ 100 m AGL is now served as a real Global Wind Atlas raster
// (pre-baked to public/wind-atlas/ by scripts/build_wind_atlas.py) plus a value
// grid at lib/wind/india-grid.json for the cursor readout — the old hand-placed
// reference-point heatmap (WIND_ATLAS_DATA) has been retired.

// India state boundaries (post-2014: Telangana split, J&K / Ladakh split, all
// 28 states + 8 UTs). PRIMARY is a self-hosted, simplified copy baked from the
// jbrobst gist by scripts/build-india-states.mjs (~220 KB / ~68 KB gzipped,
// served same-origin and cacheable) — fetching the full ~1 MB gist cross-origin
// on every map load was the single biggest load-time bottleneck. The original
// gist stays wired as a runtime FALLBACK if the local file is ever missing.
// Both carry ST_NM as the name property (extractStateName reads it).
// assetPath: served under the app's basePath in prod (/terminal); the gist
// fallback below is cross-origin and needs no prefix.
export const INDIA_GEOJSON_URL = assetPath('/india-states.geojson');

export const INDIA_GEOJSON_FALLBACK_URL =
  'https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson';

// Shared layer IDs (kept in one place to avoid drift)
export const LAYER_IDS = {
  // Wind mode only
  windRaster:     'gwa-wind-raster',
  windFill:       'wind-state-fill',
  windLine:       'wind-state-line',
  windLabel:      'wind-state-label',
  // Every mode
  indiaBoundary:  'india-state-border',
  indiaFill:      'india-state-fill', // invisible — for hover hit-testing
  indiaLabel:     'india-state-label',
} as const;

export const SOURCE_IDS = {
  windAtlas:   'gwa-wind',
  india:       'india-states',
  indiaLabels: 'india-state-labels',
} as const;