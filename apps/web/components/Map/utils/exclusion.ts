import type { Map as MlMap } from 'maplibre-gl';
import metadata from '@/public/exclusions/metadata.json';

/**
 * Wind-exclusion raster overlay for the Pro map — a single toggleable layer
 * showing all state exclusion data at once, from the pre-baked XYZ pyramid in
 * public/exclusions/ (see scripts/build_exclusions.py).
 *
 * The source KMZ files are raster SuperOverlays (pre-rendered exclusion maps
 * per state); the bake reprojects them to EPSG:3857 XYZ tiles with the
 * background keyed transparent, so only the coloured exclusion zones overlay
 * the basemap. Bounds / zoom range / tile URL come from the bake-emitted
 * metadata.json — no hand-mirrored constants.
 *
 * Added lazily on first enable (idempotent) and then shown/hidden by flipping
 * layer visibility, mirroring the Electricity-Grid layer pattern.
 */

export const EXCLUSION_SOURCE_ID = 'exclusion';
export const EXCLUSION_LAYER_ID = 'exclusion-raster';

export const EXCLUSION_ATTRIBUTION: string = metadata.attribution;
export const EXCLUSION_STATES: { name: string }[] = metadata.states;

// Cache-bust for the baked tiles — bump (in build_exclusions.py VERSION, which
// flows into metadata.tileVersion) after a re-bake so clients refetch.
const TILE_VERSION = metadata.tileVersion;

// Only the coloured exclusion features are opaque (background was keyed out at
// bake time), so a high opacity keeps them legible while letting the basemap
// texture show faintly through.
const RASTER_OPACITY = 0.85;

interface AddOptions {
  /** Insert below this layer (e.g. state boundaries / pins) so they stay on top. */
  beforeId?: string;
}

/**
 * Adds the exclusion raster source + layer if not already present (idempotent).
 * Safe to call repeatedly — re-entry is a no-op once the layer exists.
 */
export function addExclusion(map: MlMap, opts: AddOptions = {}): void {
  try {
    if (!map.getCanvas() || !map.isStyleLoaded()) return;

    if (!map.getSource(EXCLUSION_SOURCE_ID)) {
      map.addSource(EXCLUSION_SOURCE_ID, {
        type: 'raster',
        tiles: [`${window.location.origin}${metadata.tilePath}?v=${TILE_VERSION}`],
        tileSize: 256,
        minzoom: metadata.minzoom,
        // maxzoom = deepest baked level; MapLibre over-zooms past it instead of
        // requesting (and 404ing on) deeper tiles.
        maxzoom: metadata.maxzoom,
        // 7-state union bbox — no wasted tile requests over the rest of India.
        bounds: metadata.bounds as [number, number, number, number],
        attribution: EXCLUSION_ATTRIBUTION,
      });
    }

    if (!map.getLayer(EXCLUSION_LAYER_ID)) {
      const beforeId =
        opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;
      map.addLayer(
        {
          id: EXCLUSION_LAYER_ID,
          type: 'raster',
          source: EXCLUSION_SOURCE_ID,
          paint: {
            'raster-opacity': RASTER_OPACITY,
            'raster-resampling': 'linear',
            'raster-fade-duration': 200,
          },
        },
        beforeId,
      );
    }
  } catch (err) {
    console.error('[exclusion] could not add layer', err);
  }
}

/** Show/hide the exclusion layer without tearing it down. */
export function setExclusionVisibility(map: MlMap, visible: boolean): void {
  try {
    if (map.getLayer(EXCLUSION_LAYER_ID)) {
      map.setLayoutProperty(
        EXCLUSION_LAYER_ID,
        'visibility',
        visible ? 'visible' : 'none',
      );
    }
  } catch (err) {
    console.error('[exclusion] could not set visibility', err);
  }
}

/** Removes the exclusion layer + source (idempotent). */
export function removeExclusion(map: MlMap): void {
  try {
    if (map.getLayer(EXCLUSION_LAYER_ID)) map.removeLayer(EXCLUSION_LAYER_ID);
    if (map.getSource(EXCLUSION_SOURCE_ID)) map.removeSource(EXCLUSION_SOURCE_ID);
  } catch (err) {
    console.error('[exclusion] could not remove layer', err);
  }
}
