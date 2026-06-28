"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import {
  AoiDrawController,
  type AoiDrawMode,
} from "@/components/Map/utils/aoiDraw";
import { TurbineLayoutController } from "@/components/Map/utils/turbineLayoutLayer";
import { closeRing, ringAreaKm2 } from "@/lib/analysis/geometry";
import {
  AnalyzeRequestError,
  postAnalyze,
  postAnalyzePoint,
} from "@/lib/analysis/client";
import { KmlParseError, parseAoiFromFile } from "@/lib/analysis/kml";
import {
  parseLayoutFromFile,
  type TurbineLayout,
  type TurbinePoint,
} from "@/lib/analysis/layout";
import {
  decodeAoiHash,
  encodeAoiHash,
  setAoiHash,
} from "@/lib/analysis/permalink";
import type { AnalysisResponse, PointReport } from "@/lib/analysis/types";

/**
 * State machine + side effects for the Analyze tool:
 *   idle → drawing → loading → ok | partial | error
 * "partial" = HTTP 200 with at least one section unavailable (plan §2.8).
 *
 * Owns the AoiDrawController lifecycle, the in-flight AbortController (a new
 * AOI or Clear cancels the previous request), Esc-to-cancel, and the
 * draw-armed ref the map click-priority chain reads synchronously.
 *
 * Also owns the micro-sited turbine LAYOUT flow: uploading a points file plots
 * every exact turbine and screens the convex-hull FOOTPRINT as the AOI. Clicking
 * a turbine runs a SEPARATE exact-point report (POST /api/analyze/point) shown in
 * its own card — it never touches the footprint AOI/geometry, so returning to the
 * site view is instant and no box is drawn around the turbine.
 */

export type AnalysisUiState =
  | "idle"
  | "drawing"
  | "loading"
  | "ok"
  | "partial"
  | "error";

/** Lifecycle of the per-turbine exact-point report (independent of the AOI). */
export type PointUiState = "idle" | "loading" | "ok" | "error";

export interface AoiAnalysis {
  uiState: AnalysisUiState;
  armedMode: AoiDrawMode | null;
  /** Synchronous mirror of armedMode for map event handlers (click chain). */
  armedRef: React.RefObject<AoiDrawMode | null>;
  liveAreaKm2: number | null;
  liveOverCap: boolean;
  committedAreaKm2: number | null;
  /** Closed outer ring of the committed AOI (lon/lat) — drives report export. */
  committedRing: [number, number][] | null;
  analysis: AnalysisResponse | null;
  error: string | null;
  /** Uploaded micro-sited turbine layout, when one is active. */
  layout: TurbineLayout | null;
  /** The turbine currently screened individually, when one is selected. */
  selectedTurbine: TurbinePoint | null;
  /** Exact-point report for the selected turbine. */
  pointReport: PointReport | null;
  pointUiState: PointUiState;
  pointError: string | null;
  /** Call inside map.on("load") — attaches the draw + turbine controllers.
   *  `isInteractionBlocked` lets the page suppress turbine clicks while another
   *  tool (e.g. measure) owns clicks; AOI-draw arming is handled internally. */
  onMapLoad: (map: MlMap, isInteractionBlocked?: () => boolean) => void;
  arm: (mode: AoiDrawMode) => void;
  /** Parse a .kml/.kmz boundary File into an AOI, draw it, fit, and analyze. */
  uploadFile: (file: File) => void;
  /** Parse a .kml/.kmz turbine-layout File into points + footprint and analyze. */
  uploadLayoutFile: (file: File) => void;
  /** Screen one uploaded turbine individually (exact-point report). */
  selectTurbine: (id: string) => void;
  /** Return from a single-turbine view to the site footprint result. */
  clearTurbine: () => void;
  /** Cancel an armed draw without touching a committed AOI / results
   *  (what Esc does — also used when another map tool takes the clicks). */
  disarm: () => void;
  clearAll: () => void;
}

