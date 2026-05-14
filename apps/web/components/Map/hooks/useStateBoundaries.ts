import { useCallback, useRef, MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import {
  STATE_DATA,
  GEOJSON_NAME_MAP,
  INDIA_GEOJSON_URL,
  INDIA_GEOJSON_FALLBACK_URL,
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
let cachedLabelGeoJSON: GeoJSON.FeatureCollection | null = null;

// ── Centroid helpers (no turf dependency) ─────────────────────────────────
// For each MultiPolygon state we pick the centroid of the largest polygon
// part — otherwise MapLibre renders one label per ring (islands, exclaves)
// and the same state name appears 3–5 times on zoom.
function ringArea(coords: number[][]): number {
  let area = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    area += coords[j][0] * coords[i][1];
    area -= coords[i][0] * coords[j][1];
  }
  return Math.abs(area / 2);
}

function ringCentroid(coords: number[][]): [number, number] {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const f = coords[j][0] * coords[i][1] - coords[i][0] * coords[j][1];
    cx += (coords[j][0] + coords[i][0]) * f;
    cy += (coords[j][1] + coords[i][1]) * f;
    a += f;
  }
  a *= 3;
  // Degenerate (a ≈ 0): fall back to coordinate mean.
  if (Math.abs(a) < 1e-9) {
    const sum = coords.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0]);
    return [sum[0] / coords.length, sum[1] / coords.length];
  }
  return [cx / a, cy / a];
}

function featureLabelPoint(f: GeoJSON.Feature): [number, number] | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === 'Polygon') {
    return ringCentroid(g.coordinates[0]);
  }
  if (g.type === 'MultiPolygon') {
    let bestRing: number[][] | null = null;
    let bestArea = -1;
    for (const poly of g.coordinates) {
      const outer = poly[0];
      const a = ringArea(outer);
      if (a > bestArea) { bestArea = a; bestRing = outer; }
    }
    return bestRing ? ringCentroid(bestRing) : null;
  }
  return null;
}

// Different India-states GeoJSONs use different property keys for the state
// name — jbrobst's gist uses ST_NM, geohacker uses NAME_1, datameet uses name.
// Pull the first non-empty value.
function extractStateName(props: Record<string, unknown> | null | undefined): string {
  if (!props) return '';
  for (const key of ['ST_NM', 'NAME_1', 'name', 'STATE', 'state_name']) {
    const v = props[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

async function fetchFirstWorking(urls: string[]): Promise<GeoJSON.FeatureCollection | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as GeoJSON.FeatureCollection;
      if (data?.features?.length) return data;
    } catch {
      // try next
    }
  }
  return null;
}

