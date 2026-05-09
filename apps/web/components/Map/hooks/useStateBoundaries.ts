import { useCallback, useRef, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import {
  STATE_DATA,
  GEOJSON_NAME_MAP,
  INDIA_GEOJSON_URL,
  LAYER_IDS,
  SOURCE_IDS,
} from '../constants';
import type { BasemapId, TooltipState } from '../types';

interface Args {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  modeRef: MutableRefObject<BasemapId>;
  stateRef: MutableRefObject<string | null | undefined>;
  selectRef: MutableRefObject<((s: string | null) => void) | undefined>;
  setTooltip: (t: TooltipState | null) => void;
}

// Cache the GeoJSON across style switches so we don't refetch.
let cachedGeoJSON: GeoJSON.FeatureCollection | null = null;

async function loadIndiaGeoJSON(): Promise<GeoJSON.FeatureCollection | null> {
  if (cachedGeoJSON) return cachedGeoJSON;
  try {
    const res  = await fetch(INDIA_GEOJSON_URL);
    const full = (await res.json()) as GeoJSON.FeatureCollection;

    let idx = 1;
    const windStateNames = new Set(Object.keys(GEOJSON_NAME_MAP));
    cachedGeoJSON = {
      type: 'FeatureCollection',
      features: full.features.map(f => {
        const name = (f.properties as Record<string, string>)?.NAME_1 ?? '';
        const key  = GEOJSON_NAME_MAP[name];
        const data = key ? STATE_DATA[key] : null;
        return {
          ...f,
          id: idx++,
          properties: {
            ...f.properties,
            stateName:   name,
            isWindState: windStateNames.has(name),
            windMs:      data?.windMs    ?? 0,
            mw:          data?.mw        ?? 0,
            plf:         data?.plf       ?? 0,
            potential:   data?.potential ?? 0,
          },
        };
      }),
    };
    return cachedGeoJSON;
  } catch {
    console.error('Failed to load India GeoJSON');
    return null;
  }
}

/**
 * Renders all-India state boundaries on every basemap (per spec change #4).
 *
 * Layers:
 *   - india-state-fill   — invisible fill used purely for hover hit-testing
 *   - india-state-border — thin white outline, always on top
 *   - india-state-label  — state name labels (small, halo'd)
 *
 * On wind mode this hook still installs the boundary layers; the wind hook
 * paints its tinted fill BELOW these so hover still works.
 */
export function useStateBoundaries({ mapRef: _mapRef, modeRef: _modeRef, stateRef, selectRef, setTooltip }: Args) {
  const installedRef = useRef(false);
  const cleanupRef   = useRef<(() => void) | null>(null);

  const install = useCallback(async (m: maplibregl.Map) => {
    const data = await loadIndiaGeoJSON();
    if (!data) return;
    // The map could have been torn down or restyled mid-fetch.
    if (!m.getCanvas()) return;

    // Source
    if (!m.getSource(SOURCE_IDS.india)) {
      m.addSource(SOURCE_IDS.india, {
        type: 'geojson',
        data,
        promoteId: 'id' as unknown as string,
      });
    }

    // Invisible fill — needed so queryRenderedFeatures hits the polygon.
    // Hover state is mirrored as a faint highlight so users can see what
    // they're targeting without competing with the basemap.
    if (!m.getLayer(LAYER_IDS.indiaFill)) {
      m.addLayer({
        id: LAYER_IDS.indiaFill,
        type: 'fill',
        source: SOURCE_IDS.india,
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            'rgba(255,180,80,0.18)',
            'rgba(0,0,0,0)',
          ],
          'fill-opacity': 1,
        },
      });
    }

    // Always-visible boundary outline.
    if (!m.getLayer(LAYER_IDS.indiaBoundary)) {
      m.addLayer({
        id: LAYER_IDS.indiaBoundary,
        type: 'line',
        source: SOURCE_IDS.india,
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            '#ffb366',
            'rgba(255,255,255,0.7)',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            2.2,
            1.0,
          ],
        },
      });
    }

    // State name labels.
    if (!m.getLayer(LAYER_IDS.indiaLabel)) {
      m.addLayer({
        id: LAYER_IDS.indiaLabel,
        type: 'symbol',
        source: SOURCE_IDS.india,
        minzoom: 4,
        layout: {
          'text-field': ['get', 'NAME_1'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 7, 13],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-max-width': 8,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': 'rgba(255,255,255,0.85)',
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 1.5,
        },
      });
    }

    // ── Hover + click on ALL states ─────────────────────────────────────
    let hoveredId: number | string | null = null;

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const features = m.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.indiaFill] });
      m.getCanvas().style.cursor = features.length ? 'pointer' : '';

      if (features.length) {
        const feat      = features[0];
        const fId       = feat.id as number | string;
        const stateName =
          (feat.properties?.stateName as string) ??
          (feat.properties?.NAME_1 as string);
        const key  = GEOJSON_NAME_MAP[stateName] ?? stateName;
        const data = STATE_DATA[key];

        if (fId !== hoveredId) {
          if (hoveredId !== null) {
            m.setFeatureState({ source: SOURCE_IDS.india, id: hoveredId }, { hover: false });
          }
          hoveredId = fId;
          m.setFeatureState({ source: SOURCE_IDS.india, id: hoveredId }, { hover: true });
        }

        // Only show the rich card for states we have wind data for.
        // For other states we still highlight the boundary on hover.
        if (data) {
          setTooltip({
            x: e.point.x,
            y: e.point.y,
            state: key,
            mw: data.mw,
            plf: data.plf,
            windMs: data.windMs,
            potential: data.potential,
          });
        } else {
          setTooltip(null);
        }
      } else {
        if (hoveredId !== null) {
          m.setFeatureState({ source: SOURCE_IDS.india, id: hoveredId }, { hover: false });
          hoveredId = null;
        }
        setTooltip(null);
      }
    };

    const onMouseLeave = () => {
      if (hoveredId !== null) {
        m.setFeatureState({ source: SOURCE_IDS.india, id: hoveredId }, { hover: false });
        hoveredId = null;
      }
      m.getCanvas().style.cursor = '';
      setTooltip(null);
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const features = m.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.indiaFill] });
      if (!features.length) return;
      const stateName =
        (features[0].properties?.stateName as string) ??
        (features[0].properties?.NAME_1 as string);
      const key = GEOJSON_NAME_MAP[stateName] ?? stateName;
      // Only filter by states we have data for.
      if (!STATE_DATA[key]) return;
      const cur = stateRef.current;
      selectRef.current?.(cur === key ? null : key);
    };

    m.on('mousemove',  LAYER_IDS.indiaFill, onMouseMove);
    m.on('mouseleave', LAYER_IDS.indiaFill, onMouseLeave);
    m.on('click',      LAYER_IDS.indiaFill, onClick);

    cleanupRef.current = () => {
      m.off('mousemove',  LAYER_IDS.indiaFill, onMouseMove);
      m.off('mouseleave', LAYER_IDS.indiaFill, onMouseLeave);
      m.off('click',      LAYER_IDS.indiaFill, onClick);
    };
    installedRef.current = true;
  }, [stateRef, selectRef, setTooltip]);

  const remove = useCallback((m: maplibregl.Map) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    [LAYER_IDS.indiaLabel, LAYER_IDS.indiaBoundary, LAYER_IDS.indiaFill].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    if (m.getSource(SOURCE_IDS.india)) m.removeSource(SOURCE_IDS.india);
    installedRef.current = false;
  }, []);

  return { install, remove };
}
