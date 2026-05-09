import { useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { WIND_ATLAS_DATA, LAYER_IDS, SOURCE_IDS } from '../constants';

/**
 * Wind profile heatmap.
 *
 * Mirrors the reference NIWE / Global Wind Atlas portal exactly.
 *
 *   - Authentic 95-point grid spanning India @ 100 m AGL
 *     (Rajasthan, Gujarat / Kutch, Maharashtra, the Tamil Nadu
 *     Palghat-Muppandal corridor, offshore Gulf of Kutch and Gulf of
 *     Mannar zones, etc.). Defined in constants.ts.
 *
 *   - GWA cool → hot colour ramp:
 *       <4 m/s  cyan-blue  #3d93b5
 *       ~5 m/s  sea-green  #5aad82
 *       ~6 m/s  chartreuse #c8e04a
 *       ~7 m/s  amber      #ffc041
 *       ~8 m/s  orange     #ff7a1a
 *       >8 m/s  red        #ff1a00
 *
 *   - Weight curve: 3→0.05, 5→0.35, 6.5→0.6, 7.5→0.8, 9→1.0.
 *
 *   - Radius SHRINKS with zoom (85 → 50 px from z3 → z12). At low
 *     zoom the sparse grid blooms into a continuous surface; at high
 *     zoom kernels tighten so small high-wind pockets stay readable.
 *
 *   - Intensity GROWS with zoom (1.1 → 2.8) keeping colour saturated
 *     on drill-in even as the radius shrinks.
 *
 *   - Opacity capped low (0.62 → 0.48) so state boundaries and turbine
 *     pins stay demarcated above the heatmap.
 *
 * Inserted BENEATH the india-state-fill hover layer so boundary clicks
 * and hover continue to fire.
 */
export function useWindLayer() {
  const install = useCallback((m: maplibregl.Map) => {
    if (!m.getSource(SOURCE_IDS.windAtlas)) {
      m.addSource(SOURCE_IDS.windAtlas, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: WIND_ATLAS_DATA.map(d => ({
            type: 'Feature',
            properties: { ws: d.windMs },
            geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
          })),
        },
      });
    }

    // Insert beneath the boundary fill so clicks still hit it.
    const beforeId = m.getLayer(LAYER_IDS.indiaFill) ? LAYER_IDS.indiaFill : undefined;

    if (!m.getLayer(LAYER_IDS.heatmap)) {
      m.addLayer(
        {
          id: LAYER_IDS.heatmap,
          type: 'heatmap',
          source: SOURCE_IDS.windAtlas,
          paint: {
            'heatmap-weight': [
              'interpolate', ['linear'], ['get', 'ws'],
              3, 0.05,
              5, 0.35,
              6.5, 0.6,
              7.5, 0.8,
              9, 1.0,
            ],
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              3, 1.1,
              6, 1.6,
              9, 2.2,
              12, 2.8,
            ],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0.00, 'rgba(61,147,181,0.00)',  // <4 m/s — transparent cyan
              0.12, 'rgba(61,147,181,0.55)',  //  ~4 m/s
              0.28, 'rgba(90,173,130,0.70)',  //  ~5 m/s — sea-green
              0.46, 'rgba(200,224,74,0.80)',  //  ~6 m/s — chartreuse
              0.64, 'rgba(255,192,65,0.85)',  //  ~7 m/s — amber
              0.80, 'rgba(255,122,26,0.90)',  //  ~8 m/s — orange
              1.00, 'rgba(255,26,0,0.95)',    //  >8 m/s — red
            ],
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              3, 85,
              5, 70,
              7, 60,
              9, 55,
              12, 50,
            ],
            'heatmap-opacity': [
              'interpolate', ['linear'], ['zoom'],
              3, 0.62,
              9, 0.55,
              12, 0.48,
            ],
          },
        },
        beforeId,
      );
    }
  }, []);

  const remove = useCallback((m: maplibregl.Map) => {
    if (m.getLayer(LAYER_IDS.heatmap)) m.removeLayer(LAYER_IDS.heatmap);
    if (m.getSource(SOURCE_IDS.windAtlas)) m.removeSource(SOURCE_IDS.windAtlas);
  }, []);

  return { install, remove };
}