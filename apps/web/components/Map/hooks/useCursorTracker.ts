import { useEffect, useRef, useState, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { CursorReadout } from '../types';
import type { BasemapId } from '../types';
import { lookupElevation } from '@/lib/elevation/lookup';

/**
 * Tracks the cursor's geographic position + the map's current zoom so the
 * bottom readout can show "Lat 22.937 · Lng 78.661 · Z 5.4 · Elev 568 m".
 *
 * Elevation is resolved synchronously from a pre-baked India SRTM grid
 * (apps/web/lib/elevation/india-grid.json) — no network calls, no
 * debouncing, no skeletons. Only populated in terrain mode.
 *
 * Returns null when the cursor is off-canvas.
 */
export function useCursorTracker(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  mode?: BasemapId,
) {
  const [readout, setReadout] = useState<CursorReadout | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      const zoom = m.getZoom();
      if (modeRef.current === 'terrain') {
        const elev = lookupElevation(lat, lng);
        setReadout({ lng, lat, zoom, elevation: elev });
      } else {
        setReadout({ lng, lat, zoom });
      }
    };
    const onLeave = () => setReadout(null);
    const onZoom = () => {
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

  // When leaving terrain mode, strip the elevation field entirely so the
  // readout no longer renders the Elev pill.
  useEffect(() => {
    if (mode !== 'terrain') {
      setReadout(prev => {
        if (!prev) return prev;
        const { elevation: _drop, ...rest } = prev;
        return rest;
      });
    }
  }, [mode]);

  return readout;
}
