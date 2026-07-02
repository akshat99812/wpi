import type { Map as MlMap } from 'maplibre-gl';
import {
  DEM_SOURCE_ID,
  HILLSHADE_LAYER_ID,
  ensureDemSource,
  overlayAnchor,
} from './demShared';

/**
 * 3D terrain for the Pro map — MapLibre's native terrain mesh driven by the
 * shared `raster-dem` source (demShared.ts), plus a hillshade layer for slope
 * depth and an atmospheric sky when pitched.
 *
 * Rendering is entirely MapLibre v5 native (research §1): `setTerrain` displaces
 * the flat map into a mesh, `hillshade` shades slopes, `setSky` adds the
 * horizon/fog when the camera tilts. The wind-resource raster + the elevation
 * tint drape onto the mesh automatically — no extra work.
 */

export const DEFAULT_EXAGGERATION = 2.5; // pronounced relief by default (== MAX)
export const MIN_EXAGGERATION = 1;
export const MAX_EXAGGERATION = 2.5;

// Tilt the camera into a clear 3D view on enable; raise the ceiling so users
// can pitch further (v5 default maxPitch is 60). Sky only renders when pitched.
const TERRAIN_PITCH = 60;
const TERRAIN_MAX_PITCH = 85;

const clampExaggeration = (x: number): number =>
  Math.max(MIN_EXAGGERATION, Math.min(MAX_EXAGGERATION, x));

/**
 * Turn 3D terrain on: ensure the DEM source, add hillshade (above any elevation
 * tint, below the data overlays), set the sky, raise the pitch ceiling, attach
 * the terrain mesh, and ease into a tilted view.
 */
export function enableTerrain(
  map: MlMap,
  exaggeration: number = DEFAULT_EXAGGERATION,
): void {
  try {
    if (!map.getCanvas() || !map.isStyleLoaded()) return;
    if (!ensureDemSource(map)) return;

    // Hillshade sits just below the overlay anchor. If the elevation tint is
    // already present (added below the same anchor earlier), inserting here
    // automatically lands the hillshade ABOVE it — relief shading on top of the
    // colour, exactly as the tint wants (elevationTint.ts / research §8.5).
    if (!map.getLayer(HILLSHADE_LAYER_ID)) {
      map.addLayer(
        {
          id: HILLSHADE_LAYER_ID,
          type: 'hillshade',
          source: DEM_SOURCE_ID,
          paint: {
            'hillshade-exaggeration': 0.6,
            'hillshade-shadow-color': '#0b1020',
            'hillshade-accent-color': '#1a2236',
          },
        },
        overlayAnchor(map),
      );
    }

    map.setSky({
      'sky-color': '#0a0e18',
      'horizon-color': '#1a2236',
      'fog-color': '#0a0e18',
      'sky-horizon-blend': 0.5,
      'fog-ground-blend': 0.5,
    });
    map.setMaxPitch(TERRAIN_MAX_PITCH);
    map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: clampExaggeration(exaggeration) });
    if (map.getPitch() < TERRAIN_PITCH) {
      map.easeTo({ pitch: TERRAIN_PITCH, duration: 600 });
    }
  } catch (err) {
    console.error('[terrain] could not enable terrain', err);
  }
}

/**
 * Turn 3D terrain off: detach the mesh, drop the hillshade, and flatten the
 * camera back to top-down (sky isn't drawn at pitch 0). The DEM source is left
 * in place — it costs nothing without a referencing layer and lets a re-enable
 * skip the tile refetch. maxPitch stays raised so casual tilting still works.
 */
export function disableTerrain(map: MlMap): void {
  try {
    if (!map.getCanvas()) return;
    map.setTerrain(null);
    if (map.getLayer(HILLSHADE_LAYER_ID)) map.removeLayer(HILLSHADE_LAYER_ID);
    if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 500 });
  } catch (err) {
    console.error('[terrain] could not disable terrain', err);
  }
}

/** Live-update the terrain exaggeration (no-op when terrain isn't active). */
export function setTerrainExaggeration(map: MlMap, exaggeration: number): void {
  try {
    if (!map.getTerrain()) return;
    map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: clampExaggeration(exaggeration) });
  } catch (err) {
    console.error('[terrain] could not set exaggeration', err);
  }
}
