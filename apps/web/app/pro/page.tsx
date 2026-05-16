"use client";

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import TopBar from '@/components/TopBar';
import { MAST_POINTS, type MastPoint } from '@/lib/mastData';

// Same ESRI World Imagery the dashboard uses, so /pro reads as part of
// the same product visually.
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles © Esri — World Imagery',
    },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};

// ── Helpers: derive state + measurement window from a mast record ───────
// The 21 sample masts cluster into Gujarat, Maharashtra, Karnataka, Andhra
// Pradesh and Tamil Nadu — bounding boxes are tight enough to disambiguate.
function deriveState({ lon, lat }: MastPoint): string {
  if (lat <= 11.5)                                          return 'Tamil Nadu';
  if (lat >= 21 && lon <= 73)                               return 'Gujarat';
  if (lat >= 18 && lat <= 19.5 && lon >= 75 && lon <= 76)   return 'Maharashtra';
  if (lat >= 14.5 && lat <= 15.5 && lon < 77)               return 'Karnataka';
  if (lat >= 14 && lat <= 16 && lon >= 77)                  return 'Andhra Pradesh';
  return 'India';
}

// The name field carries an optional "(Jun 2023 – Mar 2025)" window in
// parens. Return it (without the parens) or null.
function parseWindow(name: string): string | null {
  const match = name.match(/\(([^)]+)\)/);
  return match ? match[1] : null;
}

// Strip the trailing "(window)" + "Pvt. WM 120 m" off the name so the
// site name reads cleanly in the header. Falls back to the raw name.
function siteName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*$/, '')           // drop trailing (window)
    .replace(/\s+Pvt\.\s*WM(\s+\d{2,3}\s*m)?$/i, '')  // drop "Pvt. WM 120 m"
    .trim();
}

