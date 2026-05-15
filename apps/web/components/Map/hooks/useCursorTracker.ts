import { useEffect, useState, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { CursorReadout } from '../types';
import type { BasemapId } from '../types';
import { lookupElevation } from '@/lib/elevation/lookup';

/**
 * Tracks the cursor's geographic position and resolves elevation from a
 * pre-baked India SRTM grid (apps/web/lib/elevation/india-grid.json) — no
 * network calls. Elevation is surfaced on every basemap.
 *
 * Returns null when the cursor is off-canvas.
 */
export function useCursorTracker(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  _mode?: BasemapId,
) {
  const [readout, setReadout] = useState<CursorReadout | null>(null);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      const zoom = m.getZoom();
      const elev = lookupElevation(lat, lng);
      setReadout({ lng, lat, zoom, elevation: elev });
    };
    const onLeave = () => setReadout(null);

    m.on('mousemove', onMove);
    m.on('mouseout', onLeave);

    return () => {
      m.off('mousemove', onMove);
      m.off('mouseout', onLeave);
    };
  }, [mapRef]);

  return readout;
}
