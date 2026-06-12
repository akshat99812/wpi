"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl, { type Map as MlMap, type MapMouseEvent } from "maplibre-gl";
// maplibre-gl.css is loaded from app/globals.css instead of here — Next.js
// component-level imports of library CSS are unreliable.
import { useSession } from "@/lib/auth-client";
import { lookupElevation } from "@/lib/elevation/lookup";
import { lookupWind, loadWindGrid, DEFAULT_WIND_HEIGHT } from "@/lib/wind/lookup";
import { CursorReadoutBar } from "@/components/Map/components/CursorReadout";
import { ProSidebar, type ProTool } from "@/components/Map/components/ProSidebar";
import { MastDataTool, MastIcon } from "@/components/Map/components/MastDataTool";
import { AnalyzeTool, AnalyzeIcon } from "@/components/Map/components/AnalyzeTool";
import { useAoiAnalysis } from "@/components/Map/hooks/useAoiAnalysis";
import { BasemapToggle, type ProBasemap } from "@/components/Map/components/BasemapToggle";
import {
  LayersTool,
  LayersIcon,
  type MastHeightCat,
} from "@/components/Map/components/LayersTool";
import { WindResourceCard } from "@/components/Map/components/WindResourceCard";
import { addLightStateBoundaries } from "@/components/Map/utils/stateBoundaries";
import {
  addPrivateMasts,
  setPrivateMastsVisibility,
  PRIVATE_MASTS_LAYER_ID,
  PRIVATE_MASTS_HIT_LAYER_ID,
} from "@/components/Map/utils/privateMasts";
import { addPowerGrid, setPowerGridVisibility } from "@/components/Map/utils/powerGrid";
import {
  addWindResourceLayer,
  removeWindResourceLayer,
  setWindResourceContrast,
  snapWindHeight,
  WIND_METRICS,
} from "@/components/Map/utils/windResource";
import type { WindMetricChoice } from "@/components/Map/components/WindResourceCard";
import { CeclLoader } from "@/components/CeclLoader";
import type { CursorReadout, Windmill } from "@/components/Map/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

// Esri World Imagery — the same satellite raster the main map uses
// (see components/Map/constants.ts). Overlaid above the dark vector base but
// below the windmill pins, then cross-faded via raster-opacity (no setStyle).
const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_LAYER_ID = "pro-satellite";
// Cross-fade duration (ms) when switching road ↔ satellite.
const SAT_FADE_MS = 450;

// Cache-buster for the windmill vector tiles (backend disk cache + browser
// cache key on the full URL). Bump after each windmill data re-ingestion or
// tile-schema change. v2: tiles gained the `hcat` height-bucket property.
const WINDMILL_TILES_VERSION = 2;

// Minimum branded "terminal is booting" boot animation, even when the session
// resolves instantly. Keeps the Pro map entrance consistent with the landing page.
const BOOT_MS = 1600;

