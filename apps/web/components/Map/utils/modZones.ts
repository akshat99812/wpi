import type { Map as MlMap } from 'maplibre-gl';
import metadata from '@/public/mod-zones/metadata.json';
import { BASE_PATH } from '@/lib/basePath';

/**
 * Ministry-of-Defence (MoD) wind-clearance raster overlay for the Pro map — a
 * single toggleable layer showing all seven states' defence-zone data at once,
 * from the pre-baked XYZ pyramid in public/mod-zones/ (see
 * scripts/build_mod_zones.py).
 *
 * The source KMZ files are raster SuperOverlays (the official state MoD maps);
 * the bake classifies each hatched zone by category and reprojects it to
 * EPSG:3857 XYZ tiles as CLEAN SOLID FILLS in a canonical traffic-light palette
 * (red = No WTG, amber = NOC to be obtained, green = NOC not required), with all
 * cartography / borders / background keyed out. Bounds, zoom range, the category
 * legend and the tile URL all come from the bake-emitted metadata.json — no
 * hand-mirrored constants.
 *
 * Added lazily on first enable (idempotent) and then shown/hidden by flipping
 * layer visibility, mirroring the Electricity-Grid + exclusion-raster patterns.
 */

export const MOD_ZONES_SOURCE_ID = 'mod-zones';
export const MOD_ZONES_LAYER_ID = 'mod-zones-raster';

/** One legend/category row, straight from the bake metadata. */
export interface ModZoneCategory {
  key: string;
  label: string;
  desc: string;
  /** Hex swatch colour — identical to the solid fill baked into the tiles. */
  color: string;
}

export const MOD_ZONE_CATEGORIES: ModZoneCategory[] = metadata.categories;
export const MOD_ZONES_ATTRIBUTION: string = metadata.attribution;

// Cache-bust for the baked tiles — bump build_mod_zones.py VERSION (which flows
// into metadata.tileVersion) after a re-bake so clients refetch.
const TILE_VERSION = metadata.tileVersion;

// The tiles are solid fills; a mid opacity keeps categories legible on both the
// light road basemap and satellite while letting the basemap show through.
const RASTER_OPACITY = 0.55;

interface AddOptions {
  /** Insert below this layer (e.g. state boundaries / pins) so they stay on top. */
  beforeId?: string;
}

/**
 * Adds the MoD-zones raster source + layer if not already present (idempotent).
 * Safe to call repeatedly — re-entry is a no-op once the layer exists.
 */
export function addModZones(map: MlMap, opts: AddOptions = {}): void {
  try {
    if (!map.getCanvas() || !map.isStyleLoaded()) return;

    if (!map.getSource(MOD_ZONES_SOURCE_ID)) {
      map.addSource(MOD_ZONES_SOURCE_ID, {
        type: 'raster',
        // BASE_PATH: public assets sit under the app's basePath in prod
        // (/terminal) — omitting it 404s the raster (as the wind-atlas tiles
        // once did). Empty in dev. See @/lib/basePath.
        tiles: [`${window.location.origin}${BASE_PATH}${metadata.tilePath}?v=${TILE_VERSION}`],
        tileSize: 256,
        minzoom: metadata.minzoom,
        // maxzoom = deepest baked level; MapLibre over-zooms past it instead of
        // requesting (and 404ing on) deeper tiles.
        maxzoom: metadata.maxzoom,
        // 7-state union bbox — no wasted tile requests over the rest of India.
        bounds: metadata.bounds as [number, number, number, number],
        attribution: MOD_ZONES_ATTRIBUTION,
      });
    }

    if (!map.getLayer(MOD_ZONES_LAYER_ID)) {
      const beforeId =
        opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;
      map.addLayer(
        {
          id: MOD_ZONES_LAYER_ID,
          type: 'raster',
          source: MOD_ZONES_SOURCE_ID,
          paint: {
            'raster-opacity': RASTER_OPACITY,
            'raster-resampling': 'nearest',
            'raster-fade-duration': 200,
          },
        },
        beforeId,
      );
    }
  } catch (err) {
    console.error('[mod-zones] could not add layer', err);
  }
}

/** Show/hide the MoD-zones layer without tearing it down. */
export function setModZonesVisibility(map: MlMap, visible: boolean): void {
  try {
    if (map.getLayer(MOD_ZONES_LAYER_ID)) {
      map.setLayoutProperty(
        MOD_ZONES_LAYER_ID,
        'visibility',
        visible ? 'visible' : 'none',
      );
    }
  } catch (err) {
    console.error('[mod-zones] could not set visibility', err);
  }
}

/** Removes the MoD-zones layer + source (idempotent). */
export function removeModZones(map: MlMap): void {
  try {
    if (map.getLayer(MOD_ZONES_LAYER_ID)) map.removeLayer(MOD_ZONES_LAYER_ID);
    if (map.getSource(MOD_ZONES_SOURCE_ID)) map.removeSource(MOD_ZONES_SOURCE_ID);
  } catch (err) {
    console.error('[mod-zones] could not remove layer', err);
  }
}
