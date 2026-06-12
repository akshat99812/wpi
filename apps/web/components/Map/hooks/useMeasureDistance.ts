"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import {
  MeasureController,
  type MeasurePhase,
  type MeasurePoint,
} from "@/components/Map/utils/measureDistance";

/**
 * React state machine for the measure-distance tool, mirroring
 * useAoiAnalysis: owns the MeasureController lifecycle, the Esc transitions
 * (onePoint → armed; armed/done → idle), the armed ref the map click-priority
 * chain reads synchronously, and the doubleClickZoom disable/restore (zoom
 * disabled while armed so a double-click can't set A and B at the same spot).
 */

export interface MeasureDistance {
  phase: MeasurePhase;
  /** True while the tool owns map clicks (armed / onePoint / done). */
  armed: boolean;
  /** Synchronous mirror of `armed` for map event handlers (click chain). */
  armedRef: React.RefObject<boolean>;
  pointA: MeasurePoint | null;
  pointB: MeasurePoint | null;
  /** A→cursor distance while placing point B. */
  liveDistanceKm: number | null;
  /** A→B distance once the measurement is complete. */
  distanceKm: number | null;
  /** Call inside map.on("load") — attaches the controller. */
  onMapLoad: (map: MlMap) => void;
  arm: () => void;
  disarm: () => void;
  clear: () => void;
}

export function useMeasureDistance(): MeasureDistance {
  const controllerRef = useRef<MeasureController | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const armedRef = useRef(false);
  // True only while WE disabled double-click zoom. terra-draw also toggles
  // this handler during AOI rectangle/polygon draws — blindly calling
  // enable() from disarm()/clear() would re-enable zoom mid-AOI-draw.
  const dczDisabledRef = useRef(false);

  const [phase, setPhase] = useState<MeasurePhase>("idle");
  const [pointA, setPointA] = useState<MeasurePoint | null>(null);
  const [pointB, setPointB] = useState<MeasurePoint | null>(null);
  const [liveDistanceKm, setLiveDistanceKm] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);

  const onMapLoad = useCallback((map: MlMap) => {
    controllerRef.current?.destroy();
    mapRef.current = map;
    armedRef.current = false;
    dczDisabledRef.current = false; // fresh map → handler back at its default
    setPhase("idle");
    setPointA(null);
    setPointB(null);
    setLiveDistanceKm(null);
    setDistanceKm(null);
    controllerRef.current = new MeasureController(map, {
      onChange: (state) => {
        armedRef.current = state.phase !== "idle";
        setPhase(state.phase);
        setPointA(state.pointA);
        setPointB(state.pointB);
        setDistanceKm(state.distanceKm);
        if (state.phase !== "onePoint") setLiveDistanceKm(null);
      },
      onLiveDistance: setLiveDistanceKm,
    });
  }, []);

  const restoreDoubleClickZoom = useCallback(() => {
    if (!dczDisabledRef.current) return;
    dczDisabledRef.current = false;
    mapRef.current?.doubleClickZoom.enable();
  }, []);

  const arm = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.arm();
    // armedRef is set synchronously by the controller's onChange emit.
    if (armedRef.current && !dczDisabledRef.current) {
      dczDisabledRef.current = true;
      mapRef.current?.doubleClickZoom.disable();
    }
  }, []);

  const disarm = useCallback(() => {
    controllerRef.current?.disarm();
    restoreDoubleClickZoom();
  }, [restoreDoubleClickZoom]);

  const clear = useCallback(() => {
    controllerRef.current?.clear();
    restoreDoubleClickZoom();
  }, [restoreDoubleClickZoom]);

  // Esc: onePoint drops point A (back to armed); armed/done exits the tool
  // entirely (a completed line persists — only Clear removes it).
  useEffect(() => {
    if (phase === "idle") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (phase === "onePoint") controllerRef.current?.resetToArmed();
      else disarm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, disarm]);

  // Unmount: tear the controller down and hand double-click zoom back
  // (only if we own the disable — see dczDisabledRef).
  useEffect(() => {
    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      if (dczDisabledRef.current) {
        dczDisabledRef.current = false;
        mapRef.current?.doubleClickZoom.enable();
      }
      mapRef.current = null;
    };
  }, []);

  return {
    phase,
    armed: phase !== "idle",
    armedRef,
    pointA,
    pointB,
    liveDistanceKm,
    distanceKm,
    onMapLoad,
    arm,
    disarm,
    clear,
  };
}
