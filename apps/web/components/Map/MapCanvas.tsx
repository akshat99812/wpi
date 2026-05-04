"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { WpiBundle } from '@/lib/types';

// ── 5 Basemap modes ────────────────────────────────────────────────────────
export type BasemapId = 'satellite' | 'terrain' | 'wind' | 'street' | 'pro';

const BASEMAP_LABELS: Record<BasemapId, string> = {
  satellite: '🛰 Satellite',
  terrain:   '⛰ Terrain',
  wind:      '💨 Wind',
  street:    '🗺 Street',
  pro:       '⚫ Pro',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStyle(mode: BasemapId): any {
  if (mode === 'satellite') return {
    version: 8, sources: {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri' }
    }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  };
  if (mode === 'terrain') return {
    version: 8, sources: {
      ter: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri' }
    }, layers: [{ id: 'ter', type: 'raster', source: 'ter' }],
  };
  if (mode === 'street') return 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  if (mode === 'wind')   return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  /* pro */              return 'https://tiles.openfreemap.org/styles/liberty';
}

// ── State data ─────────────────────────────────────────────────────────────
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

function mwColor(mw: number) {
  if (mw >= 8000) return '#4cc87a';
  if (mw >= 5000) return '#ffb066';
  if (mw >= 2000) return '#f5a623';
  return '#e85c5c';
}

// ── Windmill SVG generator ──
function createWindFarmEl(color: string, mw: number): { el: HTMLElement; inner: HTMLElement; overlay: HTMLElement; sc: number } {
  // Container size: width 40, height 50. The bottom center (20, 50) is the anchor point.
  const el = document.createElement('div');
  el.style.cssText = 'width: 40px; height: 50px; pointer-events: none;';
  
  const inner = document.createElement('div');
  // Scale the windmill slightly based on capacity (min 0.85, max 1.3)
  const sc = Math.min(1.3, Math.max(0.85, 0.85 + (mw / 10000) * 0.45));
  inner.style.cssText = `position: absolute; inset: 0; transform-origin: bottom center; transform: scale(${sc}); transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); pointer-events: none;`;
  
  // Single, highly aesthetic windmill. Tower base is at y=46, shadow at bottom y=50.
  inner.innerHTML = `
    <svg width="40" height="50" viewBox="0 0 40 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>.wm-spin{animation:wm-r 3s linear infinite;transform-origin:20px 18px}@keyframes wm-r{to{transform:rotate(360deg)}}</style>
      
      <!-- Base glow / shadow -->
      <ellipse cx="20" cy="48" rx="12" ry="2" fill="${color}" opacity="0.3" filter="blur(2px)"/>
      <ellipse cx="20" cy="48" rx="6" ry="1" fill="${color}" opacity="0.6"/>
      
      <!-- Tower -->
      <polygon points="17.5,48 22.5,48 21.5,18 18.5,18" fill="#94a3b8"/>
      <!-- Tower shadow/highlight for 3D effect -->
      <polygon points="20,48 22.5,48 21.5,18 20,18" fill="#64748b"/>
      
      <!-- Rotor blades -->
      <g class="wm-spin">
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${color}" opacity="0.95"/>
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${color}" opacity="0.95" transform="rotate(120,20,18)"/>
        <ellipse cx="20" cy="8" rx="2.5" ry="10" fill="${color}" opacity="0.95" transform="rotate(240,20,18)"/>
      </g>
      
      <!-- Rotor hub -->
      <circle cx="20" cy="18" r="3" fill="${color}"/>
      <circle cx="20" cy="18" r="1.5" fill="white"/>
    </svg>
  `;

  el.appendChild(inner);

  const overlay = document.createElement('div');
  // Extend overlay hit area
  overlay.style.cssText = 'position: absolute; inset: -10px; z-index: 10; cursor: pointer; pointer-events: auto;';
  el.appendChild(overlay);

  return { el, inner, overlay, sc };
}

// ── Types ──────────────────────────────────────────────────────────────────
interface TooltipState {
  x: number;
  y: number;
  state: string;
  mw: number;
  plf: number;
  windMs: number;
  potential: number;
}

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

  const [mode, setMode]         = useState<BasemapId>('satellite');
  const [tooltip, setTooltip]   = useState<TooltipState | null>(null);
  const [isFullscreen, setIsFs] = useState(false);

  // Keep refs fresh
  useEffect(() => { bundleRef.current = bundle; }, [bundle]);
  useEffect(() => { stateRef.current = selectedState; }, [selectedState]);
  useEffect(() => { selectRef.current = onStateSelect; }, [onStateSelect]);

  // Place wind farm clusters
  const placeMarkers = useCallback((m: maplibregl.Map) => {
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];
    const bun = bundleRef.current;

    Object.entries(STATE_DATA).forEach(([state, d]) => {
      const row = bun?.stateCapacity?.find(s => s.state === state);
      const mw  = row?.installed_mw ?? d.mw;
      const col = mwColor(mw);

      // ── FIX: destructure el, inner, overlay, sc ──
      const { el, inner, overlay, sc } = createWindFarmEl(col, mw);

      // ── FIX: All events go on overlay. Scale inner to avoid breaking maplibre transform. ──
      overlay.addEventListener('mouseenter', () => {
        const p = m.project([d.lon, d.lat]);
        setTooltip({ x: p.x, y: p.y, state, mw, plf: d.plf, windMs: d.windMs, potential: d.potential });
        inner.style.transform = `scale(${sc * 1.15})`;
      });
      overlay.addEventListener('mouseleave', () => {
        setTooltip(null);
        inner.style.transform = `scale(${sc})`;
      });
      overlay.addEventListener('click', () => {
        const cur = stateRef.current;
        selectRef.current?.(cur === state ? null : state);
      });

      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([d.lon, d.lat])
          .addTo(m)
      );
    });
  }, []);