export default function ProMastMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const [active, setActive] = useState<MastPoint | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [76, 17],
      zoom: 4.8,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on('load', () => {
      map.resize();

      map.addSource('masts', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: MAST_POINTS.map((p, i) => ({
            type: 'Feature',
            id: i,
            properties: {
              name: p.name,
              hubHeight: p.hubHeight ?? '',
              lon: p.lon,
              lat: p.lat,
            },
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          })),
        },
      });

      map.addLayer({
        id: 'mast-halo',
        type: 'circle',
        source: 'masts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 9, 18],
          'circle-color': '#facc15',
          'circle-opacity': 0.2,
          'circle-blur': 0.6,
        },
      });

      map.addLayer({
        id: 'mast-dot',
        type: 'circle',
        source: 'masts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 9, 8],
          'circle-color': '#facc15',
          'circle-stroke-width': 0,
        },
      });

      // Selected mast — same yellow, larger so it reads without an outline.
      map.addLayer({
        id: 'mast-selected',
        type: 'circle',
        source: 'masts',
        filter: ['==', ['id'], -1],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 9, 14],
          'circle-color': '#fde047',
          'circle-stroke-width': 0,
        },
      });

      // Invisible hit-area layer on top — gives the dots a generous click
      // target without bloating the visible circle. The radius is 2–3× the
      // visible dot, and the colour is transparent so it doesn't render.
      map.addLayer({
        id: 'mast-hit',
        type: 'circle',
        source: 'masts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 16, 9, 22],
          'circle-color': '#000000',
          'circle-opacity': 0,
        },
      });

      map.on('mouseenter', 'mast-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'mast-hit', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'mast-hit', (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const props = feat.properties as { name: string; hubHeight: string; lon: number; lat: number };
        const fid = feat.id as number;

        setActive({
          name: props.name,
          hubHeight: props.hubHeight || undefined,
          lon: Number(props.lon),
          lat: Number(props.lat),
        });

        // Highlight the clicked dot and fly to it.
        map.setFilter('mast-selected', ['==', ['id'], fid]);
        map.easeTo({
          center: [Number(props.lon), Number(props.lat)],
          zoom: Math.max(map.getZoom(), 7),
          duration: 700,
        });
      });
    });

    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Clear selection — also resets the highlight filter on the map.
  const clearSelection = () => {
    setActive(null);
    mapRef.current?.setFilter('mast-selected', ['==', ['id'], -1]);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#090d18] text-text overflow-hidden">
      <TopBar showEngines={false} />

      <div className="flex-1 min-h-0 flex">

        {/* ── Map area ──────────────────────────────────────────────────── */}
        <div className="relative flex-1 min-h-0">
          <div ref={containerRef} className="w-full h-full" />

          {/* Tile attribution — bottom-right corner, beside zoom buttons */}
          <div className="absolute bottom-3 right-16 z-10
                          text-[9.5px] text-muted/55
                          bg-[#0c1120]/80 backdrop-blur-sm
                          border border-[#1f2c44] rounded
                          px-2 py-1">
            Tiles © Esri World Imagery · Masts: CECL (May 2026)
          </div>
        </div>

        {/* ── Right detail panel ─────────────────────────────────────────
            Always present at lg+. On small screens we collapse to a
            bottom drawer so the map gets full width. */}
        <aside className="hidden lg:flex w-[360px] flex-shrink-0 flex-col
                          border-l border-[#1f2c44] bg-[#0a0f1c]/95
                          overflow-y-auto">
          {active ? <MastDetail mast={active} onClose={clearSelection} /> : <EmptyDetail />}
        </aside>
      </div>

      {/* ── Mobile drawer (lg-down) — slides up when active ─────────────── */}
      {active && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-20
                        bg-[#0c1120]/97 backdrop-blur-sm
                        border-t border-orange/30
                        max-h-[60vh] overflow-y-auto
                        shadow-[0_-12px_32px_-8px_rgba(0,0,0,0.6)]">
          <MastDetail mast={active} onClose={clearSelection} />
        </div>
      )}
    </div>
  );
}

// ── Detail panel content ──────────────────────────────────────────────────

function EmptyDetail() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4 border-b border-[#1a2540]">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted/55">
          Site Details
        </div>
        <div className="text-[13.5px] text-text/80 mt-1">
          No mast selected
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 text-center gap-3">
        <div className="w-12 h-12 rounded-full border border-[#1f2c44]
                        bg-[#0d1424] flex items-center justify-center text-orange/70">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        <div className="text-[12px] text-muted/70 max-w-[24ch] leading-relaxed">
          Click any orange dot on the map to see the mast&apos;s name,
          hub height, location and measurement window.
        </div>
      </div>
    </div>
  );
}

function MastDetail({ mast, onClose }: { mast: MastPoint; onClose: () => void }) {
  const cleanName = siteName(mast.name);
  const window_   = parseWindow(mast.name);
  const state     = deriveState(mast);

  return (
    <div className="flex flex-col">

      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-[#1a2540] flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange/85">
            Wind Mast · {state}
          </div>
          <div className="text-[16px] font-semibold text-text mt-1 leading-snug">
            {cleanName}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close mast details"
          className="text-muted/70 hover:text-text text-[20px] leading-none -mt-1 flex-shrink-0"
        >
          ×
        </button>
      </div>

      {/* Chips */}
      <div className="px-5 py-4 border-b border-[#1a2540] flex flex-wrap gap-2">
        {mast.hubHeight && (
          <Chip label="Hub Height" value={mast.hubHeight} accent="#ff8a1f" />
        )}
        <Chip label="State" value={state} accent="#7bc4e2" />
        <Chip label="Ownership" value="Private" accent="#a5b4fc" />
      </div>

      {/* Coordinates block */}
      <div className="px-5 py-4 border-b border-[#1a2540]">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted/55 mb-2">
          Coordinates
        </div>
        <div className="flex flex-col gap-1.5 font-mono text-[12px] tabular-nums">
          <div className="flex justify-between">
            <span className="text-muted/60">Latitude</span>
            <span className="text-text/90">{mast.lat.toFixed(6)}° N</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted/60">Longitude</span>
            <span className="text-text/90">{mast.lon.toFixed(6)}° E</span>
          </div>
        </div>
      </div>

      {/* Measurement window */}
      {window_ && (
        <div className="px-5 py-4 border-b border-[#1a2540]">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted/55 mb-2">
            Measurement Window
          </div>
          <div className="text-[12.5px] text-text/85 leading-relaxed">
            {window_}
          </div>
        </div>
      )}

      {/* Source / footnote */}
      <div className="px-5 py-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted/55 mb-2">
          Source
        </div>
        <div className="text-[11.5px] text-muted/70 leading-relaxed">
          CECL Wind Mast Registry · All-India May 2026.
          Private (Pvt.) masts indicate operator-owned monitoring stations,
          typically deployed for site-prospecting or P50/P90 yield
          assessment ahead of project financing.
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-[#1f2c44]
                    bg-[#0d1424] px-2.5 py-1.5">
      <span className="text-[9px] uppercase tracking-wider text-muted/55 font-bold">
        {label}
      </span>
      <span className="text-[12px] font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
