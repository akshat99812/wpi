import { useEffect, RefObject, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { getStyle } from '../constants';
import type { BasemapId } from '../types';

interface Args {
  containerRef: RefObject<HTMLDivElement | null>;
  mapRef: MutableRefObject<maplibregl.Map | null>;
  modeRef: MutableRefObject<BasemapId>;
  initialBasemap: BasemapId;
}

/**
 * Creates the MapLibre instance once and tears it down on unmount.
 * Adds Navigation + Scale controls (the scale bar shows km because we set
 * the unit to 'metric').
 */
export function useMapInit({ containerRef, mapRef, modeRef, initialBasemap }: Args) {
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const m = new maplibregl.Map({
      container: containerRef.current,
      style: getStyle(initialBasemap),
      center: [78.5, 21.5],
      zoom: 4.2,
      attributionControl: false,
    });

    mapRef.current = m;
    modeRef.current = initialBasemap;

    m.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    // Scale bar — shows kilometres at the current zoom level.
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

    return () => {
      m.remove();
      mapRef.current = null;
    };
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