// ── Wind Atlas data points (expanded grid across India) ──
const WIND_ATLAS_DATA: { lon: number; lat: number; windMs: number; windClass: string }[] = [
  // High wind zones (7-9 m/s)
  { lon: 71.57, lat: 22.26, windMs: 7.2, windClass: 'High' },     // Gujarat
  { lon: 72.5, lat: 23.5, windMs: 8.1, windClass: 'Very High' },  // Gujarat coast
  { lon: 70.8, lat: 20.5, windMs: 7.8, windClass: 'High' },       // Rajasthan border
  { lon: 73.0, lat: 21.0, windMs: 8.5, windClass: 'Very High' },  // Gujarat interior

  // Tamil Nadu zones (7-8 m/s)
  { lon: 78.66, lat: 11.13, windMs: 7.8, windClass: 'High' },     // Tamil Nadu
  { lon: 79.5, lat: 11.5, windMs: 8.2, windClass: 'Very High' },  // Tamil Nadu coast
  { lon: 77.5, lat: 12.5, windMs: 7.1, windClass: 'High' },

  // Rajasthan zones (7-8.5 m/s)
  { lon: 74.22, lat: 27.02, windMs: 7.5, windClass: 'High' },     // Rajasthan
  { lon: 73.5, lat: 26.5, windMs: 8.1, windClass: 'Very High' },
  { lon: 75.5, lat: 28.5, windMs: 7.2, windClass: 'High' },

  // Karnataka zones (6.5-7.5 m/s)
  { lon: 75.71, lat: 15.32, windMs: 6.8, windClass: 'Good' },     // Karnataka
  { lon: 75.2, lat: 14.5, windMs: 7.1, windClass: 'High' },

  // Andhra Pradesh zones (6.5-7.5 m/s)
  { lon: 79.74, lat: 15.91, windMs: 7.0, windClass: 'High' },     // Andhra Pradesh
  { lon: 80.5, lat: 16.5, windMs: 7.3, windClass: 'High' },

  // Maharashtra zones (5.8-6.5 m/s)
  { lon: 75.71, lat: 19.75, windMs: 6.2, windClass: 'Good' },     // Maharashtra
  { lon: 74.5, lat: 18.5, windMs: 6.8, windClass: 'Good' },

  // Madhya Pradesh zones (5.5-6.5 m/s)
  { lon: 78.66, lat: 22.97, windMs: 5.8, windClass: 'Moderate' }, // Madhya Pradesh
  { lon: 77.5, lat: 23.5, windMs: 6.2, windClass: 'Good' },

  // Telangana zones (6-6.8 m/s)
  { lon: 79.02, lat: 18.11, windMs: 6.5, windClass: 'Good' },     // Telangana

  // Low wind zones (< 6 m/s)
  { lon: 76.0, lat: 24.0, windMs: 5.2, windClass: 'Low' },
  { lon: 81.0, lat: 20.0, windMs: 5.5, windClass: 'Low' },
  { lon: 82.5, lat: 25.0, windMs: 4.8, windClass: 'Low' },
];

