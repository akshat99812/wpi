import { useEffect, useState, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { CursorReadout } from '../types';

/**
 * Tracks the cursor's geographic position + the map's current zoom so the
 * bottom readout can show "Lat 22.937 · Lng 78.661 · Z 5.4".
 *
 * Returns null when the cursor is off-canvas.
 */
export function useCursorTracker(mapRef: MutableRefObject<maplibregl.Map | null>) {
  const [readout, setReadout] = useState<CursorReadout | null>(null);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const onMove = (e: maplibregl.MapMouseEvent) => {
      setReadout({ lng: e.lngLat.lng, lat: e.lngLat.lat, zoom: m.getZoom() });
    };
    const onLeave = () => setReadout(null);
    const onZoom = () => {
      // Refresh zoom number even when the cursor is parked.
      setReadout(prev => (prev ? { ...prev, zoom: m.getZoom() } : prev));
    };

    m.on('mousemove', onMove);
    m.on('mouseout', onLeave);
    m.on('zoom', onZoom);

    return () => {
      m.off('mousemove', onMove);
      m.off('mouseout', onLeave);
      m.off('zoom', onZoom);
    };
  }, [mapRef]);

  return readout;
}
