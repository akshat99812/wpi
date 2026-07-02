"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LngLatLike, Map as MlMap } from "maplibre-gl";
import { registerDemProtocol } from "../utils/demShared";
import {
  enableTerrain,
  disableTerrain,
  setTerrainExaggeration,
  DEFAULT_EXAGGERATION,
} from "../utils/terrain";
import {
  addElevationTint,
  removeElevationTint,
  setElevationTintOpacity,
  DEFAULT_TINT_OPACITY,
} from "../utils/elevationTint";

/**
 * React controller for the Pro map's 3D terrain + hypsometric elevation tint.
 * Mirrors useMeasureDistance/useAoiAnalysis: the page calls `onMapLoad` inside
 * map.on("load") and renders the controls from this state.
 *
 * Two independent toggles over ONE shared DEM source (demShared.ts):
 *  - 3D terrain (`enabled`) → terrain mesh + hillshade + sky + tilt;
 *  - elevation tint (`tintEnabled`) → purple→red colour-relief (works in 2D too).
 *
 * Every mutation runs immediately if the style is ready, else once it next
 * settles — the same `isStyleLoaded() ? apply() : once("idle")` guard the
 * page's other layer effects use, so a toggle flipped mid-style-change isn't
 * dropped.
 */
export interface TerrainControls {
  enabled: boolean;
  exaggeration: number;
  tintEnabled: boolean;
  tintOpacity: number;
  /** Call inside map.on("load") — stores the map + registers the DEM protocol. */
  onMapLoad: (map: MlMap) => void;
  setEnabled: (next: boolean) => void;
  setExaggeration: (next: number) => void;
  setTintEnabled: (next: boolean) => void;
  setTintOpacity: (next: number) => void;
  /**
   * Exact DEM elevation (metres ASL) at a point when 3D terrain is on, else
   * null so the caller can fall back to its coarse grid. queryTerrainElevation
   * returns the value scaled by exaggeration, so this divides it back out.
   */
  sampleElevation: (map: MlMap, lngLat: LngLatLike) => number | null;
}

export function useTerrain(): TerrainControls {
  const mapRef = useRef<MlMap | null>(null);

  // 3D terrain is ON by default — the Pro map opens in a tilted 2.5D/3D view
  // (enableTerrain also eases the camera to a 60° pitch). The elevation tint
  // stays off by default.
  const [enabled, setEnabledState] = useState(true);
  const [exaggeration, setExaggerationState] = useState(DEFAULT_EXAGGERATION);
  const [tintEnabled, setTintEnabledState] = useState(false);
  const [tintOpacity, setTintOpacityState] = useState(DEFAULT_TINT_OPACITY);

  // Synchronous mirrors so onMapLoad (a stable callback) can re-apply the live
  // state on a fresh map instance, and sampleElevation reads exaggeration
  // without re-subscribing per render.
  const enabledRef = useRef(enabled);
  const exaggerationRef = useRef(exaggeration);
  const tintEnabledRef = useRef(tintEnabled);
  const tintOpacityRef = useRef(tintOpacity);

  // Run a map mutation now if the style is ready, else once it next settles.
  const whenReady = useCallback((fn: (map: MlMap) => void) => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      fn(map);
    } else {
      map.once("idle", () => {
        const m = mapRef.current;
        if (m) fn(m);
      });
    }
  }, []);

  const onMapLoad = useCallback((map: MlMap) => {
    registerDemProtocol();
    mapRef.current = map;
    // Apply the current terrain/tint state on load — both on first mount
    // (terrain defaults ON) and on a freshly re-created map after a session
    // refresh (page.tsx). Deferred to `idle` when the style isn't settled:
    // the load handler has just added several sources, so isStyleLoaded() is
    // transiently false and enableTerrain's ready-guard would otherwise bail.
    const applyInitial = () => {
      const m = mapRef.current;
      if (!m) return;
      if (enabledRef.current) enableTerrain(m, exaggerationRef.current);
      if (tintEnabledRef.current) {
        addElevationTint(m, { opacity: tintOpacityRef.current });
      }
    };
    if (map.isStyleLoaded()) applyInitial();
    else map.once("idle", applyInitial);
  }, []);

  const setEnabled = useCallback(
    (next: boolean) => {
      enabledRef.current = next;
      setEnabledState(next);
      whenReady((map) =>
        next ? enableTerrain(map, exaggerationRef.current) : disableTerrain(map),
      );
    },
    [whenReady],
  );

  const setExaggeration = useCallback(
    (next: number) => {
      exaggerationRef.current = next;
      setExaggerationState(next);
      whenReady((map) => setTerrainExaggeration(map, next));
    },
    [whenReady],
  );

  const setTintEnabled = useCallback(
    (next: boolean) => {
      tintEnabledRef.current = next;
      setTintEnabledState(next);
      whenReady((map) =>
        next
          ? addElevationTint(map, { opacity: tintOpacityRef.current })
          : removeElevationTint(map),
      );
    },
    [whenReady],
  );

  const setTintOpacity = useCallback(
    (next: number) => {
      tintOpacityRef.current = next;
      setTintOpacityState(next);
      whenReady((map) => setElevationTintOpacity(map, next));
    },
    [whenReady],
  );

  const sampleElevation = useCallback(
    (map: MlMap, lngLat: LngLatLike): number | null => {
      if (!enabledRef.current) return null;
      const raw = map.queryTerrainElevation(lngLat);
      if (raw == null) return null;
      const exag = exaggerationRef.current || 1;
      return raw / exag;
    },
    [],
  );

  // Drop the map reference on unmount; the page owns map.remove().
  useEffect(() => {
    return () => {
      mapRef.current = null;
    };
  }, []);

  return {
    enabled,
    exaggeration,
    tintEnabled,
    tintOpacity,
    onMapLoad,
    setEnabled,
    setExaggeration,
    setTintEnabled,
    setTintOpacity,
    sampleElevation,
  };
}
