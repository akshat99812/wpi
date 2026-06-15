'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { motion } from 'framer-motion';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { WpiBundle } from '@/lib/types';
import type { BasemapId, TooltipState, MapCanvasProps } from './types';
import { getStyle } from './constants';
import { loadWindGrid, DEFAULT_WIND_HEIGHT, type WindHeight } from '@/lib/wind/lookup';

// Hooks
import { useMapInit }         from './hooks/useMapInit';
import { useFullscreen }      from './hooks/useFullscreen';
import { useCursorTracker }   from './hooks/useCursorTracker';
import { useStateBoundaries } from './hooks/useStateBoundaries';
import { useTurbineMarkers }  from './hooks/useTurbineMarkers';
import { useWindLayer }       from './hooks/useWindLayer';

// UI
import { BasemapSwitcher }    from './components/BasemapSwitcher';
import { WindScale }          from './components/WindScale';
import { WindFlowOverlay }    from './components/WindFlowOverlay';
import { StateTooltip }       from './components/StateTooltip';
import { CursorReadoutBar }   from './components/CursorReadout';
import { FullscreenButton }   from './components/FullscreenButton';

/**
 * MapCanvas — top-level orchestrator.
 *
 * Most logic lives in dedicated hooks; this file's job is to:
 *   1. Hold refs that hooks share (map instance, current mode, latest props).
 *   2. Wire `style.load` so layers reinstall after a basemap switch.
 *   3. Compose the UI overlay (switcher, legend, tooltip, badge, readout).
 */
