"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import {
  AoiDrawController,
  type AoiDrawMode,
} from "@/components/Map/utils/aoiDraw";
import { closeRing, ringAreaKm2 } from "@/lib/analysis/geometry";
import { AnalyzeRequestError, postAnalyze } from "@/lib/analysis/client";
import { KmlParseError, parseAoiFromFile } from "@/lib/analysis/kml";
import {
  decodeAoiHash,
  encodeAoiHash,
  setAoiHash,
} from "@/lib/analysis/permalink";
import type { AnalysisResponse } from "@/lib/analysis/types";

/**
 * State machine + side effects for the Analyze tool:
 *   idle → drawing → loading → ok | partial | error
 * "partial" = HTTP 200 with at least one section unavailable (plan §2.8).
 *
 * Owns the AoiDrawController lifecycle, the in-flight AbortController (a new
 * AOI or Clear cancels the previous request), Esc-to-cancel, and the
 * draw-armed ref the map click-priority chain reads synchronously.
 */

export type AnalysisUiState =
  | "idle"
  | "drawing"
  | "loading"
  | "ok"
  | "partial"
  | "error";

export interface AoiAnalysis {
  uiState: AnalysisUiState;
  armedMode: AoiDrawMode | null;
  /** Synchronous mirror of armedMode for map event handlers (click chain). */
  armedRef: React.RefObject<AoiDrawMode | null>;
  liveAreaKm2: number | null;
  liveOverCap: boolean;
  committedAreaKm2: number | null;
  analysis: AnalysisResponse | null;
  error: string | null;
  /** Call inside map.on("load") — attaches the draw controller. */
  onMapLoad: (map: MlMap) => void;
  arm: (mode: AoiDrawMode) => void;
  /** Parse a .kml/.kmz File into an AOI, draw it, fit the map, and analyze. */
  uploadFile: (file: File) => void;
  /** Cancel an armed draw without touching a committed AOI / results
   *  (what Esc does — also used when another map tool takes the clicks). */
  disarm: () => void;
  clearAll: () => void;
}

export function useAoiAnalysis(): AoiAnalysis {
  const controllerRef = useRef<AoiDrawController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const armedRef = useRef<AoiDrawMode | null>(null);
  // Monotone id so a slow stale response can never clobber a newer one.
  const requestSeqRef = useRef(0);

  const [uiState, setUiState] = useState<AnalysisUiState>("idle");
  const [armedMode, setArmedMode] = useState<AoiDrawMode | null>(null);
  const [liveAreaKm2, setLiveAreaKm2] = useState<number | null>(null);
  const [liveOverCap, setLiveOverCap] = useState(false);
  const [committedAreaKm2, setCommittedAreaKm2] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback((ring: [number, number][]) => {
    const closed = closeRing(ring);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const seq = ++requestSeqRef.current;

    setCommittedAreaKm2(ringAreaKm2(closed));
    setAnalysis(null);
    setError(null);
    setUiState("loading");

    // Permalink: reflect the committed AOI in the URL hash (plan Phase 5).
    encodeAoiHash(closed)
      .then((payload) => setAoiHash(payload))
      .catch((err) => console.error("[analyze] permalink encode failed", err));

    postAnalyze(closed, ac.signal)
      .then((res) => {
        if (seq !== requestSeqRef.current) return; // superseded
        setAnalysis(res);
        const anyUnavailable = Object.values(res.sections).some(
          (s) => s.status === "unavailable",
        );
        setUiState(anyUnavailable ? "partial" : "ok");
      })
      .catch((err: unknown) => {
        if (seq !== requestSeqRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof AnalyzeRequestError
            ? err.message
            : "Network error — analysis could not run.";
        console.error("[analyze] request failed", err);
        setError(message);
        setUiState("error");
      });
  }, []);

  const onMapLoad = useCallback(
    (map: MlMap) => {
      controllerRef.current?.destroy();
      controllerRef.current = new AoiDrawController(map, {
        onLiveArea: (area, overCap) => {
          setLiveAreaKm2(area);
          setLiveOverCap(overCap);
        },
        onCommit: (ring) => {
          armedRef.current = null;
          setArmedMode(null);
          controllerRef.current?.setCommitted(closeRing(ring));
          runAnalysis(ring);
        },
      });

      // Permalink restore: a shared #aoi=… hash redraws the AOI and re-runs
      // the analysis as soon as the map (and its pin anchor layer) is ready.
      void decodeAoiHash(window.location.hash)
        .then((ring) => {
          if (!ring) return;
          controllerRef.current?.setCommitted(closeRing(ring));
          runAnalysis(ring);
        })
        .catch((err) => console.error("[analyze] permalink restore failed", err));
    },
    [runAnalysis],
  );

  const arm = useCallback((mode: AoiDrawMode) => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.arm(mode);
    armedRef.current = mode;
    setArmedMode(mode);
    setUiState("drawing");
    setError(null);
  }, []);

  const uploadFile = useCallback(
    (file: File) => {
      const controller = controllerRef.current;
      // Take over the click chain like arming does, then run as a draw commit.
      controller?.disarm();
      armedRef.current = null;
      setArmedMode(null);
      setError(null);
      setUiState("loading");

      parseAoiFromFile(file)
        .then(({ ring }) => {
          const closed = closeRing(ring);
          controllerRef.current?.setCommitted(closed);
          controllerRef.current?.fitToRing(closed);
          runAnalysis(closed);
        })
        .catch((err: unknown) => {
          const message =
            err instanceof KmlParseError
              ? err.message
              : "Could not read that file — upload a valid .kml or .kmz.";
          console.error("[analyze] file upload failed", err);
          setError(message);
          setUiState("error");
        });
    },
    [runAnalysis],
  );

  const disarm = useCallback(() => {
    controllerRef.current?.disarm();
    armedRef.current = null;
    setArmedMode(null);
    setUiState((prev) => (prev === "drawing" ? "idle" : prev));
  }, []);

  const clearAll = useCallback(() => {
    abortRef.current?.abort();
    requestSeqRef.current++;
    const controller = controllerRef.current;
    controller?.disarm();
    controller?.setCommitted(null);
    armedRef.current = null;
    setArmedMode(null);
    setLiveAreaKm2(null);
    setLiveOverCap(false);
    setCommittedAreaKm2(null);
    setAnalysis(null);
    setError(null);
    setUiState("idle");
    setAoiHash(null);
  }, []);

  // Esc cancels an armed draw (keeps any previous result on screen).
  useEffect(() => {
    if (!armedMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      disarm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armedMode, disarm]);

  // Unmount: abort in-flight work and tear the controller down.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  return {
    uiState,
    armedMode,
    armedRef,
    liveAreaKm2,
    liveOverCap,
    committedAreaKm2,
    analysis,
    error,
    onMapLoad,
    arm,
    uploadFile,
    disarm,
    clearAll,
  };
}
