"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { WpiBundle } from '@/lib/types';

// ── Basemap modes ──────────────────────────────────────────────────────────
export type BasemapId = 'satellite' | 'terrain' | 'wind' | 'street' | 'pro';

const BASEMAP_LABELS: Record<BasemapId, string> = {
  satellite: '🛰 Satellite',
  terrain:   '⛰ Terrain',
  wind:      '💨 Wind',
  street:    '🗺 Street',
  pro:       '⚫ Pro',
};

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    sat: {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
    },
  },
  layers: [{ id: 'sat', type: 'raster' as const, source: 'sat' }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStyle(mode: BasemapId): any {
  if (mode === 'satellite' || mode === 'wind') return SATELLITE_STYLE;
  if (mode === 'terrain') return {
    version: 8, sources: { ter: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri' } },
    layers: [{ id: 'ter', type: 'raster', source: 'ter' }],
  };
  if (mode === 'street') return 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  return 'https://tiles.openfreemap.org/styles/liberty';
}

// ── State wind data ────────────────────────────────────────────────────────
const STATE_DATA: Record<string, { lon: number; lat: number; mw: number; plf: number; windMs: number; potential: number }> = {
  'Gujarat':          { lon: 71.57, lat: 22.26, mw: 11000, plf: 34, windMs: 7.2, potential: 142 },
  'Tamil Nadu':       { lon: 78.66, lat: 11.13, mw: 9500,  plf: 36, windMs: 7.8, potential: 103 },
  'Rajasthan':        { lon: 74.22, lat: 27.02, mw: 7100,  plf: 32, windMs: 7.5, potential: 128 },
  'Karnataka':        { lon: 75.71, lat: 15.32, mw: 6100,  plf: 30, windMs: 6.8, potential: 55  },
  'Andhra Pradesh':   { lon: 79.74, lat: 15.91, mw: 4200,  plf: 28, windMs: 7.0, potential: 44  },
  'Maharashtra':      { lon: 75.71, lat: 19.75, mw: 3800,  plf: 26, windMs: 6.2, potential: 62  },
  'Madhya Pradesh':   { lon: 78.66, lat: 22.97, mw: 2700,  plf: 24, windMs: 5.8, potential: 38  },
  'Telangana':        { lon: 79.02, lat: 18.11, mw: 920,   plf: 22, windMs: 6.5, potential: 18  },
};

// GeoJSON NAME_1 values that map to our STATE_DATA keys
const GEOJSON_NAME_MAP: Record<string, string> = {
  'Gujarat':        'Gujarat',
  'Tamil Nadu':     'Tamil Nadu',
  'Rajasthan':      'Rajasthan',
  'Karnataka':      'Karnataka',
  'Andhra Pradesh': 'Andhra Pradesh',
  'Maharashtra':    'Maharashtra',
  'Madhya Pradesh': 'Madhya Pradesh',
  'Telangana':      'Telangana',
};

// Wind colour per state (fill tint based on windMs)
function windFillColor(windMs: number): string {
  if (windMs >= 8)   return 'rgba(215,48,39,0.22)';
  if (windMs >= 7)   return 'rgba(244,109,67,0.20)';
  if (windMs >= 6.5) return 'rgba(253,174,97,0.18)';
  if (windMs >= 6)   return 'rgba(254,224,144,0.15)';
  return 'rgba(171,217,233,0.12)';
}

function mwColor(mw: number) {
  if (mw >= 8000) return '#4cc87a';
  if (mw >= 5000) return '#ffb066';
  if (mw >= 2000) return '#f5a623';
  return '#e85c5c';
}

// ── Windmill SVG marker ────────────────────────────────────────────────────
function createWindFarmEl(color: string, mw: number): { el: HTMLElement; inner: HTMLElement; overlay: HTMLElement; sc: number } {
  const el = document.createElement('div');
  el.style.cssText = 'width:40px;height:50px;pointer-events:none;';

  const inner = document.createElement('div');
  const sc = Math.min(1.3, Math.max(0.85, 0.85 + (mw / 10000) * 0.45));
  inner.style.cssText = `position:absolute;inset:0;transform-origin:bottom center;transform:scale(${sc});transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;`;
  inner.innerHTML = `
    <svg width="40" height="50" viewBox="0 0 40 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>.wm-spin{animation:wm-r 3s linear infinite;transform-origin:20px 18px}@keyframes wm-r{to{transform:rotate(360deg)}}</style>
      <ellipse cx="20" cy="48" rx="12" ry="2" fill="${color}" opacity="0.3"/>
      <ellipse cx="20" cy="48" rx="6" ry="1" fill="${color}" opacity="0.6"/>
      <polygon points="17.5,48 22.5,48 21.5,18 18.5,18" fill="#94a3b8"/>
      <polygon points="20,48 22.5,48 21.5,18 20,18" fill="#64748b"/>
      <g class="wm-spin">
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${color}" opacity="0.95"/>
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${color}" opacity="0.95" transform="rotate(120,20,18)"/>
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${color}" opacity="0.95" transform="rotate(240,20,18)"/>
      </g>
      <circle cx="20" cy="18" r="3" fill="${color}"/>
      <circle cx="20" cy="18" r="1.5" fill="white"/>
    </svg>`;
  el.appendChild(inner);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:-10px;z-index:10;cursor:pointer;pointer-events:auto;';
  el.appendChild(overlay);

  return { el, inner, overlay, sc };
}

// ── Wind atlas heatmap points ──────────────────────────────────────────────
const WIND_ATLAS_DATA = [
  { lon: 71.57, lat: 22.26, windMs: 7.2 }, { lon: 72.5,  lat: 23.5,  windMs: 8.1 },
  { lon: 70.8,  lat: 20.5,  windMs: 7.8 }, { lon: 73.0,  lat: 21.0,  windMs: 8.5 },
  { lon: 78.66, lat: 11.13, windMs: 7.8 }, { lon: 79.5,  lat: 11.5,  windMs: 8.2 },
  { lon: 77.5,  lat: 12.5,  windMs: 7.1 }, { lon: 74.22, lat: 27.02, windMs: 7.5 },
  { lon: 73.5,  lat: 26.5,  windMs: 8.1 }, { lon: 75.5,  lat: 28.5,  windMs: 7.2 },
  { lon: 75.71, lat: 15.32, windMs: 6.8 }, { lon: 75.2,  lat: 14.5,  windMs: 7.1 },
  { lon: 79.74, lat: 15.91, windMs: 7.0 }, { lon: 80.5,  lat: 16.5,  windMs: 7.3 },
  { lon: 75.71, lat: 19.75, windMs: 6.2 }, { lon: 74.5,  lat: 18.5,  windMs: 6.8 },
  { lon: 78.66, lat: 22.97, windMs: 5.8 }, { lon: 77.5,  lat: 23.5,  windMs: 6.2 },
  { lon: 79.02, lat: 18.11, windMs: 6.5 }, { lon: 76.0,  lat: 24.0,  windMs: 5.2 },
  { lon: 81.0,  lat: 20.0,  windMs: 5.5 }, { lon: 82.5,  lat: 25.0,  windMs: 4.8 },
];

// ── Types ──────────────────────────────────────────────────────────────────
interface TooltipState { x: number; y: number; state: string; mw: number; plf: number; windMs: number; potential: number }
interface Props {
  bundle?: WpiBundle;
  selectedState?: string | null;
  basemap?: BasemapId;
  onStateSelect?: (s: string | null) => void;
  onBasemapChange?: (id: BasemapId) => void;
}

export default function MapCanvas({ bundle, selectedState, basemap = 'satellite', onStateSelect, onBasemapChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const markersRef   = useRef<maplibregl.Marker[]>([]);
  const modeRef      = useRef<BasemapId>(basemap);
  const bundleRef    = useRef(bundle);
  const stateRef     = useRef(selectedState);
  const selectRef    = useRef(onStateSelect);

  const [mode, setMode]       = useState<BasemapId>(basemap);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isFullscreen, setIsFs] = useState(false);

  useEffect(() => { bundleRef.current = bundle; }, [bundle]);
  useEffect(() => { stateRef.current = selectedState; }, [selectedState]);
  useEffect(() => { selectRef.current = onStateSelect; }, [onStateSelect]);

  // ── Windmill markers ───────────────────────────────────────────────────
  const placeMarkers = useCallback((m: maplibregl.Map) => {
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];
    const bun = bundleRef.current;
    Object.entries(STATE_DATA).forEach(([state, d]) => {
      const row = bun?.stateCapacity?.find(s => s.state === state);
      const mw  = row?.installed_mw ?? d.mw;
      const col = mwColor(mw);
      const { el, inner, overlay, sc } = createWindFarmEl(col, mw);
      overlay.addEventListener('mouseenter', () => {
        const p = m.project([d.lon, d.lat]);
        setTooltip({ x: p.x, y: p.y, state, mw, plf: d.plf, windMs: d.windMs, potential: d.potential });
        inner.style.transform = `scale(${sc * 1.15})`;
      });
      overlay.addEventListener('mouseleave', () => { setTooltip(null); inner.style.transform = `scale(${sc})`; });
      overlay.addEventListener('click', () => {
        const cur = stateRef.current;
        selectRef.current?.(cur === state ? null : state);
      });
      markersRef.current.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([d.lon, d.lat]).addTo(m));
    });
  }, []);

  const removeMarkers = useCallback(() => {
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];
  }, []);

  // ── Wind layers: heatmap + REAL state boundaries fetched from CDN ──────
  const addWindLayer = useCallback(async (m: maplibregl.Map) => {
    // 1. Heatmap
    const heatData = {
      type: 'FeatureCollection' as const,
      features: WIND_ATLAS_DATA.map(d => ({
        type: 'Feature' as const, properties: { windMs: d.windMs },
        geometry: { type: 'Point' as const, coordinates: [d.lon, d.lat] },
      })),
    };
    if (!m.getSource('gwa-wind')) m.addSource('gwa-wind', { type: 'geojson', data: heatData });
    if (!m.getLayer('gwa-heatmap')) {
      m.addLayer({
        id: 'gwa-heatmap', type: 'heatmap', source: 'gwa-wind',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'windMs'], 4, 0, 9, 1.8],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 1.2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 60, 5, 150, 7, 280],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(33,102,172,0)',
            0.1,  'rgba(103,169,207,0.8)',
            0.25, 'rgba(171,217,233,0.8)',
            0.4,  'rgba(254,224,144,0.9)',
            0.6,  'rgba(253,174,97,0.95)',
            0.8,  'rgba(244,109,67,0.95)',
            1,    'rgba(215,48,39,1)',
          ],
          'heatmap-opacity': 0.72,
        },
      });
    }

    // 2. Fetch real India state GeoJSON, filter to our wind states, assign numeric IDs
    let statesGeoJSON: GeoJSON.FeatureCollection;
    try {
      const res  = await fetch('https://raw.githubusercontent.com/geohacker/india/master/state/india_state.geojson');
      const full = await res.json() as GeoJSON.FeatureCollection;

      let idx = 1;
      const windStateNames = new Set(Object.keys(GEOJSON_NAME_MAP));
      statesGeoJSON = {
        type: 'FeatureCollection',
        features: full.features
          // Keep ALL states for boundaries, mark wind states with data
          .map(f => {
            const name = (f.properties as Record<string,string>)?.NAME_1 ?? '';
            const key  = GEOJSON_NAME_MAP[name];
            const data = key ? STATE_DATA[key] : null;
            return {
              ...f,
              id: idx++,
              properties: {
                ...f.properties,
                stateName:  name,
                isWindState: windStateNames.has(name),
                windMs:     data?.windMs ?? 0,
                mw:         data?.mw ?? 0,
                plf:        data?.plf ?? 0,
                potential:  data?.potential ?? 0,
              },
            };
          }),
      };
    } catch {
      console.error('Failed to load India GeoJSON');
      return;
    }

    // Guard: map might have been destroyed or mode switched while fetching
    if (!m.getCanvas() || modeRef.current !== 'wind') return;

    if (!m.getSource('wind-states')) {
      m.addSource('wind-states', { type: 'geojson', data: statesGeoJSON, promoteId: 'id' as unknown as string });
    } else {
      (m.getSource('wind-states') as maplibregl.GeoJSONSource).setData(statesGeoJSON);
    }

    // ALL India state boundaries — grey dashed lines
    if (!m.getLayer('india-state-border')) {
      m.addLayer({
        id: 'india-state-border',
        type: 'line',
        source: 'wind-states',
        paint: {
          'line-color': 'rgba(255,255,255,0.55)',
          'line-width': 0.8,
          'line-dasharray': [3, 2],
        },
      });
    }

    // Wind state fill — colour-coded by wind speed, transparent for non-wind states
    if (!m.getLayer('wind-state-fill')) {
      m.addLayer({
        id: 'wind-state-fill',
        type: 'fill',
        source: 'wind-states',
        filter: ['==', ['get', 'isWindState'], true],
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            'rgba(255,180,80,0.28)',
            // Static wind-speed tint
            ['>=', ['get', 'windMs'], 8],   'rgba(215,48,39,0.18)',
            ['>=', ['get', 'windMs'], 7],   'rgba(244,109,67,0.15)',
            ['>=', ['get', 'windMs'], 6.5], 'rgba(253,174,97,0.13)',
            ['>=', ['get', 'windMs'], 6],   'rgba(254,224,144,0.11)',
            /* else */                       'rgba(171,217,233,0.09)',
          ] as maplibregl.ExpressionSpecification,
          'fill-opacity': 1,
        },
      });
    }

    // Wind state borders — brighter + thicker than the grey all-India ones
    if (!m.getLayer('wind-state-line')) {
      m.addLayer({
        id: 'wind-state-line',
        type: 'line',
        source: 'wind-states',
        filter: ['==', ['get', 'isWindState'], true],
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            '#ffb366',
            'rgba(255,255,255,0.75)',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            2.5, 1.2,
          ],
        },
      });
    }

    // Wind state name labels
    if (!m.getLayer('wind-state-label')) {
      m.addLayer({
        id: 'wind-state-label',
        type: 'symbol',
        source: 'wind-states',
        filter: ['==', ['get', 'isWindState'], true],
        layout: {
          'text-field': ['get', 'NAME_1'],
          'text-size': 10,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-max-width': 8,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': 'rgba(255,255,255,0.85)',
          'text-halo-color': 'rgba(0,0,0,0.6)',
          'text-halo-width': 1.5,
        },
      });
    }

    // 3. Hover interaction
    let hoveredId: number | string | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onMouseMove = (e: any) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ['wind-state-fill'] });
      m.getCanvas().style.cursor = features.length ? 'pointer' : '';

      if (features.length) {
        const feat      = features[0];
        const fId       = feat.id as number | string;
        const stateName = feat.properties?.stateName as string ?? feat.properties?.NAME_1 as string;
        const key       = GEOJSON_NAME_MAP[stateName] ?? stateName;
        const data      = STATE_DATA[key];

        if (fId !== hoveredId) {
          if (hoveredId !== null) m.setFeatureState({ source: 'wind-states', id: hoveredId }, { hover: false });
          hoveredId = fId;
          m.setFeatureState({ source: 'wind-states', id: hoveredId }, { hover: true });
        }

        if (data) {
          setTooltip({ x: e.point.x, y: e.point.y, state: key, mw: data.mw, plf: data.plf, windMs: data.windMs, potential: data.potential });
        }
      } else {
        if (hoveredId !== null) {
          m.setFeatureState({ source: 'wind-states', id: hoveredId }, { hover: false });
          hoveredId = null;
        }
        setTooltip(null);
      }
    };

    const onMouseLeave = () => {
      if (hoveredId !== null) { m.setFeatureState({ source: 'wind-states', id: hoveredId }, { hover: false }); hoveredId = null; }
      m.getCanvas().style.cursor = '';
      setTooltip(null);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onClick = (e: any) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ['wind-state-fill'] });
      if (features.length) {
        const stateName = features[0].properties?.stateName as string ?? features[0].properties?.NAME_1 as string;
        const key = GEOJSON_NAME_MAP[stateName] ?? stateName;
        const cur = stateRef.current;
        selectRef.current?.(cur === key ? null : key);
      }
    };

    m.on('mousemove', 'wind-state-fill', onMouseMove);
    m.on('mouseleave', 'wind-state-fill', onMouseLeave);
    m.on('click', 'wind-state-fill', onClick);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m as any)._windCleanup = () => {
      m.off('mousemove', 'wind-state-fill', onMouseMove);
      m.off('mouseleave', 'wind-state-fill', onMouseLeave);
      m.off('click', 'wind-state-fill', onClick);
    };
  }, []);

  // ── Remove wind layers ─────────────────────────────────────────────────
  const removeWindLayer = useCallback((m: maplibregl.Map) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m as any)._windCleanup?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (m as any)._windCleanup;
    ['gwa-heatmap','wind-state-fill','wind-state-line','india-state-border','wind-state-label']
      .forEach(id => { if (m.getLayer(id)) m.removeLayer(id); });
    ['gwa-wind','wind-states']
      .forEach(id => { if (m.getSource(id)) m.removeSource(id); });
    m.getCanvas().style.cursor = '';
    setTooltip(null);
  }, []);

  // ── Init map ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: getStyle(basemap),
      center: [78.5, 21.5],
      zoom: 4.2,
      attributionControl: false,
    });
    mapRef.current = m;
    modeRef.current = basemap;
    m.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
    return () => { markersRef.current.forEach(mk => mk.remove()); m.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── style.load handler ─────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const fn = () => {
      if (modeRef.current === 'wind') { removeMarkers(); addWindLayer(m); }
      else { removeWindLayer(m); placeMarkers(m); }
    };
    m.on('style.load', fn);
    if (m.isStyleLoaded()) fn();
    return () => { m.off('style.load', fn); };
  }, [placeMarkers, addWindLayer, removeMarkers, removeWindLayer]);

  // ── Bundle change ──────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded() || modeRef.current === 'wind') return;
    placeMarkers(m);
  }, [bundle, placeMarkers]);

  // ── Switch basemap ─────────────────────────────────────────────────────
  const switchMode = (next: BasemapId) => {
    const prev = modeRef.current;
    modeRef.current = next;
    setMode(next);
    onBasemapChange?.(next);
    setTooltip(null);
    const m = mapRef.current;
    if (!m) return;
    const sameBase = (prev === 'satellite' || prev === 'wind') && (next === 'satellite' || next === 'wind');
    if (sameBase) {
      if (next === 'wind') { removeMarkers(); if (m.isStyleLoaded()) addWindLayer(m); }
      else                 { removeWindLayer(m); if (m.isStyleLoaded()) placeMarkers(m); }
    } else {
      m.setStyle(getStyle(next));
    }
  };

  // ── Fullscreen ─────────────────────────────────────────────────────────
  const toggleFs = () => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) { el.requestFullscreen(); setIsFs(true); }
    else { document.exitFullscreen(); setIsFs(false); }
  };
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Mode switcher ── */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5 bg-gradient-to-r from-black/70 to-black/50 backdrop-blur-lg border border-white/15 rounded-2xl px-2 py-2 shadow-2xl">
          {(Object.keys(BASEMAP_LABELS) as BasemapId[]).map(id => (
            <button key={id} onClick={() => switchMode(id)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all duration-200 whitespace-nowrap ${
                mode === id
                  ? id === 'wind'
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-900 shadow-[0_0_16px_rgba(34,211,238,0.6)] scale-105'
                    : 'bg-orange-400 text-[#0a0e18] shadow-[0_0_12px_rgba(255,138,31,0.55)]'
                  : 'text-white/50 hover:text-white hover:bg-white/10'
              }`}>
              {BASEMAP_LABELS[id]}
            </button>
          ))}
        </div>

        {mode === 'wind' && (
          <div className="bg-gradient-to-b from-black/75 to-black/85 backdrop-blur-md border border-cyan-400/40 rounded-xl px-4 py-3 shadow-2xl">
            <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest mb-2.5">💨 Wind Speed (m/s)</div>
            <div className="space-y-1.5">
              {([
                ['#2166ac','#67a9cf','Low (4–5)'],
                ['#abd9e9','#fee090','Moderate (5–6)'],
                ['#fdae61','#f46d43','Good (6–7)'],
                ['#f46d43','#d73027','High (7–9+)'],
              ] as [string,string,string][]).map(([from,to,label]) => (
                <div key={label} className="flex items-center gap-2.5">
                  <div className="w-6 h-2 rounded-full flex-shrink-0" style={{ background: `linear-gradient(90deg,${from},${to})` }} />
                  <span className="text-[9px] text-white/70">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-cyan-400/20 text-[8px] text-cyan-300/60 italic">
              Satellite + Wind Atlas · Hover states for details
            </div>
          </div>
        )}
      </div>

      {/* ── Fullscreen ── */}
      <button onClick={toggleFs}
        className="absolute top-3 right-12 z-20 w-8 h-8 flex items-center justify-center bg-black/65 backdrop-blur-md border border-white/10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all shadow-xl text-sm">
        {isFullscreen ? '⊠' : '⛶'}
      </button>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div className="absolute pointer-events-none z-30 w-[220px]"
          style={{ left: tooltip.x + 18, top: Math.max(8, tooltip.y - 160) }}>
          <div className="absolute inset-0 rounded-2xl blur-xl opacity-40 bg-orange-500" />
          <div className="relative bg-[#060c1a] border border-orange-400/50 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.85)]">
            <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-white/15">
              <div className="w-7 h-7 rounded-lg bg-orange-400/15 border border-orange-400/30 flex items-center justify-center text-[13px]">💨</div>
              <span className="text-[13px] font-black text-white tracking-wide flex-1">{tooltip.state}</span>
              <div className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_2px_rgba(255,138,31,0.7)] animate-pulse" />
            </div>
            <div className="space-y-2">
              {([
                ['Installed',  `${(tooltip.mw/1000).toFixed(1)} GW`, '#ffb366', '⚡'],
                ['Wind Speed', `${tooltip.windMs} m/s`,               '#67e8f9', '🌬'],
                ['Avg PLF',    `${tooltip.plf}%`,                     '#4ade80', '📈'],
                ['Potential',  `${tooltip.potential} GW`,             '#a5b4fc', '🔭'],
              ] as [string,string,string,string][]).map(([l,v,c,icon]) => (
                <div key={l} className="flex items-center justify-between gap-2 bg-white/[0.04] rounded-lg px-2.5 py-1.5">
                  <span className="text-[10px] text-white/55 flex items-center gap-1.5">
                    <span className="text-[11px]">{icon}</span>{l}
                  </span>
                  <span className="text-[12px] font-black font-mono tracking-tight" style={{ color: c }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-orange-400" />
              <span className="text-[9px] text-orange-300 font-bold tracking-widest uppercase">Click to Filter Dashboard</span>
              <div className="w-1 h-1 rounded-full bg-orange-400" />
            </div>
          </div>
        </div>
      )}

      {/* ── Selected state badge ── */}
      {selectedState && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 bg-[#0e1527]/90 backdrop-blur-sm border border-orange-400/30 rounded-xl px-4 py-2 flex items-center gap-3 shadow-xl">
          <span className="text-[11px] text-orange-400 font-bold">📍 {selectedState}</span>
          <button onClick={() => onStateSelect?.(null)} className="text-white/40 hover:text-orange-400 text-xs">✕ Clear</button>
        </div>
      )}

      {/* ── Capacity legend (non-wind) ── */}
      {mode !== 'wind' && (
        <div className="absolute bottom-12 right-14 z-10 bg-black/65 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl">
          <div className="text-[8.5px] text-white/40 uppercase font-bold tracking-wide mb-1.5">Capacity</div>
          {[['#4cc87a','≥ 8 GW'],['#ffb066','5–8 GW'],['#f5a623','2–5 GW'],['#e85c5c','< 2 GW']].map(([c,l]) => (
            <div key={l} className="flex items-center gap-2 py-0.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
              <span className="text-[9px] text-white/40">{l}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}