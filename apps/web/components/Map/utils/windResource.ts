import type { Map as MlMap } from 'maplibre-gl';
import metadata from '@/public/wind-atlas/metadata.json';
import { LAYER_IDS, SOURCE_IDS } from '../constants';

/**
 * Wind-resource raster overlays (mean wind speed, mean power density) from
 * the pre-baked Global Wind Atlas pyramids in public/wind-atlas/ — see
 * scripts/build_wind_atlas.py.
 *
 * Everything (available metrics, heights per metric, tile/grid URL templates,
 * value domains, colour ramps, units, bounds) is driven by the bake-emitted
 * public/wind-atlas/metadata.json. Which heights exist per metric is bake
 * config, not frontend code: adding density @ 50 m later is a script re-run
 * with zero changes here.
 *
 * One active layer at a time (metric × height): any switch is a remove +
 * re-add (MapLibre raster sources can't swap their tile template in place).
 * The layer/source ids are the same ones the main map's wind mode has always
 * used (LAYER_IDS.windRaster / SOURCE_IDS.windAtlas), so the migration of
 * useWindLayer onto this module is regression-free.
 */

export type WindMetric = 'speed' | 'density';

export interface WindMetricMeta {
  label: string;
  unit: string;
  heights: number[];
  tilePath: string;
  gridPath: string;
  domain: number[];
  ramp: { value: number; color: string }[];
}

export const WIND_METRICS: Record<WindMetric, WindMetricMeta> =
  metadata.metrics as Record<WindMetric, WindMetricMeta>;

export const WIND_RESOURCE_ATTRIBUTION_TEXT: string = metadata.attribution;

// Linkful variant for the MapLibre attribution control (the metadata string
// is plain text; the link target is fixed).
const ATTRIBUTION_HTML =
  'Wind: © <a href="https://globalwindatlas.info" target="_blank" rel="noopener">Global Wind Atlas</a> ' +
  '(DTU Wind Energy / World Bank, CC BY 4.0)';

const SOURCE_ID = SOURCE_IDS.windAtlas;
const LAYER_ID = LAYER_IDS.windRaster;

/** Basemap-dependent contrast for the overlay. 'standard' (road / light
 *  basemaps) keeps the translucent blend; 'satellite' goes near-opaque —
 *  the ramp's low end (coastal cyan-blues) turns muddy and reads as
 *  "no coverage" over dark imagery at standard opacity. */
export type WindResourceContrast = 'standard' | 'satellite';

const OPACITY: Record<WindResourceContrast, unknown> = {
  standard: [
    'interpolate', ['linear'], ['zoom'],
    3, 0.82,
    7, 0.78,
    10, 0.72,
  ],
  satellite: [
    'interpolate', ['linear'], ['zoom'],
    3, 0.96,
    7, 0.94,
    10, 0.9,
  ],
};

/** Nearest configured height for a metric (for snapping on metric switch). */
export function snapWindHeight(metric: WindMetric, desired: number): number {
  const heights = WIND_METRICS[metric].heights;
  return heights.reduce((best, h) =>
    Math.abs(h - desired) < Math.abs(best - desired) ? h : best,
  heights[0] ?? desired);
}

/**
 * Adds (or swaps to) the raster overlay for `metric` @ `height`. Any existing
 * wind-resource layer is removed first — single active layer by design.
 */
export function addWindResourceLayer(
  map: MlMap,
  metric: WindMetric,
  height: number,
  opts: { beforeId?: string; contrast?: WindResourceContrast } = {},
): void {
  try {
    // The map may be torn down or mid-restyle when called after an await /
    // queued event — bail rather than throw (same guard useWindLayer had).
    if (!map.getCanvas() || !map.isStyleLoaded()) return;

    const meta = WIND_METRICS[metric];
    if (!meta || !meta.heights.includes(height)) {
      console.error(`[wind-resource] no ${metric} layer baked @ ${height} m`, meta?.heights);
      return;
    }

    removeWindResourceLayer(map);

    map.addSource(SOURCE_ID, {
      type: 'raster',
      tiles: [
        `${window.location.origin}${meta.tilePath.replace('{height}', String(height))}`,
      ],
      tileSize: 256,
      minzoom: metadata.minzoom,
      // maxzoom 9 matches the data's ~250 m resolution — MapLibre over-zooms
      // past it instead of requesting (and 404ing on) z10+ tiles.
      maxzoom: metadata.maxzoom,
      // India bbox — no wasted tile requests over ocean / neighbours.
      bounds: metadata.bounds as [number, number, number, number],
      attribution: ATTRIBUTION_HTML,
    });

    const beforeId =
      opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;
    map.addLayer(
      {
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: {
          'raster-opacity': OPACITY[opts.contrast ?? 'standard'] as never,
          'raster-resampling': 'linear',
          'raster-fade-duration': 200,
        },
      },
      beforeId,
    );
  } catch (err) {
    console.error('[wind-resource] could not add layer', err);
  }
}

/** Removes the active wind-resource layer + source (idempotent). */
export function removeWindResourceLayer(map: MlMap): void {
  try {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  } catch (err) {
    console.error('[wind-resource] could not remove layer', err);
  }
}

/** Re-tune the active layer's opacity for the current basemap (no-op when
 *  no layer is on). Call on basemap switches. */
export function setWindResourceContrast(
  map: MlMap,
  contrast: WindResourceContrast,
): void {
  try {
    if (map.getLayer(LAYER_ID)) {
      map.setPaintProperty(LAYER_ID, 'raster-opacity', OPACITY[contrast] as never);
    }
  } catch (err) {
    console.error('[wind-resource] could not set contrast', err);
  }
}

/** Show/hide the active layer without tearing it down. */
export function setWindResourceVisibility(map: MlMap, visible: boolean): void {
  try {
    if (map.getLayer(LAYER_ID)) {
      map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  } catch (err) {
    console.error('[wind-resource] could not set visibility', err);
  }
}