async function loadIndiaGeoJSON(): Promise<GeoJSON.FeatureCollection | null> {
  if (cachedGeoJSON) return cachedGeoJSON;

  const full = await fetchFirstWorking([INDIA_GEOJSON_URL, INDIA_GEOJSON_FALLBACK_URL]);
  if (!full) {
    console.error('Failed to load India GeoJSON from all sources');
    return null;
  }

  let idx = 1;
  const windStateNames = new Set(Object.keys(GEOJSON_NAME_MAP));
  const labelFeatures: GeoJSON.Feature[] = [];

  cachedGeoJSON = {
    type: 'FeatureCollection',
    features: full.features.map(f => {
      const name = extractStateName(f.properties as Record<string, unknown> | null);
      const key  = GEOJSON_NAME_MAP[name] ?? name;
      const data = key ? STATE_DATA[key] : null;
      const enriched: GeoJSON.Feature = {
        ...f,
        id: idx++,
        properties: {
          ...f.properties,
          // Normalise to NAME_1 / stateName so downstream code (label layer,
          // hover, click) doesn't care which source we loaded from.
          NAME_1:      name,
          stateName:   name,
          isWindState: windStateNames.has(name),
          windMs:      data?.windMs    ?? 0,
          mw:          data?.mw        ?? 0,
          plf:         data?.plf       ?? 0,
          potential:   data?.potential ?? 0,
        },
      };

      const pt = featureLabelPoint(enriched);
      if (pt && name) {
        labelFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pt },
          properties: { NAME_1: name, stateName: name },
        });
      }

      return enriched;
    }),
  };

  cachedLabelGeoJSON = {
    type: 'FeatureCollection',
    features: labelFeatures,
  };

  return cachedGeoJSON;
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
export function useStateBoundaries({ mapRef: _mapRef, modeRef, stateRef, selectRef, setTooltip }: Args) {
  const installedRef = useRef(false);
  const cleanupRef   = useRef<(() => void) | null>(null);

  const install = useCallback(async (m: maplibregl.Map) => {
    // Tear down any previous install before adding new handlers — otherwise
    // each basemap switch stacks another mousemove listener with its own
    // hoveredId closure, and the first one to fire wins the tooltip update.
    cleanupRef.current?.();
    cleanupRef.current = null;

    const data = await loadIndiaGeoJSON();
    if (!data) return;
    // The map could have been torn down or restyled mid-fetch.
    if (!m.getCanvas()) return;

    const isLight = modeRef.current === 'street' || modeRef.current === 'terrain';
    const lineColor      = isLight ? 'rgba(0,0,0,0.75)'    : 'rgba(255,255,255,0.7)';
    const lineColorHover = isLight ? 'rgba(0,0,0,0.95)'    : '#ffb366';
    const fillColorHover = isLight ? 'rgba(0,0,0,0.08)'    : 'rgba(255,180,80,0.18)';

    // Source — polygons (boundary + hover hit-testing)
    if (!m.getSource(SOURCE_IDS.india)) {
      m.addSource(SOURCE_IDS.india, {
        type: 'geojson',
        data,
      });
    }

    // Source — labels (one Point per state at the largest-polygon centroid).
    // Keeps a single label per state even when the polygon is a MultiPolygon
    // with islands/exclaves that would otherwise each get their own label.
    if (cachedLabelGeoJSON && !m.getSource(SOURCE_IDS.indiaLabels)) {
      m.addSource(SOURCE_IDS.indiaLabels, {
        type: 'geojson',
        data: cachedLabelGeoJSON,
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
            fillColorHover,
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
            lineColorHover,
            lineColor,
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            3.5,
            1.0,
          ],
        },
      });
    }

    // State name labels — one Point per state from the labels source.
    if (!m.getLayer(LAYER_IDS.indiaLabel)) {
      m.addLayer({
        id: LAYER_IDS.indiaLabel,
        type: 'symbol',
        source: SOURCE_IDS.indiaLabels,
        minzoom: 4,
        layout: {
          'text-field': ['get', 'NAME_1'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 7, 13],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-max-width': 8,
          'text-anchor': 'center',
          // Prevent neighbouring states from colliding into a single overlap
          // at low zoom — MapLibre will drop one if the boxes intersect.
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-padding': 2,
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
      // Use the mapped key when available (matches STATE_DATA / STATE_PROFILES);
      // otherwise fall back to the raw GeoJSON name so the TabPanel can render
      // the no-profile notice for non-primary wind states.
      const key = GEOJSON_NAME_MAP[stateName] ?? stateName;
      const cur = stateRef.current;
      selectRef.current?.(cur === key ? null : key);
    };

    // Use map-wide mousemove (not layer-specific) so the handler fires on
    // every cursor movement and we can recompute the hovered state from
    // queryRenderedFeatures. Layer-specific mousemove can miss transitions
    // between adjacent features in some MapLibre versions.
    m.on('mousemove',  onMouseMove);
    m.on('mouseleave', LAYER_IDS.indiaFill, onMouseLeave);
    m.on('click',      LAYER_IDS.indiaFill, onClick);

    cleanupRef.current = () => {
      m.off('mousemove',  onMouseMove);
      m.off('mouseleave', LAYER_IDS.indiaFill, onMouseLeave);
      m.off('click',      LAYER_IDS.indiaFill, onClick);
    };
    installedRef.current = true;
  }, [modeRef, stateRef, selectRef, setTooltip]);

  const remove = useCallback((m: maplibregl.Map) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    [LAYER_IDS.indiaLabel, LAYER_IDS.indiaBoundary, LAYER_IDS.indiaFill].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    if (m.getSource(SOURCE_IDS.india))       m.removeSource(SOURCE_IDS.india);
    if (m.getSource(SOURCE_IDS.indiaLabels)) m.removeSource(SOURCE_IDS.indiaLabels);
    installedRef.current = false;
  }, []);

  return { install, remove };
}
