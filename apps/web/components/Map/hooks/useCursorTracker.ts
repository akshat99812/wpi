import { useEffect, useRef, useState, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { CursorReadout } from '../types';
import type { BasemapId } from '../types';
import { lookupElevation } from '@/lib/elevation/lookup';
import { lookupWind, loadWindGrid, isWindGridReady, type WindHeight } from '@/lib/wind/lookup';

/**
 * Tracks the cursor's geographic position and resolves elevation (pre-baked
 * SRTM grid) plus mean wind speed at the selected hub height (pre-baked Global
 * Wind Atlas grid for `height`) — both synchronous, no network calls.
 * Elevation surfaces on every basemap; the wind value drives the interactive
 * WindScale legend in wind mode.
 *
 * Returns null when the cursor is off-canvas.
 */
export function useCursorTracker(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  _mode: BasemapId | undefined,
  height: WindHeight,
) {
  const [readout, setReadout] = useState<CursorReadout | null>(null);
  // Last cursor position, so a height change can re-resolve wind without the
  // user moving the mouse (otherwise the bubble shows the prior height's value).
  const lastRef = useRef<{ lat: number; lng: number; zoom: number; elevation: number | null } | null>(null);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      const zoom = m.getZoom();
      const elevation = lookupElevation(lat, lng);
      lastRef.current = { lat, lng, zoom, elevation };
      setReadout({ lng, lat, zoom, elevation, wind: lookupWind(lat, lng, height) });
    };
    const onLeave = () => { lastRef.current = null; setReadout(null); };

    m.on('mousemove', onMove);
    m.on('mouseout', onLeave);

    return () => {
      m.off('mousemove', onMove);
      m.off('mouseout', onLeave);
    };
  }, [mapRef, height]);

  // Height changed → re-resolve wind for the held cursor immediately (shows
  // "—" if that height's grid isn't loaded yet, never a stale/mislabelled
  // value), then refresh once the grid finishes loading.
  useEffect(() => {
    const p = lastRef.current;
    if (!p) return;
    const resample = () =>
      setReadout(prev => (prev ? { ...prev, wind: lookupWind(p.lat, p.lng, height) } : prev));
    resample();
    if (!isWindGridReady(height)) void loadWindGrid(height).then(resample);
  }, [height]);

  return readout;
}