export default function MapCanvas({
  bundle,
  selectedState,
  basemap = 'satellite',
  onStateSelect,
  onBasemapChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const modeRef      = useRef<BasemapId>(basemap);

  // Mirror props into refs so hook callbacks always see the latest value
  // without forcing the hooks to recreate when props change.
  const bundleRef = useRef<WpiBundle | undefined>(bundle);
  const stateRef  = useRef<string | null | undefined>(selectedState);
  const selectRef = useRef<typeof onStateSelect>(onStateSelect);
  useEffect(() => { bundleRef.current = bundle;        }, [bundle]);
  useEffect(() => { stateRef.current  = selectedState; }, [selectedState]);
  useEffect(() => { selectRef.current = onStateSelect; }, [onStateSelect]);

  const [mode, setMode]       = useState<BasemapId>(basemap);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  // Selected wind hub height (m). Mirrored to a ref so style.load re-installs
  // the correct height without re-creating applyMode.
  const [windHeight, setWindHeight] = useState<WindHeight>(DEFAULT_WIND_HEIGHT);
  const windHeightRef = useRef<WindHeight>(windHeight);
  useEffect(() => { windHeightRef.current = windHeight; }, [windHeight]);
  // Zoom level — used to suppress the hover tooltip once the user has
  // zoomed past the state-overview range (see TOOLTIP_MAX_ZOOM below).
  const [zoom, setZoom] = useState<number>(4.2);

  // Hide the floating state/turbine card once the viewer is zoomed
  // "inside" a state — at that zoom the card is more clutter than
  // signal, since the selected-state badge already names the area.
  const TOOLTIP_MAX_ZOOM = 6.5;

  // ── Hooks ──────────────────────────────────────────────────────────────
  useMapInit({ containerRef, mapRef, modeRef, initialBasemap: basemap });
  const { isFullscreen, toggle: toggleFs } = useFullscreen(containerRef);
  const cursor = useCursorTracker(mapRef, mode, windHeight);

  const { install: installBoundaries } =
    useStateBoundaries({ mapRef, modeRef, stateRef, selectRef, setTooltip });
  const { place: placeTurbines } =
    useTurbineMarkers({ bundleRef, stateRef, selectRef, setTooltip });
  const { install: installWind } = useWindLayer();

  // ── Re-install layers after each style.load ────────────────────────────
  // Boundaries appear on every basemap. Wind-mode also installs the
  // heatmap. Turbines appear on every mode (the spec asks for them on every
  // map, with state boundaries also visible everywhere).
  const applyMode = useCallback(async (m: maplibregl.Map) => {
    await installBoundaries(m);
    placeTurbines(m);
    if (modeRef.current === 'wind') {
      installWind(m, windHeightRef.current);
      void loadWindGrid(windHeightRef.current);
    }
  }, [installBoundaries, placeTurbines, installWind]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const onStyleLoad = () => {
      // Lift the veil immediately — tiles paint progressively underneath.
      // Reinstalling boundaries/turbines/wind runs fire-and-forget; they pop
      // in as their data resolves without blocking the basemap reveal.
      setIsSwitching(false);
      applyMode(m);
    };
    m.on('style.load', onStyleLoad);
    if (m.isStyleLoaded()) onStyleLoad();

    return () => { m.off('style.load', onStyleLoad); };
  }, [applyMode]);

  // ── Bundle changed → re-place turbines (live MW values) ────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded()) return;
    placeTurbines(m);
  }, [bundle, placeTurbines]);

  // ── Wind height changed → swap raster tiles + load that height's grid ──
  // Only relevant in wind mode. Entering wind mode is handled by applyMode on
  // style.load; this covers switching height while already in wind mode.
  useEffect(() => {
    if (mode !== 'wind') return;
    void loadWindGrid(windHeight);
    const m = mapRef.current;
    if (m && m.isStyleLoaded()) installWind(m, windHeight);
  }, [windHeight, mode, installWind]);

  // ── Track zoom; clear stale tooltip when zooming in past threshold ────
  // The map fires `zoom` continuously during gestures and `zoomend` once
  // the gesture settles — we listen to both so the gate reacts mid-zoom
  // (the card vanishes the moment you cross the threshold).
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const sync = () => {
      const z = m.getZoom();
      setZoom(z);
      if (z > TOOLTIP_MAX_ZOOM) setTooltip(null);
    };
    sync();
    m.on('zoom', sync);
    m.on('zoomend', sync);
    return () => {
      m.off('zoom', sync);
      m.off('zoomend', sync);
    };
  }, []);

  // ── Basemap switch ─────────────────────────────────────────────────────
  // Each mode uses a distinct style (wind uses a darkened-satellite variant
  // so the GWA heatmap reads against a muted backdrop). After setStyle,
  // applyMode runs on style.load to reinstall boundaries, turbines, and —
  // when applicable — the wind heatmap.
  const switchMode = useCallback((next: BasemapId) => {
    const prev = modeRef.current;
    if (prev === next) return;

    modeRef.current = next;
    setMode(next);
    onBasemapChange?.(next);
    setTooltip(null);
    setIsSwitching(true);

    const m = mapRef.current;
    if (!m) {
      setIsSwitching(false);
      return;
    }

    m.setStyle(getStyle(next));
  }, [onBasemapChange]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />

      {/* Crossfade veil — masks the setStyle rebuild flicker only. Snaps in
          fast and fades out immediately on style.load so the switch feels
          instant; tiles paint progressively under the dissolving veil. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[5] bg-[#0a0e18]"
        initial={false}
        animate={{ opacity: isSwitching ? 0.6 : 0 }}
        transition={
          isSwitching
            ? { duration: 0.05, ease: 'linear' }
            : { duration: 0.18, ease: 'easeOut' }
        }
      />

      {/* Animated wind-particle flow — only while the "Wind flow" basemap is
          active. A transparent canvas overlay + legend; self-contained. */}
      <WindFlowOverlay map={mapRef.current} active={mode === 'windflow'} />

      {/* Top-left: basemap switcher */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
        <BasemapSwitcher mode={mode} onChange={switchMode} />
      </div>

      {/* Bottom-right (above the nav control): interactive wind legend. Its
          pointer tracks the cursor's GWA wind value live — see WindScale. */}
      {mode === 'wind' && (
        <div className="absolute bottom-28 right-3 z-20">
          <WindScale wind={cursor?.wind} height={windHeight} onHeightChange={setWindHeight} />
        </div>
      )}

      {/* Top-right: fullscreen */}
      <div className="absolute top-3 right-12 z-20">
        <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFs} />
      </div>

      {/* Hover tooltip. The `key` includes the state name so React unmounts
          and remounts the card on every state change — eliminates any chance
          of stale internal state lingering across hovers (Safari was showing
          the previously-hovered state's card on rapid transitions).
          Suppressed once zoom > TOOLTIP_MAX_ZOOM — at high zoom the user is
          inside a state and the card becomes clutter. */}
      {tooltip && zoom <= TOOLTIP_MAX_ZOOM && (
        <StateTooltip
          key={tooltip.state}
          tooltip={tooltip}
          containerWidth={containerRef.current?.offsetWidth}
          containerHeight={containerRef.current?.offsetHeight}
        />
      )}

      {/* Bottom-center: lat/lng/zoom readout. The km scale bar from
          MapLibre's ScaleControl sits at bottom-left and complements this. */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
        <CursorReadoutBar readout={cursor} />
      </div>

    </div>
  );
}