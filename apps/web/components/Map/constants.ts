import type { BasemapId, StateMeta } from './types';

// ── Basemap labels (icons replaced with professional inline SVG in BasemapSwitcher) ──
export const BASEMAP_LABELS: Record<BasemapId, string> = {
  satellite: 'Satellite',
  terrain:   'Terrain',
  wind:      'Wind',
  street:    'Street',
  pro:       'Pro',
};

// 'pro' is currently locked — only these are selectable.
export const ENABLED_BASEMAPS: BasemapId[] = ['satellite', 'terrain', 'wind', 'street', 'pro'];
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
  if (mode === 'terrain') return {
    version: 8,
    sources: { ter: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri' } },
    layers: [{ id: 'ter', type: 'raster', source: 'ter' }],
  };
  if (mode === 'street') return 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  return 'https://tiles.openfreemap.org/styles/liberty';
}

// ── State wind data (NIWE / GWA @ 100 m AGL) ───────────────────────────────
export const STATE_DATA: Record<string, StateMeta> = {
  'Gujarat':          { lon: 71.57, lat: 22.26, mw: 11000, plf: 34, windMs: 7.2, potential: 142 },
  'Tamil Nadu':       { lon: 78.66, lat: 11.13, mw: 9500,  plf: 36, windMs: 7.8, potential: 103 },
  'Rajasthan':        { lon: 74.22, lat: 27.02, mw: 7100,  plf: 32, windMs: 7.5, potential: 128 },
  'Karnataka':        { lon: 75.71, lat: 15.32, mw: 6100,  plf: 30, windMs: 6.8, potential: 55  },
  'Andhra Pradesh':   { lon: 79.74, lat: 15.91, mw: 4200,  plf: 28, windMs: 7.0, potential: 44  },
  'Maharashtra':      { lon: 75.71, lat: 19.75, mw: 3800,  plf: 26, windMs: 6.2, potential: 62  },
  'Madhya Pradesh':   { lon: 78.66, lat: 22.97, mw: 3560,  plf: 26, windMs: 5.8, potential: 23  },
  'Telangana':        { lon: 79.02, lat: 18.11, mw: 920,   plf: 22, windMs: 6.5, potential: 18  },
  // Kerala — Palakkad gap (Agali / Ramakkalmedu cluster). Small installed
  // base, modest PLF; NIWE pegs the @100 m potential at ~1.7 GW.
  'Kerala':           { lon: 76.70, lat: 10.85, mw: 63,    plf: 20, windMs: 5.5, potential: 2   },
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

// ── Authentic mean-wind-speed reference grid for India @ 100 m AGL ─────────
// Sourced from the published NIWE India Wind Atlas (2019, 100 m AGL) and
// the DTU Global Wind Atlas, rounded to 0.1 m/s. Points are spaced to span
// the full country so the MapLibre heatmap layer renders a continuous
// GWA-style gradient. This is aggregate regional data, not pixel-level
// interpolation — the legend labels it accordingly.
export const WIND_ATLAS_DATA: Array<{ lon: number; lat: number; windMs: number }> = [
  // Rajasthan (Thar / Aravalli)
  { lon: 70.9, lat: 26.9, windMs: 7.4 }, { lon: 71.4, lat: 25.8, windMs: 7.1 },
  { lon: 72.4, lat: 27.1, windMs: 7.0 }, { lon: 73.0, lat: 26.3, windMs: 6.4 },
  { lon: 72.6, lat: 25.3, windMs: 6.5 }, { lon: 74.6, lat: 25.4, windMs: 5.7 },
  { lon: 73.5, lat: 28.0, windMs: 6.8 }, { lon: 75.0, lat: 27.2, windMs: 5.5 },
  { lon: 76.3, lat: 26.9, windMs: 5.0 }, { lon: 70.5, lat: 28.2, windMs: 6.6 },
  // Gujarat (Kutch / Saurashtra / mainland)
  { lon: 68.8, lat: 23.9, windMs: 8.0 }, { lon: 69.7, lat: 23.3, windMs: 7.8 },
  { lon: 70.4, lat: 22.8, windMs: 7.3 }, { lon: 69.6, lat: 21.6, windMs: 7.1 },
  { lon: 70.1, lat: 22.5, windMs: 7.2 }, { lon: 71.2, lat: 21.6, windMs: 6.6 },
  { lon: 72.2, lat: 24.2, windMs: 6.3 }, { lon: 72.6, lat: 23.0, windMs: 5.9 },
  { lon: 72.2, lat: 21.8, windMs: 6.2 }, { lon: 70.1, lat: 20.9, windMs: 7.0 },
  // Arabian Sea offshore (Gulf of Kutch zone)
  { lon: 68.0, lat: 22.5, windMs: 9.2 }, { lon: 68.3, lat: 21.8, windMs: 9.0 },
  { lon: 69.0, lat: 21.2, windMs: 8.7 }, { lon: 67.5, lat: 23.0, windMs: 9.3 },
  // Maharashtra (Western Ghats / Khandesh)
  { lon: 74.0, lat: 17.7, windMs: 7.5 }, { lon: 74.6, lat: 16.9, windMs: 7.1 },
  { lon: 74.8, lat: 20.9, windMs: 6.8 }, { lon: 74.7, lat: 19.1, windMs: 6.3 },
  { lon: 76.0, lat: 18.2, windMs: 5.9 }, { lon: 73.8, lat: 18.5, windMs: 6.5 },
  { lon: 77.3, lat: 20.7, windMs: 5.4 }, { lon: 79.0, lat: 21.1, windMs: 4.8 },
  // Madhya Pradesh (Malwa + central plateau)
  { lon: 75.3, lat: 22.6, windMs: 6.3 }, { lon: 75.8, lat: 23.2, windMs: 5.6 },
  { lon: 75.0, lat: 23.3, windMs: 5.5 }, { lon: 76.3, lat: 23.4, windMs: 5.3 },
  { lon: 75.6, lat: 21.8, windMs: 5.9 }, { lon: 78.5, lat: 23.6, windMs: 4.6 },
  { lon: 80.7, lat: 22.8, windMs: 4.2 },
  // Chhattisgarh
  { lon: 81.6, lat: 21.3, windMs: 4.1 }, { lon: 82.2, lat: 19.8, windMs: 4.5 },
  // Karnataka (Chitradurga belt + coast)
  { lon: 76.4, lat: 14.2, windMs: 7.2 }, { lon: 75.6, lat: 15.4, windMs: 7.4 },
  { lon: 76.9, lat: 15.1, windMs: 6.9 }, { lon: 77.1, lat: 13.4, windMs: 6.3 },
  { lon: 75.9, lat: 14.5, windMs: 6.7 }, { lon: 74.8, lat: 12.9, windMs: 5.8 },
  { lon: 75.4, lat: 12.5, windMs: 5.6 }, { lon: 77.6, lat: 12.9, windMs: 5.1 },
  // Andhra Pradesh / Rayalaseema
  { lon: 77.6, lat: 14.7, windMs: 7.3 }, { lon: 78.1, lat: 15.8, windMs: 7.0 },
  { lon: 78.8, lat: 14.5, windMs: 6.7 }, { lon: 80.0, lat: 15.5, windMs: 5.4 },
  { lon: 80.6, lat: 16.3, windMs: 5.3 }, { lon: 82.2, lat: 17.7, windMs: 5.0 },
  // Telangana
  { lon: 78.5, lat: 17.4, windMs: 5.3 }, { lon: 77.9, lat: 16.8, windMs: 5.7 },
  { lon: 79.6, lat: 18.4, windMs: 4.8 },
  // Tamil Nadu (Palghat-Muppandal wind corridor)
  { lon: 77.8, lat: 8.7,  windMs: 8.6 }, { lon: 76.9, lat: 11.0, windMs: 8.3 },
  { lon: 77.5, lat: 8.1,  windMs: 8.2 }, { lon: 78.1, lat: 8.8,  windMs: 7.6 },
  { lon: 77.3, lat: 11.1, windMs: 7.1 }, { lon: 78.6, lat: 10.7, windMs: 6.5 },
  { lon: 79.1, lat: 12.0, windMs: 5.9 }, { lon: 80.3, lat: 13.1, windMs: 5.6 },
  { lon: 77.6, lat: 9.9,  windMs: 7.4 },
  // Kerala
  { lon: 76.3, lat: 10.5, windMs: 5.9 }, { lon: 76.6, lat: 9.0,  windMs: 5.4 },
  { lon: 75.8, lat: 11.3, windMs: 5.2 },
  // Odisha
  { lon: 84.8, lat: 20.3, windMs: 5.1 }, { lon: 85.8, lat: 19.8, windMs: 5.3 },
  { lon: 83.8, lat: 21.3, windMs: 4.4 },
  // West Bengal / Gangetic plain (low)
  { lon: 87.9, lat: 22.9, windMs: 4.4 }, { lon: 88.3, lat: 22.6, windMs: 4.3 },
  { lon: 88.6, lat: 24.5, windMs: 3.8 },
  // Bihar / Jharkhand / UP plain
  { lon: 85.3, lat: 25.8, windMs: 3.6 }, { lon: 85.3, lat: 23.6, windMs: 4.0 },
  { lon: 80.9, lat: 27.0, windMs: 3.5 }, { lon: 82.7, lat: 26.8, windMs: 3.4 },
  { lon: 78.0, lat: 27.5, windMs: 3.7 }, { lon: 78.0, lat: 26.3, windMs: 3.6 },
  // Punjab / Haryana / Delhi
  { lon: 75.3, lat: 30.9, windMs: 4.1 }, { lon: 76.3, lat: 29.1, windMs: 4.0 },
  { lon: 77.1, lat: 28.6, windMs: 3.9 },
  // Himachal / Uttarakhand / J&K / Ladakh (highly variable)
  { lon: 77.2, lat: 31.9, windMs: 5.2 }, { lon: 79.1, lat: 30.1, windMs: 4.9 },
  { lon: 75.3, lat: 34.1, windMs: 5.5 }, { lon: 77.6, lat: 34.2, windMs: 6.8 },
  // North-East
  { lon: 91.7, lat: 23.7, windMs: 3.7 }, { lon: 91.3, lat: 25.5, windMs: 4.2 },
  { lon: 93.0, lat: 26.2, windMs: 3.9 }, { lon: 94.2, lat: 28.2, windMs: 4.6 },
  { lon: 94.6, lat: 26.2, windMs: 4.1 }, { lon: 92.9, lat: 23.2, windMs: 3.8 },
  { lon: 93.9, lat: 24.7, windMs: 3.9 }, { lon: 88.5, lat: 27.5, windMs: 4.4 },
  // Bay of Bengal coast / offshore
  { lon: 86.4, lat: 20.6, windMs: 5.6 }, { lon: 85.0, lat: 19.5, windMs: 6.0 },
  { lon: 80.5, lat: 13.0, windMs: 5.9 }, { lon: 82.0, lat: 15.9, windMs: 5.7 },
  // Gulf of Mannar offshore (Dhanushkodi zone)
  { lon: 79.1, lat: 8.9,  windMs: 8.8 }, { lon: 78.9, lat: 8.3,  windMs: 8.5 },
  { lon: 79.4, lat: 8.6,  windMs: 8.4 },
  // Andaman / Lakshadweep
  { lon: 92.8, lat: 10.8, windMs: 6.4 }, { lon: 73.0, lat: 10.6, windMs: 6.7 },
];

// India GeoJSON CDN — post-2014 state boundaries (Telangana split from
// Andhra Pradesh, Jammu & Kashmir / Ladakh split, all 28 states + 8 UTs).
// jbrobst's gist uses ST_NM as the name property; the older geohacker source
// (NAME_1) is kept as a fallback if the gist is unreachable.
export const INDIA_GEOJSON_URL =
  'https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson';

export const INDIA_GEOJSON_FALLBACK_URL =
  'https://raw.githubusercontent.com/geohacker/india/master/state/india_state.geojson';

// Shared layer IDs (kept in one place to avoid drift)
export const LAYER_IDS = {
  // Wind mode only
  heatmap:        'gwa-heatmap',
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