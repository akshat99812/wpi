'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { motion } from 'framer-motion';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { WpiBundle } from '@/lib/types';
import type { BasemapId, TooltipState, MapCanvasProps } from './types';
import { getStyle } from './constants';

// Hooks
import { useMapInit }         from './hooks/useMapInit';
import { useFullscreen }      from './hooks/useFullscreen';
import { useCursorTracker }   from './hooks/useCursorTracker';
import { useStateBoundaries } from './hooks/useStateBoundaries';
import { useTurbineMarkers }  from './hooks/useTurbineMarkers';
import { useWindLayer }       from './hooks/useWindLayer';

// UI
import { BasemapSwitcher }    from './components/BasemapSwitcher';
import { WindLegend }         from './components/WindLegend';
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

  // ── Hooks ──────────────────────────────────────────────────────────────
  useMapInit({ containerRef, mapRef, modeRef, initialBasemap: basemap });
  const { isFullscreen, toggle: toggleFs } = useFullscreen(containerRef);
  const cursor = useCursorTracker(mapRef, mode);

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
      installWind(m);
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

      {/* Top-left: basemap switcher + (in wind mode) wind legend */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
        <BasemapSwitcher mode={mode} onChange={switchMode} />
        {mode === 'wind' && <WindLegend />}
      </div>

      {/* Top-right: fullscreen */}
      <div className="absolute top-3 right-12 z-20">
        <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFs} />
      </div>

      {/* Hover tooltip. The `key` includes the state name so React unmounts
          and remounts the card on every state change — eliminates any chance
          of stale internal state lingering across hovers (Safari was showing
          the previously-hovered state's card on rapid transitions). */}
      {tooltip && (
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