// Add wind layer with GWA-style visualization
const addWindLayer = useCallback((m: maplibregl.Map) => {
  const data = {
    type: 'FeatureCollection' as const,
    features: WIND_ATLAS_DATA.map(d => ({
      type: 'Feature' as const,
      properties: { windMs: d.windMs, windClass: d.windClass },
      geometry: { type: 'Point' as const, coordinates: [d.lon, d.lat] },
    })),
  };

  if (!m.getSource('gwa-wind')) {
    m.addSource('gwa-wind', { type: 'geojson', data });
  } else {
    // Update source if it exists
    (m.getSource('gwa-wind') as maplibregl.GeoJSONSource).setData(data);
  }

  if (!m.getLayer('gwa-heatmap')) {
    m.addLayer({
      id: 'gwa-heatmap',
      type: 'heatmap',
      source: 'gwa-wind',
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'windMs'], 4, 0, 9, 1.8],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 1.2],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 60, 5, 150, 7, 280],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,     'rgba(33, 102, 172, 0)',      // #2166ac - dark blue
          0.1,   'rgba(103, 169, 207, 0.8)',   // #67a9cf - light blue
          0.25,  'rgba(171, 217, 233, 0.8)',   // #abd9e9 - very light blue
          0.4,   'rgba(254, 224, 144, 0.9)',   // #fee090 - yellow
          0.6,   'rgba(253, 174, 97, 0.95)',   // #fdae61 - orange
          0.8,   'rgba(244, 109, 67, 0.95)',   // #f46d43 - dark orange
          1,     'rgba(215, 48, 39, 1)'        // #d73027 - red
        ],
        'heatmap-opacity': 0.8,
      },
    });
  }

  // Add wind speed contour/circle layer for better visual representation
  if (!m.getLayer('gwa-points')) {
    m.addLayer({
      id: 'gwa-points',
      type: 'circle',
      source: 'gwa-wind',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 5, 4, 7, 6],
        'circle-color': [
          'interpolate',
          ['linear'],
          ['get', 'windMs'],
          4,   '#2166ac',  // dark blue - low
          5,   '#67a9cf',  // light blue
          6,   '#abd9e9',  // cyan
          6.5, '#fee090',  // yellow
          7,   '#fdae61',  // orange
          8,   '#f46d43',  // dark orange
          9,   '#d73027'   // red - high
        ],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 5, 0.5, 7, 0.7],
        'circle-stroke-width': 0.5,
        'circle-stroke-color': 'rgba(255, 255, 255, 0.3)',
      },
    });
  }
}, []);

  // Init map once
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: getStyle(basemap),
      center: [78.5, 21.5],
      zoom: 4.2,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });
    mapRef.current = m;
    modeRef.current = basemap;
    setMode(basemap);
    m.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
    return () => {
      markersRef.current.forEach(mk => mk.remove());
      m.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-place markers whenever bundle changes
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded()) return;
    placeMarkers(m);
  }, [bundle, placeMarkers]);

  // style.load listener that runs for every style switch
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const fn = () => {
      placeMarkers(m);
      if (modeRef.current === 'wind') addWindLayer(m);
    };
    m.on('style.load', fn);
    if (m.isStyleLoaded()) fn();
    return () => { m.off('style.load', fn); };
  }, [placeMarkers, addWindLayer]);

  // Switch basemap
  const switchMode = (next: BasemapId) => {
    modeRef.current = next;
    setMode(next);
    onBasemapChange?.(next);
    mapRef.current?.setStyle(getStyle(next));
  };

  // Fullscreen toggle
  const toggleFs = () => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen();
      setIsFs(true);
    } else {
      document.exitFullscreen();
      setIsFs(false);
    }
  };

  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Floating mode switcher ── */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5 bg-gradient-to-r from-black/70 to-black/50 backdrop-blur-lg border border-white/15 rounded-2xl px-2 py-2 shadow-2xl">
          {(Object.keys(BASEMAP_LABELS) as BasemapId[]).map(id => (
            <button
              key={id}
              onClick={() => switchMode(id)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all duration-200 whitespace-nowrap ${
                mode === id
                  ? id === 'wind'
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-900 shadow-[0_0_16px_rgba(34,211,238,0.6)] scale-105'
                    : 'bg-orange-400 text-[#0a0e18] shadow-[0_0_12px_rgba(255,138,31,0.55)]'
                  : 'text-white/50 hover:text-white hover:bg-white/10'
              }`}
            >
              {BASEMAP_LABELS[id]}
            </button>
          ))}
        </div>

        {mode === 'wind' && (
          <div className="bg-gradient-to-b from-black/75 to-black/85 backdrop-blur-md border border-cyan-400/40 rounded-xl px-4 py-3 text-cyan-300 font-bold shadow-2xl">
            <div className="text-[10px] text-cyan-400 uppercase tracking-widest mb-2.5">💨 Wind Speed (m/s)</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-2 rounded-full bg-gradient-to-r from-[#2166ac] to-[#67a9cf]" />
                <span className="text-[9px] text-white/70">Low (4–5)</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-2 rounded-full bg-gradient-to-r from-[#abd9e9] to-[#fee090]" />
                <span className="text-[9px] text-white/70">Moderate (5–6)</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-2 rounded-full bg-gradient-to-r from-[#fdae61] to-[#f46d43]" />
                <span className="text-[9px] text-white/70">Good (6–7)</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-2 rounded-full bg-gradient-to-r from-[#f46d43] to-[#d73027]" />
                <span className="text-[9px] text-white/70">High (7–9+)</span>
              </div>
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-cyan-400/20 text-[8px] text-cyan-300/70 italic">
              Global Wind Atlas Style — Mean Wind Speed @ 100m
            </div>
          </div>
        )}
      </div>

      {/* ── Fullscreen button ── */}
      <button
        onClick={toggleFs}
        className="absolute top-3 right-12 z-20 w-8 h-8 flex items-center justify-center bg-black/65 backdrop-blur-md border border-white/10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all shadow-xl text-sm"
      >
        {isFullscreen ? '⊠' : '⛶'}
      </button>

      {/* ── Tooltip ── */}
      {tooltip && (
          <div
            className="absolute pointer-events-none z-30 w-[220px]"
            style={{ left: tooltip.x + 18, top: Math.max(8, tooltip.y - 160) }}
          >
            {/* Glow ring behind card */}
            <div className="absolute inset-0 rounded-2xl blur-xl opacity-40 bg-orange-500" />

            <div className="relative bg-[#060c1a] border border-orange-400/50 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.85)]">

              {/* Header */}
              <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-white/15">
                <div className="w-7 h-7 rounded-lg bg-orange-400/15 border border-orange-400/30 flex items-center justify-center text-[13px]">
                  💨
                </div>
                <span className="text-[13px] font-black text-white tracking-wide flex-1">{tooltip.state}</span>
                <div className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_2px_rgba(255,138,31,0.7)] animate-pulse" />
              </div>

              {/* Stats rows */}
              <div className="space-y-2">
                {(
                  [
                    ['Installed',  `${(tooltip.mw / 1000).toFixed(1)} GW`, '#ffb366', '⚡'],
                    ['Wind Speed', `${tooltip.windMs} m/s`,                 '#67e8f9', '🌬'],
                    ['Avg PLF',    `${tooltip.plf}%`,                       '#4ade80', '📈'],
                    ['Potential',  `${tooltip.potential} GW`,               '#a5b4fc', '🔭'],
                  ] as [string, string, string, string][]
                ).map(([l, v, c, icon]) => (
                  <div key={l} className="flex items-center justify-between gap-2 bg-white/[0.04] rounded-lg px-2.5 py-1.5">
                    <span className="text-[10px] text-white/55 flex items-center gap-1.5">
                      <span className="text-[11px]">{icon}</span>
                      {l}
                    </span>
                    <span className="text-[12px] font-black font-mono tracking-tight" style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Footer CTA */}
              <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-orange-400" />
                <span className="text-[9px] text-orange-300 font-bold tracking-widest uppercase">
                  Click to Filter Dashboard
                </span>
                <div className="w-1 h-1 rounded-full bg-orange-400" />
              </div>
            </div>
          </div>
        )}

      {/* ── Selected state badge ── */}
      {selectedState && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 bg-[#0e1527]/90 backdrop-blur-sm border border-orange-400/30 rounded-xl px-4 py-2 flex items-center gap-3 shadow-xl">
          <span className="text-[11px] text-orange-400 font-bold">📍 {selectedState}</span>
          <button
            onClick={() => onStateSelect?.(null)}
            className="text-white/40 hover:text-orange-400 text-xs"
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* ── Capacity legend (non-wind modes) ── */}
      {mode !== 'wind' && (
        <div className="absolute bottom-12 right-14 z-10 bg-black/65 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl">
          <div className="text-[8.5px] text-white/40 uppercase font-bold tracking-wide mb-1.5">Capacity</div>
          {[
            ['#4cc87a', '≥ 8 GW'],
            ['#ffb066', '5–8 GW'],
            ['#f5a623', '2–5 GW'],
            ['#e85c5c', '< 2 GW'],
          ].map(([c, l]) => (
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