export default function ProMapPage() {
  const { data: session, isPending } = useSession();
  const mapRef = useRef<MlMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Mirrors `basemap` so the map-load closure (which deliberately omits
  // `basemap` from its deps) can read the latest value when it adds the layer.
  const basemapRef = useRef<ProBasemap>("road");
  // Mirror layer-visibility toggles so the map-load closure can set the right
  // initial visibility when it adds the layers (same pattern as basemapRef).
  const showWindmillsRef = useRef(false);
  const showMastsRef = useRef(true);
  const showPowerGridRef = useRef(false);
  const windMetricRef = useRef<WindMetricChoice>("off");
  const windHeightRef = useRef<number>(DEFAULT_WIND_HEIGHT);
  const [selected, setSelected] = useState<Windmill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [readout, setReadout] = useState<CursorReadout | null>(null);
  // Left-hand tool card — opens on the Analyze tool by default (product
  // call: site screening is the primary Pro workflow); clicking a mast pin
  // still jumps the card to the Masts tool.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTool, setActiveTool] = useState("analyze");
  // Right-hand "Layers" card — lets the user show/hide each dataset. Open by
  // default so the toggles are visible on entry; independent of the left card.
  const [layersOpen, setLayersOpen] = useState(true);
  // Layer visibility (labels per product spec; see the visibility effect for
  // the label → map-layer mapping). Default view = masts only; the user can
  // enable the wind-farm boundaries from the Layers card.
  //   "Windmills" → wind-farm site boundaries · "Masts" → mast points
  const [showWindmills, setShowWindmills] = useState(false);
  const [showMasts, setShowMasts] = useState(true);
  // Proprietary mast inventory (yellow pins, /api/private-masts).
  const [showPrivateMasts, setShowPrivateMasts] = useState(true);
  // "Electricity Grid" — OpenInfraMap lines/substations/wind+solar plants,
  // default off. The source + layers are created lazily on first enable
  // (addPowerGrid is idempotent); later toggles only flip visibility.
  const [showPowerGrid, setShowPowerGrid] = useState(false);
  // Mast measurement-height buckets (tile property `hcat`): all on = no filter.
  const [mastCats, setMastCats] = useState<Record<MastHeightCat, boolean>>({
    short: true,
    mid: true,
    tall: true,
  });
  // Wind-resource raster (GWA mean speed / power density) — single active
  // metric × height, default off. Available heights per metric come from the
  // bake-emitted metadata.json; any switch is a remove + re-add.
  const [windMetric, setWindMetric] = useState<WindMetricChoice>("off");
  const [windHeight, setWindHeight] = useState<number>(DEFAULT_WIND_HEIGHT);
  // Basemap: dark road map by default; satellite swaps an Esri raster on.
  const [basemap, setBasemap] = useState<ProBasemap>("road");
  // Branded boot animation — held for at least BOOT_MS so the "Intelligence
  // terminal is booting" screen always plays, even on an instant session.
  const [booting, setBooting] = useState(true);
  // Site-analysis tool: draw state machine, AOI layers, /api/analyze calls.
  const aoi = useAoiAnalysis();
  // Stable across renders; lets the once-registered map handlers read the
  // current draw-armed state synchronously (heads the click-priority chain).
  const aoiArmedRef = aoi.armedRef;

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), BOOT_MS);
    return () => clearTimeout(t);
  }, []);

  const user = session?.user as
    | { email: string; tier?: string | null }
    | undefined;
  const isPro = user?.tier === "PREMIUM";

  // Reveal the mast data the instant a pin is clicked: jump to the Masts tool
  // and expand the panel whenever a detail fetch starts, lands, or errors.
  useEffect(() => {
    if (detailLoading || selected || detailError) {
      setActiveTool("masts");
      setSidebarOpen(true);
    }
  }, [detailLoading, selected, detailError]);

  // Same reveal pattern for the Analyze tool: surface the panel the moment a
  // run starts (or lands / fails) so results never arrive into a closed card.
  useEffect(() => {
    if (
      aoi.uiState === "loading" ||
      aoi.uiState === "ok" ||
      aoi.uiState === "partial" ||
      aoi.uiState === "error"
    ) {
      setActiveTool("analyze");
      setSidebarOpen(true);
    }
  }, [aoi.uiState]);

  // Apply the road/satellite toggle by flipping the satellite raster's
  // visibility — no setStyle, so the map and windmill layers stay intact.
  // Guards on layer existence (it's added asynchronously on style load).
  useEffect(() => {
    basemapRef.current = basemap;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getLayer(SAT_LAYER_ID)) return;
      // Re-tune the wind-resource overlay (if any) for the new basemap —
      // translucent on the road map, near-opaque over satellite imagery.
      setWindResourceContrast(map, basemap === "satellite" ? "satellite" : "standard");
      if (basemap === "satellite") {
        // Render first, then fade the imagery in on the next frame so the
        // 0 → 1 opacity transition actually animates.
        map.setLayoutProperty(SAT_LAYER_ID, "visibility", "visible");
        requestAnimationFrame(() => {
          mapRef.current?.setPaintProperty(SAT_LAYER_ID, "raster-opacity", 1);
        });
      } else {
        // Fade the imagery out, then stop drawing it once fully transparent —
        // unless the user flipped back to satellite mid-fade.
        map.setPaintProperty(SAT_LAYER_ID, "raster-opacity", 0);
        window.setTimeout(() => {
          const m = mapRef.current;
          if (m?.getLayer(SAT_LAYER_ID) && basemapRef.current === "road") {
            m.setLayoutProperty(SAT_LAYER_ID, "visibility", "none");
          }
        }, SAT_FADE_MS + 60);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [basemap]);

  // Show/hide each dataset's map layers when the user toggles them in the
  // right-hand Layers card. Label → layer mapping (the point layer is
  // internally named "windmills" for historical reasons):
  //   "Windmills" toggle → wind-farm boundary polygons (windfarm-bnd-*)
  //   "Masts"     toggle → mast measurement points    (windmills-pts/hit)
  useEffect(() => {
    showWindmillsRef.current = showWindmills;
    showMastsRef.current = showMasts;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const setVis = (id: string, show: boolean) => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
        }
      };
      setVis("windfarm-bnd-fill", showWindmills);
      setVis("windfarm-bnd-line", showWindmills);
      setVis("windmills-pts", showMasts);
      setVis("windmills-hit", showMasts);
      // Util setter (not setVis) — it also closes an open mast popup on hide.
      setPrivateMastsVisibility(map, showPrivateMasts);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [showWindmills, showMasts, showPrivateMasts]);

  // Mast height-bucket filter on the pin layers. The tiles carry `hcat`
  // (0 = <50 m · 1 = 50–100 m · 2 = >100 m · −1 = unknown). All buckets on →
  // no filter at all, so unknown-height masts stay visible by default.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const codes: number[] = [];
      if (mastCats.short) codes.push(0);
      if (mastCats.mid) codes.push(1);
      if (mastCats.tall) codes.push(2);
      const filter =
        codes.length === 3
          ? null
          : ([
              "match",
              ["get", "hcat"],
              codes.length > 0 ? codes : [-999],
              true,
              false,
            ] as unknown as maplibregl.FilterSpecification);
      for (const id of [
        "windmills-pts",
        "windmills-hit",
        PRIVATE_MASTS_LAYER_ID,
        PRIVATE_MASTS_HIT_LAYER_ID,
      ]) {
        if (map.getLayer(id)) map.setFilter(id, filter);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [mastCats]);

  // "Electricity Grid" toggle. First enable lazily creates the source +
  // layers (addPowerGrid is idempotent — re-entry is a no-op); after that
  // the toggle only flips layer visibility.
  useEffect(() => {
    showPowerGridRef.current = showPowerGrid;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (showPowerGrid) {
        addPowerGrid(map);
        setPowerGridVisibility(map, true);
      } else {
        setPowerGridVisibility(map, false);
      }
    };
    // NOT once("load"): `load` fires once per map lifetime, and
    // isStyleLoaded() can be transiently false long after it (mid tile
    // fetch / style mutation) — a toggle flipped in that window would be
    // silently dropped. `idle` fires at every render settle, so the queued
    // apply always runs; multiple queued applies run in registration order
    // and the latest toggle state wins.
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [showPowerGrid]);

  // Wind-resource raster. Off → remove; metric/height change → remove +
  // re-add (raster sources can't swap tile templates in place). Inserted
  // below the state-boundary lines (or the mast pins as fallback) so every
  // vector overlay stays above the choropleth. Same once("idle") rationale
  // as the grid effect above.
  useEffect(() => {
    windMetricRef.current = windMetric;
    windHeightRef.current = windHeight;
    const map = mapRef.current;
    if (!map) return;
    // Warm the value grid for the cursor readout alongside the raster.
    if (windMetric !== "off") void loadWindGrid(windHeight, windMetric);
    const apply = () => {
      if (windMetric === "off") {
        removeWindResourceLayer(map);
      } else {
        addWindResourceLayer(map, windMetric, windHeight, {
          beforeId: ["pro-state-casing", "windmills-pts"].find((id) =>
            map.getLayer(id),
          ),
          // Near-opaque over satellite imagery — at road-map opacity the
          // ramp's coastal low end reads as "no coverage" on dark terrain.
          contrast: basemapRef.current === "satellite" ? "satellite" : "standard",
        });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [windMetric, windHeight]);

  // Metric switch handler — snaps the height to the nearest one available
  // for the new metric (e.g. speed @ 50 m → density snaps to 100 m).
  const handleWindMetricChange = (next: WindMetricChoice) => {
    if (next !== "off") setWindHeight((h) => snapWindHeight(next, h));
    setWindMetric(next);
  };

  useEffect(() => {
    // Deps intentionally use ONLY primitives. The `user` object's reference
    // changes every time Better Auth refreshes the session, and including
    // it here would tear down + re-create the map (snapping back to the
    // initial center/zoom every few seconds).
    if (isPending || !isPro || !containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // OpenFreeMap public "liberty" style — colourful OSM-derived road map
      // (no API key, free hosted; same style the main map falls back to). Swap
      // to "bright"/"positron"/"dark" here if a different look is wanted.
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [78.9629, 22.5937],
      zoom: 4.4,
      minZoom: 3,
      maxZoom: 17,
      // Better Auth cookie is httpOnly + Domain=.windpowerindia.com in prod;
      // forcing credentials on every API tile fetch ensures the cookie ships.
      transformRequest: (url) => {
        if (url.startsWith(API_URL)) {
          return { url, credentials: "include" as const };
        }
        return { url };
      },
    });
    mapRef.current = map;

    // Wind readout uses the pre-baked GWA grid; load the default height once
    // (the Pro map has no height switcher — it just shows @100 m).
    void loadWindGrid(DEFAULT_WIND_HEIGHT);

    // Top-RIGHT so it doesn't collide with the left-edge tool card (the right
    // edge is free now that the tool card lives on the left).
    map.addControl(new maplibregl.NavigationControl({}), "top-right");

    // Live cursor readout (lat / lng / elevation) — same pre-baked grid
    // lookup the main map uses, so it's synchronous and free per move.
    const onMove = (e: MapMouseEvent) => {
      const { lat, lng } = e.lngLat;
      const metric = windMetricRef.current;
      setReadout({
        lng,
        lat,
        zoom: map.getZoom(),
        elevation: lookupElevation(lat, lng),
        wind: lookupWind(lat, lng, DEFAULT_WIND_HEIGHT),
        // Mirror the ACTIVE wind-resource layer (metric + height) so the bar
        // reads exactly what the choropleth shows.
        resource:
          metric === "off"
            ? undefined
            : {
                value: lookupWind(lat, lng, windHeightRef.current, metric),
                unit: WIND_METRICS[metric].unit,
                height: windHeightRef.current,
              },
      });
    };
    const onLeave = () => setReadout(null);
    map.on("mousemove", onMove);
    map.on("mouseout", onLeave);

    // ResizeObserver + delayed re-resize is the bulletproof fix for the
    // canvas-stays-at-default-300px-tall bug. Don't remove without testing.
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);

    map.on("load", () => {
      map.resize();
      setTimeout(() => mapRef.current?.resize(), 100);
      setTimeout(() => mapRef.current?.resize(), 500);

      // Satellite imagery sits above the dark vector base but below the windmill
      // pins (added next), so toggling it never hides the points. Starts hidden
      // and is shown/hidden by the `basemap` effect below.
      map.addSource(SAT_LAYER_ID, {
        type: "raster",
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        attribution: "© Esri",
      });
      map.addLayer({
        id: SAT_LAYER_ID,
        type: "raster",
        source: SAT_LAYER_ID,
        layout: { visibility: basemapRef.current === "satellite" ? "visible" : "none" },
        paint: {
          // Cross-faded via raster-opacity by the basemap effect. Starts at the
          // value matching the current mode so the first paint isn't a flash.
          "raster-opacity": basemapRef.current === "satellite" ? 1 : 0,
          "raster-opacity-transition": { duration: SAT_FADE_MS, delay: 0 },
        },
      });

      map.addSource("windmills", {
        type: "vector",
        // ?v= busts the backend disk cache + browser cache — bump after each
        // windmill data re-ingestion (UUIDs change).
        tiles: [`${API_URL}/api/tiles/{z}/{x}/{y}.mvt?v=${WINDMILL_TILES_VERSION}`],
        minzoom: 4,
        maxzoom: 16,
      });

      // Visible pin — slightly larger than before for better feedback.
      map.addLayer({
        id: "windmills-pts",
        type: "circle",
        source: "windmills",
        "source-layer": "windmills",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4, 3,
            10, 5,
            16, 9,
          ],
          "circle-color": "#1d9bf0",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0a0a0a",
          "circle-opacity": 0.9,
        },
      });

      // Invisible hit-target layer — much wider radius so clicks/hovers
      // catch even when the cursor isn't directly on the visible dot.
      // Added AFTER the visual layer so it's on top in the event order.
      map.addLayer({
        id: "windmills-hit",
        type: "circle",
        source: "windmills",
        "source-layer": "windmills",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4, 10,
            10, 14,
            16, 20,
          ],
          "circle-color": "#000",
          "circle-opacity": 0,
        },
      });

      // Light India state boundaries — drawn above both basemaps but BELOW the
      // pins (beforeId), so they show in road and satellite modes without ever
      // swallowing a pin click. Fire-and-forget: fetches GeoJSON, then adds.
      void addLightStateBoundaries(map, { beforeId: "windmills-pts" });

      // Proprietary wind-farm site boundaries (Pro-gated GeoJSON). The map's
      // transformRequest attaches the auth cookie for API_URL requests, so this
      // source fetch is authenticated. Faint orange fill + outline, below pins.
      map.addSource("windfarm-bnd", {
        type: "geojson",
        data: `${API_URL}/api/boundaries`,
      });
      map.addLayer(
        {
          id: "windfarm-bnd-fill",
          type: "fill",
          source: "windfarm-bnd",
          // Light-orange fill so each wind-farm boundary reads clearly against
          // both basemaps (was 0.07 — too faint to see).
          paint: { "fill-color": "#ff8a1f", "fill-opacity": 0.2 },
        },
        "windmills-pts",
      );
      map.addLayer(
        {
          id: "windfarm-bnd-line",
          type: "line",
          source: "windfarm-bnd",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ff8a1f", "line-width": 1.4, "line-opacity": 0.9 },
        },
        "windmills-pts",
      );

      // Apply the current Layers-card visibility to the freshly-added layers
      // (defaults are both visible; this also restores the user's choice if
      // the map is ever re-created).
      const initVis = (id: string, show: boolean) => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
        }
      };
      initVis("windfarm-bnd-fill", showWindmillsRef.current);
      initVis("windfarm-bnd-line", showWindmillsRef.current);
      initVis("windmills-pts", showMastsRef.current);
      initVis("windmills-hit", showMastsRef.current);

      // If the grid toggle was already on when the map (re)loaded — e.g. the
      // map instance was re-created after a session refresh — re-add it now
      // that the mast layers exist (the grid inserts itself below them).
      if (showPowerGridRef.current) addPowerGrid(map);

      // Likewise re-add an active wind-resource raster on map re-creation.
      if (windMetricRef.current !== "off") {
        addWindResourceLayer(map, windMetricRef.current, windHeightRef.current, {
          beforeId: "windmills-pts",
          contrast: basemapRef.current === "satellite" ? "satellite" : "standard",
        });
      }

      // Attach the AOI draw controller now that the pin layer exists (its
      // layers anchor below windmills-pts, like the farm boundaries).
      aoi.onMapLoad(map);

      // Private masts (yellow, GeoJSON) — below the public pins so public
      // clicks win on overlap; clicks are suppressed while AOI draw is armed.
      // A click opens the SAME MastDataTool card the public masts use, as a
      // synthetic Windmill record: name + height + sampled elevation, every
      // attribute the inventory doesn't carry left null (the card renders
      // those rows blank). No detail fetch — everything is already client-side.
      addPrivateMasts(map, {
        isInteractionBlocked: () => Boolean(aoiArmedRef.current),
        onSelect: (props, lngLat) => {
          setDetailError(null);
          setDetailLoading(false);
          setSelected({
            // Coordinate-keyed: cleaned display names repeat across distinct
            // masts (two "Akal"s), so the name can't identify a pin.
            id: `private:${lngLat.lng.toFixed(6)},${lngLat.lat.toFixed(6)}`,
            lat: lngLat.lat,
            lon: lngLat.lng,
            cum_no: null,
            state: null,
            station: props.name,
            district: null,
            date_commence: null,
            date_close: null,
            mast_height_m: props.heightM,
            elevation_masl: props.elevationMasl,
            maws_ms: null,
            mawpd_wm2: null,
            coord_complete: null,
          });
        },
      });

      map.on("click", "windmills-hit", async (e: MapMouseEvent) => {
        // Draw-armed heads the click-priority chain: while the user is
        // placing a point/rectangle/polygon, mast popups must not fire.
        if (aoiArmedRef.current) return;
        const feat = (e as MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }).features?.[0];
        const id = feat?.properties?.id as string | undefined;
        if (!id) return;
        setSelected(null);
        setDetailError(null);
        setDetailLoading(true);
        try {
          const res = await fetch(`${API_URL}/api/windmill/${id}`, {
            credentials: "include",
          });
          if (res.status === 401 || res.status === 403) {
            setDetailError("Your Pro session ended — please sign in again.");
            return;
          }
          if (res.status === 429) {
            setDetailError("Slow down a bit — too many requests.");
            return;
          }
          if (!res.ok) {
            setDetailError(`Lookup failed (${res.status})`);
            return;
          }
          setSelected((await res.json()) as Windmill);
        } catch {
          setDetailError("Network error");
        } finally {
          setDetailLoading(false);
        }
      });

      map.on("mouseenter", "windmills-hit", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "windmills-hit", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [isPending, isPro]);

  // Sidebar tools: mast detail + site analysis.
  const tools: ProTool[] = [
    {
      id: "masts",
      label: "Mast data",
      Icon: MastIcon,
      badge: selected != null,
      content: (
        <MastDataTool
          selected={selected}
          loading={detailLoading}
          error={detailError}
        />
      ),
    },
    {
      id: "analyze",
      label: "Analyze site",
      Icon: AnalyzeIcon,
      badge: aoi.analysis != null,
      content: (
        <AnalyzeTool
          uiState={aoi.uiState}
          armedMode={aoi.armedMode}
          liveAreaKm2={aoi.liveAreaKm2}
          liveOverCap={aoi.liveOverCap}
          committedAreaKm2={aoi.committedAreaKm2}
          analysis={aoi.analysis}
          error={aoi.error}
          onArm={aoi.arm}
          onClear={aoi.clearAll}
        />
      ),
    },
  ];

  // Right-hand "Layers" card — a single tool whose content is the dataset
  // visibility toggles (Windmills = farm boundaries, Masts = mast points).
  const layerTools: ProTool[] = [
    {
      id: "layers",
      label: "Layers",
      Icon: LayersIcon,
      content: (
        <LayersTool
          showWindmills={showWindmills}
          showMasts={showMasts}
          showPrivateMasts={showPrivateMasts}
          showPowerGrid={showPowerGrid}
          mastCats={mastCats}
          onToggleWindmills={setShowWindmills}
          onToggleMasts={setShowMasts}
          onTogglePrivateMasts={setShowPrivateMasts}
          onTogglePowerGrid={setShowPowerGrid}
          onMastCatChange={(cat, next) =>
            setMastCats((prev) => ({ ...prev, [cat]: next }))
          }
        />
      ),
    },
  ];

  return (
    // `position: fixed` below the 68px-tall TopBar — bypasses whatever in
    // the portal flex chain was clamping height.
    <div
      style={{
        position: "fixed",
        top: 68,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
      }}
    >
      {/* Map container always mounted so the ref attaches on first paint.
          Overlays gate UX rather than swapping the DOM. */}
      <div ref={containerRef} className="absolute inset-0 bg-slate-900" />

      {isPro && (
        <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
          <BasemapToggle mode={basemap} onChange={setBasemap} />
          <CursorReadoutBar
            readout={readout}
            resource={
              windMetric === "off"
                ? null
                : { unit: WIND_METRICS[windMetric].unit, height: windHeight }
            }
          />
        </div>
      )}

      {/* Wind-resource controls + ramp legend, docked above the bottom-right
          map attribution so the legend sits where map legends are expected. */}
      {isPro && (
        <div className="absolute bottom-8 right-3 z-10">
          <WindResourceCard
            metric={windMetric}
            height={windHeight}
            value={readout?.resource?.value}
            onMetricChange={handleWindMetricChange}
            onHeightChange={setWindHeight}
          />
        </div>
      )}


      {(isPending || booting) && (
        <CeclLoader label="Intelligence Terminal Loading" />
      )}

      {!isPending && !user && (
        <Overlay>
          <h1 className="text-xl font-semibold mb-2">Pro Map</h1>
          <p className="mb-4">Sign in to your Pro account to view the wind-farm map.</p>
          <Link href="/login" className="text-sky-400 hover:underline">Sign in →</Link>
        </Overlay>
      )}

      {!isPending && user && !isPro && (
        <Overlay>
          <h1 className="text-xl font-semibold mb-2">Pro members only</h1>
          <p className="mb-4 text-slate-300">
            The Pro wind-farm map exposes proprietary turbine-level point data and
            is available to Premium subscribers.
          </p>
          <Link href="/dashboard" className="text-sky-400 hover:underline">
            Back to dashboard →
          </Link>
        </Overlay>
      )}

      {isPro && (
        <>
          <ProSidebar
            side="left"
            tools={tools}
            activeId={activeTool}
            open={sidebarOpen}
            onActiveChange={setActiveTool}
            onOpenChange={setSidebarOpen}
          />
          <ProSidebar
            side="right"
            tools={layerTools}
            activeId="layers"
            open={layersOpen}
            onActiveChange={() => {}}
            onOpenChange={setLayersOpen}
          />
        </>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
      <div className="rounded-lg border border-slate-700 bg-slate-900/90 p-8 text-center text-slate-200 max-w-md">
        {children}
      </div>
    </div>
  );
}
