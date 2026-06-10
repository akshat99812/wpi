import { useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { LAYER_IDS } from '../constants';
import {
  addWindResourceLayer,
  removeWindResourceLayer,
} from '../utils/windResource';

/**
 * Global Wind Atlas wind-speed overlay for the MAIN map's "Wind" basemap
 * (mean speed @ a selectable hub height).
 *
 * Thin adapter over utils/windResource.ts, which owns all wind-resource
 * raster logic (speed AND power density, metadata-driven) for both maps.
 * Kept as a hook so MapCanvas's wiring is unchanged.
 *
 * Height switching: raster sources can't change their tile template in place,
 * so install() is a remove + re-add under the hood. Inserted BENEATH the
 * india-state-fill hover layer so boundary clicks/hover still fire.
 */
export function useWindLayer() {
  const install = useCallback((m: maplibregl.Map, height: number) => {
    addWindResourceLayer(m, 'speed', height, { beforeId: LAYER_IDS.indiaFill });
  }, []);

  const remove = useCallback((m: maplibregl.Map) => {
    removeWindResourceLayer(m);
  }, []);

  return { install, remove };
}