export function useAoiAnalysis(): AoiAnalysis {
  const controllerRef = useRef<AoiDrawController | null>(null);
  const turbineLayerRef = useRef<TurbineLayoutController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const armedRef = useRef<AoiDrawMode | null>(null);
  // Monotone id so a slow stale response can never clobber a newer one.
  const requestSeqRef = useRef(0);
  // Synchronous mirrors for the once-bound turbine click handler / map reload.
  const layoutRef = useRef<TurbineLayout | null>(null);
  const selectedTurbineRef = useRef<TurbinePoint | null>(null);
  // Separate in-flight tracking for the per-turbine point report.
  const pointAbortRef = useRef<AbortController | null>(null);
  const pointSeqRef = useRef(0);

  const [uiState, setUiState] = useState<AnalysisUiState>("idle");
  const [armedMode, setArmedMode] = useState<AoiDrawMode | null>(null);
  const [liveAreaKm2, setLiveAreaKm2] = useState<number | null>(null);
  const [liveOverCap, setLiveOverCap] = useState(false);
  const [committedAreaKm2, setCommittedAreaKm2] = useState<number | null>(null);
  const [committedRing, setCommittedRing] = useState<
    [number, number][] | null
  >(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<TurbineLayout | null>(null);
  const [selectedTurbine, setSelectedTurbineState] = useState<TurbinePoint | null>(
    null,
  );
  const [pointReport, setPointReport] = useState<PointReport | null>(null);
  const [pointUiState, setPointUiState] = useState<PointUiState>("idle");
  const [pointError, setPointError] = useState<string | null>(null);

  /** State + ref in lock-step so the once-bound handlers read the live value. */
  const setSelectedTurbine = useCallback((pt: TurbinePoint | null) => {
    selectedTurbineRef.current = pt;
    setSelectedTurbineState(pt);
  }, []);

  /** Run the AOI screening for a ring (drawn AOI, boundary upload, footprint). */
  const runAnalysis = useCallback((ring: [number, number][]) => {
    const closed = closeRing(ring);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const seq = ++requestSeqRef.current;

    setCommittedAreaKm2(ringAreaKm2(closed));
    setCommittedRing(closed);
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
        const anyUnavailable = Object.values(res.sections).some(
          (s) => s.status === "unavailable",
        );
        setAnalysis(res);
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

  /** Cancel any in-flight per-turbine point report and reset its state. */
  const resetPointReport = useCallback(() => {
    pointAbortRef.current?.abort();
    pointSeqRef.current++;
    setPointReport(null);
    setPointError(null);
    setPointUiState("idle");
  }, []);

  /** Drop all uploaded-layout artifacts (markers, selection, point report). */
  const clearLayoutArtifacts = useCallback(() => {
    resetPointReport();
    layoutRef.current = null;
    setLayout(null);
    setSelectedTurbine(null);
    turbineLayerRef.current?.setLayout(null);
  }, [resetPointReport, setSelectedTurbine]);

  /** Screen one uploaded turbine individually (exact-point report). The AOI /
   *  footprint result is left untouched, so no box is drawn for the turbine. */
  const selectTurbine = useCallback((id: string) => {
    const lay = layoutRef.current;
    if (!lay) return;
    const pt = lay.points.find((p) => p.id === id);
    if (!pt) return;

    setSelectedTurbine(pt);
    turbineLayerRef.current?.setSelected(id);

    pointAbortRef.current?.abort();
    const ac = new AbortController();
    pointAbortRef.current = ac;
    const seq = ++pointSeqRef.current;
    setPointReport(null);
    setPointError(null);
    setPointUiState("loading");

    postAnalyzePoint(pt.lon, pt.lat, ac.signal)
      .then((report) => {
        if (seq !== pointSeqRef.current) return;
        setPointReport(report);
        setPointUiState("ok");
      })
      .catch((err: unknown) => {
        if (seq !== pointSeqRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof AnalyzeRequestError
            ? err.message
            : "Network error — turbine analysis could not run.";
        console.error("[analyze] point request failed", err);
        setPointError(message);
        setPointUiState("error");
      });
  }, [setSelectedTurbine]);

  /** Return from a single-turbine view to the site footprint (kept intact). */
  const clearTurbine = useCallback(() => {
    resetPointReport();
    setSelectedTurbine(null);
    turbineLayerRef.current?.setSelected(null);
  }, [resetPointReport, setSelectedTurbine]);

  const onMapLoad = useCallback(
    (map: MlMap, isInteractionBlocked?: () => boolean) => {
      controllerRef.current?.destroy();
      controllerRef.current = new AoiDrawController(map, {
        onLiveArea: (area, overCap) => {
          setLiveAreaKm2(area);
          setLiveOverCap(overCap);
        },
        onCommit: (ring) => {
          armedRef.current = null;
          setArmedMode(null);
          // A freshly drawn AOI replaces any uploaded layout context.
          clearLayoutArtifacts();
          controllerRef.current?.setCommitted(closeRing(ring));
          runAnalysis(ring);
        },
      });

      turbineLayerRef.current?.destroy();
      turbineLayerRef.current = new TurbineLayoutController(map, {
        onTurbineClick: selectTurbine,
        // Turbine clicks suppressed while a draw is armed (armedRef) or the page
        // says another tool (measure) owns clicks — prevents double-commits.
        isInteractionBlocked: () =>
          armedRef.current !== null || (isInteractionBlocked?.() ?? false),
      });

      // Map re-creation (session/tier flip) rebuilds both controllers fresh,
      // but the hook's layout state survives — re-apply it so the markers +
      // footprint polygon reappear instead of desyncing from the panel.
      if (layoutRef.current) {
        turbineLayerRef.current.setLayout(layoutRef.current);
        if (selectedTurbineRef.current) {
          turbineLayerRef.current.setSelected(selectedTurbineRef.current.id);
        }
        controllerRef.current.setCommitted(closeRing(layoutRef.current.footprintRing));
        return;
      }

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
    [runAnalysis, selectTurbine, clearLayoutArtifacts],
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
      // Invalidate any in-flight AOI request so a late response can't clobber
      // this upload's loading/error state.
      abortRef.current?.abort();
      requestSeqRef.current++;
      controller?.disarm();
      armedRef.current = null;
      setArmedMode(null);
      setError(null);
      setUiState("loading");
      // A boundary upload replaces any uploaded layout context.
      clearLayoutArtifacts();

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
    [runAnalysis, clearLayoutArtifacts],
  );

  const uploadLayoutFile = useCallback(
    (file: File) => {
      const controller = controllerRef.current;
      abortRef.current?.abort();
      requestSeqRef.current++;
      controller?.disarm();
      armedRef.current = null;
      setArmedMode(null);
      setError(null);
      setUiState("loading");
      // Reset any prior layout/turbine selection before the new one lands.
      clearLayoutArtifacts();

      parseLayoutFromFile(file)
        .then((lay) => {
          layoutRef.current = lay;
          setLayout(lay);
          turbineLayerRef.current?.setLayout(lay);
          const closed = closeRing(lay.footprintRing);
          controllerRef.current?.setCommitted(closed);
          controllerRef.current?.fitToRing(closed);
          runAnalysis(closed);
        })
        .catch((err: unknown) => {
          const message =
            err instanceof KmlParseError
              ? err.message
              : "Could not read that layout — upload a valid .kml or .kmz of turbine points.";
          console.error("[analyze] layout upload failed", err);
          setError(message);
          setUiState("error");
        });
    },
    [runAnalysis, clearLayoutArtifacts],
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
    clearLayoutArtifacts();
    armedRef.current = null;
    setArmedMode(null);
    setLiveAreaKm2(null);
    setLiveOverCap(false);
    setCommittedAreaKm2(null);
    setCommittedRing(null);
    setAnalysis(null);
    setError(null);
    setUiState("idle");
    setAoiHash(null);
  }, [clearLayoutArtifacts]);

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

  // Unmount: abort in-flight work and tear the controllers down.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      pointAbortRef.current?.abort();
      controllerRef.current?.destroy();
      controllerRef.current = null;
      turbineLayerRef.current?.destroy();
      turbineLayerRef.current = null;
    };
  }, []);

  return {
    uiState,
    armedMode,
    armedRef,
    liveAreaKm2,
    liveOverCap,
    committedAreaKm2,
    committedRing,
    analysis,
    error,
    layout,
    selectedTurbine,
    pointReport,
    pointUiState,
    pointError,
    onMapLoad,
    arm,
    uploadFile,
    uploadLayoutFile,
    selectTurbine,
    clearTurbine,
    disarm,
    clearAll,
  };
}
