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
import { ProSidebar, ToolsIcon, type ProTool } from "@/components/Map/components/ProSidebar";
import { MastDataTool, MastIcon } from "@/components/Map/components/MastDataTool";
import { TurbineDataTool, TurbineIcon } from "@/components/Map/components/TurbineDataTool";
import { AnalyzeTool, AnalyzeIcon } from "@/components/Map/components/AnalyzeTool";
import { MeasureTool } from "@/components/Map/components/MeasureTool";
import { PlaceSearch } from "@/components/Map/components/PlaceSearch";
import { TerrainTool, TerrainIcon } from "@/components/Map/components/TerrainTool";
import { useAoiAnalysis } from "@/components/Map/hooks/useAoiAnalysis";
import { useMeasureDistance } from "@/components/Map/hooks/useMeasureDistance";
import { useTerrain } from "@/components/Map/hooks/useTerrain";
import { useLogisticsRouteLayer } from "@/components/Map/hooks/useLogisticsRouteLayer";
import { subscribeLogisticsRoutes } from "@/lib/logisticsRouteStore";
import type { LogisticsRoutesPayload } from "@/lib/logistics";
import type { AoiDrawMode } from "@/components/Map/utils/aoiDraw";
import { BasemapToggle, type ProBasemap } from "@/components/Map/components/BasemapToggle";
import {
  LayersTool,
  LayersIcon,
  type MastHeightCat,
} from "@/components/Map/components/LayersTool";
import { WindResourceCard, WindIcon } from "@/components/Map/components/WindResourceCard";
import {
  addLightStateBoundaries,
  setStateBoundariesVisibility,
} from "@/components/Map/utils/stateBoundaries";
import {
  addPrivateMasts,
  setPrivateMastsVisibility,
  PRIVATE_MASTS_LAYER_ID,
  PRIVATE_MASTS_HIT_LAYER_ID,
  PRIVATE_MAST_COLOR,
} from "@/components/Map/utils/privateMasts";
import {
  addPowerGrid,
  prefetchPowerGrid,
  setPowerGridVisibility,
  setPowerGridVoltageFilter,
  VOLTAGE_BANDS,
} from "@/components/Map/utils/powerGrid";
import {
  addTurbines,
  setTurbinesVisibility,
  TURBINES_LAYER_ID,
  TURBINES_HIT_LAYER_ID,
} from "@/components/Map/utils/turbines";
import {
  addExclusions,
  setExclusionsVisibility,
  EXCL_FILL_LAYER_ID,
  EXCL_OUTLINE_LAYER_ID,
} from "@/components/Map/utils/exclusions";
import {
  addPolicyScore,
  setPolicyScoreVisibility,
} from "@/components/Map/utils/policyScore";
import {
  addOffshoreWind,
  setOffshoreWindVisibility,
  type OffshoreData,
  type OffshoreZoneProps,
  type OffshoreProjectProps,
} from "@/components/Map/utils/offshoreWind";
import {
  OffshoreWindTool,
  OffshoreIcon,
} from "@/components/Map/components/OffshoreWindTool";
import { PolicyScoreLegend } from "@/components/Map/components/PolicyScoreLegend";
import {
  addWindResourceLayer,
  removeWindResourceLayer,
  setWindResourceContrast,
  setWindResourceOpacity,
  snapWindHeight,
  WIND_METRICS,
} from "@/components/Map/utils/windResource";
import type { WindMetricChoice } from "@/components/Map/components/WindResourceCard";
import { CeclLoader } from "@/components/CeclLoader";
import type { CursorReadout, Windmill, Turbine } from "@/components/Map/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

// Esri World Imagery — the same satellite raster the main map uses
// (see components/Map/constants.ts). Overlaid above the dark vector base but
// below the windmill pins, then cross-faded via raster-opacity (no setStyle).
const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_LAYER_ID = "pro-satellite";
// Masts cut off below this zoom: the backend tile route returns 204 for z<4
// (an anti-scrape guard — see windmills.ts), so the vector source is minzoom 4.
// The map's minZoom is floored here too, so the dots can never scroll into the
// empty zone and "disappear" on zoom-out.
const MAST_MIN_ZOOM = 4;
// Cross-fade duration (ms) when switching road ↔ satellite.
const SAT_FADE_MS = 450;

// Cache-buster for the windmill vector tiles (backend disk cache + browser
// cache key on the full URL). Bump after each windmill data re-ingestion or
// tile-schema change. v2: tiles gained the `hcat` height-bucket property.
const WINDMILL_TILES_VERSION = 2;

// Minimum branded "terminal is booting" boot animation, even when the session
// resolves instantly. Keeps the Pro map entrance consistent with the landing page.
const BOOT_MS = 2800;

// Default view loads the mean-wind-speed raster at 150 m (a baked height — see
// public/wind-atlas/metadata.json) at half opacity. Distinct from
// DEFAULT_WIND_HEIGHT (100 m), which drives the cursor-readout grid lookup.
const DEFAULT_WIND_RASTER_HEIGHT = 150;
const DEFAULT_WIND_RASTER_OPACITY = 0.5;

export default function ProMapPage() {
  const { data: session, isPending } = useSession();
  const mapRef = useRef<MlMap | null>(null);

  // Logistics routes plotted from the planner popup (pushed via the route store,
  // which bridges the portalled modal to this map).
  const [logisticsRoutes, setLogisticsRoutes] = useState<LogisticsRoutesPayload | null>(null);
  useEffect(() => subscribeLogisticsRoutes(setLogisticsRoutes), []);
  useLogisticsRouteLayer(mapRef, logisticsRoutes);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Mirrors `basemap` so the map-load closure (which deliberately omits
  // `basemap` from its deps) can read the latest value when it adds the layer.
  const basemapRef = useRef<ProBasemap>("road");
  // Mirror layer-visibility toggles so the map-load closure can set the right
  // initial visibility when it adds the layers (same pattern as basemapRef).
  // Default Pro-map view: masts OFF, individual turbines ON across all zooms.
  const showMastsRef = useRef(false);
  const showTurbinesRef = useRef(true);
  const showExclusionsRef = useRef(false);
  const showPowerGridRef = useRef(true);
  const showPolicyScoreRef = useRef(false);
  const showOffshoreRef = useRef(false);
  const windMetricRef = useRef<WindMetricChoice>("speed");
  const windHeightRef = useRef<number>(DEFAULT_WIND_RASTER_HEIGHT);
  // 3D terrain is the one toggle owned by useTerrain, but the map-load closure
  // needs its latest value to hide state boundaries the instant they finish
  // loading (boundaries are fetched async — see the effect below).
  const terrainEnabledRef = useRef(false);
  const [selected, setSelected] = useState<Windmill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // Individual OSM wind-turbine selection — its own card (TurbineDataTool),
  // independent of the mast `selected` above.
  const [selectedTurbine, setSelectedTurbine] = useState<Turbine | null>(null);
  const [turbineLoading, setTurbineLoading] = useState(false);
  const [turbineError, setTurbineError] = useState<string | null>(null);
  const [readout, setReadout] = useState<CursorReadout | null>(null);
  // Left-hand DATA card — mast detail + site-analysis results. Opens on the
  // analysis tab by default; clicking a mast pin jumps it to the Masts tab.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTool, setActiveTool] = useState("analysis");
  // Right-hand TOOLS card — one stacked panel: site-screening draw controls,
  // wind-resource layer controls, then dataset visibility toggles, one below
  // the other (no tabs). Independent of the left card.
  const [rightOpen, setRightOpen] = useState(true);
  // Layer visibility (labels per product spec; see the visibility effect for
  // the label → map-layer mapping). Default view = masts only.
  // Single "Masts" toggle drives BOTH datasets: the public NIWE mast points
  // and the proprietary inventory (yellow pins, /api/private-masts).
  const [showMasts, setShowMasts] = useState(false);
  // "Wind turbines" — individual OSM/OpenInfraMap turbine points (black dots),
  // /api/tiles/turbines MVT. Off by default; enable from the Layers card. The
  // visible dots appear from low zoom and gain full fidelity when zoomed in.
  const [showTurbines, setShowTurbines] = useState(true);
  // "Exclusion zones" — legal exclusion polygons (red = hard, amber = verify),
  // /api/tiles/exclusions MVT. Off by default; fills sit below the point layers.
  const [showExclusions, setShowExclusions] = useState(false);
  // "Electricity Grid" — OpenInfraMap lines/substations/wind+solar plants,
  // on by default (part of the default load view). The source + layers are
  // created lazily on first enable (addPowerGrid is idempotent); later toggles
  // only flip visibility.
  const [showPowerGrid, setShowPowerGrid] = useState(true);
  // "Policy score" — state polygons coloured by composite wind-policy
  // attractiveness (best → worst), GeoJSON from /api/policy/score. Off by default.
  const [showPolicyScore, setShowPolicyScore] = useState(false);
  // "Offshore wind" — NIWE/FOWIND-identified offshore zones (indicative cyan
  // fills) + VGF/LiDAR project pins, GeoJSON from /api/offshore-wind. Off by
  // default; the one fetch also feeds the Offshore-wind tool panel (zones,
  // projects + national policy block). Below the pins, like exclusions.
  const [showOffshore, setShowOffshore] = useState(false);
  const [offshoreData, setOffshoreData] = useState<OffshoreData | null>(null);
  const [offshoreLoading, setOffshoreLoading] = useState(true);
  const [offshoreError, setOffshoreError] = useState<string | null>(null);
  const [selectedOffshoreZone, setSelectedOffshoreZone] =
    useState<OffshoreZoneProps | null>(null);
  const [selectedOffshoreProject, setSelectedOffshoreProject] =
    useState<OffshoreProjectProps | null>(null);
  // Mast measurement-height buckets (tile property `hcat`): all on = no filter.
  const [mastCats, setMastCats] = useState<Record<MastHeightCat, boolean>>({
    short: true,
    mid: true,
    tall: true,
  });
  // Grid line-voltage bands (band-min kV → on). All on = no filter, so
  // unknown-voltage lines stay visible by default.
  const [voltageBands, setVoltageBands] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(VOLTAGE_BANDS.map((b) => [String(b.kv), true])),
  );
  // Wind-resource raster (GWA mean speed / power density) — single active
  // metric × height. Default load view = mean speed @ 150 m. Available heights
  // per metric come from the bake-emitted metadata.json; any switch is a
  // remove + re-add.
  const [windMetric, setWindMetric] = useState<WindMetricChoice>("speed");
  const [windHeight, setWindHeight] = useState<number>(DEFAULT_WIND_RASTER_HEIGHT);
  // User opacity (0–1) for the wind-resource raster, on top of the basemap
  // contrast curve. Defaults to 50% for the default load view. Persisted in the
  // layer module so metric/height re-adds keep it; this effect re-applies it
  // whenever the slider moves.
  const [windOpacity, setWindOpacity] = useState<number>(DEFAULT_WIND_RASTER_OPACITY);
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
  // Measure-distance tool: arm/click state machine + measurement layers.
  const measure = useMeasureDistance();
  const measureArmedRef = measure.armedRef;
  // 3D terrain + hypsometric elevation tint, over one shared DEM source.
  const terrain = useTerrain();

  // The two click-owning tools are mutually exclusive: arming one disarms
  // the other, so they never both own the next map click.
  const armAoi = (mode: AoiDrawMode) => {
    measure.disarm();
    aoi.arm(mode);
  };
  // Uploading a KML/KMZ also takes over the AOI flow, so release the measure tool.
  const uploadAoiFile = (file: File) => {
    measure.disarm();
    aoi.uploadFile(file);
  };
  const toggleMeasure = () => {
    if (measure.armed) {
      measure.disarm();
    } else {
      aoi.disarm();
      measure.arm();
    }
  };

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

  // Same reveal pattern for an individual turbine: clicking a black dot jumps
  // the left card to the Turbine-data tool and expands the panel.
  useEffect(() => {
    if (turbineLoading || selectedTurbine || turbineError) {
      setActiveTool("turbines");
      setSidebarOpen(true);
    }
  }, [turbineLoading, selectedTurbine, turbineError]);

  // Same reveal pattern for analysis results: surface the left data panel the
  // moment a run starts (or lands / fails) so results never arrive into a
  // closed card. The draw controls live in the right tools bar.
  useEffect(() => {
    if (
      aoi.uiState === "loading" ||
      aoi.uiState === "ok" ||
      aoi.uiState === "partial" ||
      aoi.uiState === "error"
    ) {
      setActiveTool("analysis");
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

  // Show/hide the mast layers when the user toggles them in the right-hand
  // Layers card. The "Masts" toggle drives the mast measurement points
  // (windmills-pts/hit — internally named "windmills" for historical reasons)
  // plus the private-inventory pins.
  useEffect(() => {
    showMastsRef.current = showMasts;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const setVis = (id: string, show: boolean) => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
        }
      };
      setVis("windmills-pts", showMasts);
      setVis("windmills-hit", showMasts);
      // Util setter (not setVis) — it also closes an open mast popup on hide.
      // Private masts share the single "Masts" toggle.
      setPrivateMastsVisibility(map, showMasts);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [showMasts]);

  // Hide India state boundaries in 3D terrain mode AND on the satellite
  // basemap: the flat lines drape awkwardly over tilted relief, and the
  // satellite imagery already carries its own coastlines/borders, so the white
  // overlay just adds clutter. Boundaries show only on the flat road map.
  useEffect(() => {
    terrainEnabledRef.current = terrain.enabled;
    const map = mapRef.current;
    if (!map) return;
    const show = !terrain.enabled && basemap !== "satellite";
    const apply = () => setStateBoundariesVisibility(map, show);
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [terrain.enabled, basemap]);

  // "Wind turbines" toggle — flips the black-dot layers (added in the load
  // handler). Separate effect so it can't interfere with the mast toggles.
  useEffect(() => {
    showTurbinesRef.current = showTurbines;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setTurbinesVisibility(map, showTurbines);
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [showTurbines]);

  // "Exclusion zones" toggle — flips the legal-exclusion fills (added in the
  // load handler). Separate effect, mirrors the turbine toggle.
  useEffect(() => {
    showExclusionsRef.current = showExclusions;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setExclusionsVisibility(map, showExclusions);
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [showExclusions]);

  // "Policy score" choropleth toggle. addPolicyScore (lazy, idempotent) runs in
  // the load handler; here we only flip visibility.
  useEffect(() => {
    showPolicyScoreRef.current = showPolicyScore;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setPolicyScoreVisibility(map, showPolicyScore);
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [showPolicyScore]);

  // "Offshore wind" toggle — flips the zone fills + project pins (added async
  // in the load handler; they apply their own initial visibility). Mirrors the
  // exclusion/policy-score toggles.
  useEffect(() => {
    showOffshoreRef.current = showOffshore;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setOffshoreWindVisibility(map, showOffshore);
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [showOffshore]);

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

  // Grid line-voltage filter. All bands on → no restriction (the setter
  // normalizes a full set to "show all", so unknown-voltage lines stay
  // visible). Applying while the grid is off is a harmless no-op — the layers
  // don't exist yet, and addPowerGrid honours the current selection when it
  // lazily creates them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const selected = new Set(
        VOLTAGE_BANDS.filter((b) => voltageBands[String(b.kv)]).map((b) => b.kv),
      );
      setPowerGridVoltageFilter(map, selected);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [voltageBands]);

  // "Electricity Grid" toggle. First enable lazily creates the source +
  // layers (addPowerGrid is idempotent — re-entry is a no-op); after that
  // the toggle only flips layer visibility.
  useEffect(() => {
    showPowerGridRef.current = showPowerGrid;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (showPowerGrid) {
        // Grid popups stand down while a click-owning tool is armed.
        addPowerGrid(map, {
          isInteractionBlocked: () =>
            Boolean(aoiArmedRef.current || measureArmedRef.current),
        });
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

  // User opacity → live raster-opacity. The layer module persists the factor,
  // so a no-op when no layer is on is fine (it applies on the next add).
  useEffect(() => {
    const map = mapRef.current;
    if (map) setWindResourceOpacity(map, windOpacity);
  }, [windOpacity]);

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
      // Country-overview start: centred on India, zoomed to show the whole grid.
      center: [78.9629, 22.5937],
      zoom: 4.7,
      // Floor the zoom at the mast cutoff so the dots never vanish on zoom-out
      // (below this the backend withholds mast tiles — see windmills.ts 204).
      minZoom: MAST_MIN_ZOOM,
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

    // Wind readout uses the pre-baked GWA grid (~237 KB), needed only for the
    // live cursor readout — defer it until the map is idle so it never competes
    // with first paint. lookupWind returns null until the grid is in memory, so
    // the readout simply starts populating once this resolves.
    map.once("idle", () => void loadWindGrid(DEFAULT_WIND_HEIGHT));

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
        // Exact DEM elevation when 3D terrain is on (queryTerrainElevation),
        // else the pre-baked SRTM grid — same synchronous, free lookup.
        elevation: terrain.sampleElevation(map, e.lngLat) ?? lookupElevation(lat, lng),
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
        minzoom: MAST_MIN_ZOOM,
        maxzoom: 16,
      });

      // Visible pin — kept compact so the dots don't dominate the map (the
      // wide invisible windmills-hit layer below preserves easy clicking).
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
            4, 2,
            10, 3.5,
            16, 6.5,
          ],
          "circle-color": "#1d9bf0",
          "circle-stroke-width": 1,
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

      // Light India state boundaries — drawn above the basemap but BELOW the
      // pins (beforeId) so they never swallow a pin click. Shown only on the
      // flat road map (hidden in 3D + on satellite, per the effect above).
      // Fire-and-forget: fetches GeoJSON, then adds.
      // Once added, immediately honour the current state (boundaries are hidden
      // in 3D terrain mode and on satellite) — covers a toggle flipped
      // mid-fetch.
      void addLightStateBoundaries(map, { beforeId: "windmills-pts" }).then(() =>
        setStateBoundariesVisibility(
          map,
          !terrainEnabledRef.current && basemapRef.current !== "satellite",
        ),
      );

      // Apply the current Layers-card visibility to the freshly-added layers
      // (this also restores the user's choice if the map is ever re-created).
      const initVis = (id: string, show: boolean) => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
        }
      };
      initVis("windmills-pts", showMastsRef.current);
      initVis("windmills-hit", showMastsRef.current);

      // If the grid toggle was already on when the map (re)loaded — e.g. the
      // map instance was re-created after a session refresh — re-add it now
      // that the mast layers exist (the grid inserts itself below them).
      if (showPowerGridRef.current) {
        addPowerGrid(map, {
          isInteractionBlocked: () =>
            Boolean(aoiArmedRef.current || measureArmedRef.current),
        });
      } else {
        // Otherwise warm the India-clip outline in the background so the FIRST
        // grid toggle is instant instead of stalling up to OUTLINE_WAIT_MS
        // while it fetches the outline cold.
        prefetchPowerGrid();
      }

      // Wind-resource raster (default view = mean speed @ 150 m), also re-added
      // here on map re-creation. Deferred to idle: we've just added the
      // satellite + windmills sources above, so map.isStyleLoaded() is
      // transiently FALSE (pending source updates + tiles still loading) and
      // addWindResourceLayer's style-ready guard would silently bail — the bug
      // that left the speed layer missing on first load. At idle the style is
      // fully settled, so the add reliably succeeds (same rationale as the
      // policy-score + offshore adds below).
      map.once("idle", () => {
        // Read the refs at idle so the very latest metric/height wins.
        const metric = windMetricRef.current;
        if (metric === "off") return;
        addWindResourceLayer(map, metric, windHeightRef.current, {
          beforeId: "windmills-pts",
          contrast: basemapRef.current === "satellite" ? "satellite" : "standard",
        });
      });

      // Attach the AOI draw controller now that the pin layer exists (its
      // layers anchor below windmills-pts, like the farm boundaries).
      aoi.onMapLoad(map);

      // Measure-distance tool — its layers are created lazily on first arm
      // and sit ABOVE the pins (transient tooling, never data).
      measure.onMapLoad(map);

      // 3D terrain + elevation tint — registers the DEM protocol and re-applies
      // any active terrain/tint if the map was re-created (session refresh).
      // Default state is off, so this is a no-op on first load.
      terrain.onMapLoad(map);

      // Private masts (yellow, GeoJSON) — below the public pins so public
      // clicks win on overlap; clicks are suppressed while AOI draw is armed.
      // A click opens the SAME MastDataTool card the public masts use, as a
      // synthetic Windmill record: name + height + sampled elevation, every
      // attribute the inventory doesn't carry left null (the card renders
      // those rows blank). No detail fetch — everything is already client-side.
      addPrivateMasts(map, {
        // Hide on first mount if masts are off by default — the layers are added
        // after an async fetch, so a synchronous initVis can't reach them.
        initialVisible: showMastsRef.current,
        isInteractionBlocked: () =>
          Boolean(aoiArmedRef.current || measureArmedRef.current),
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
      // The single "Masts" toggle is OFF by default, but addPrivateMasts adds the
      // proprietary pins VISIBLE and the showMasts effect can race this async
      // layer-add — so set their initial visibility explicitly, exactly like the
      // public windmills initVis above. Without this they survive a fresh load.
      setPrivateMastsVisibility(map, showMastsRef.current);

      // Individual OSM/OpenInfraMap wind turbines (black dots, MVT). Added
      // after the mast layers so the dots render on top; the turbine click
      // handler yields to mast pins where the two overlap. A click fetches
      // GET /api/turbine/:id and opens the TurbineDataTool card, mirroring the
      // mast click flow below.
      addTurbines(map, {
        isInteractionBlocked: () =>
          Boolean(aoiArmedRef.current || measureArmedRef.current),
        onSelect: async (id) => {
          setSelectedTurbine(null);
          setTurbineError(null);
          setTurbineLoading(true);
          try {
            const res = await fetch(`${API_URL}/api/turbine/${id}`, {
              credentials: "include",
            });
            if (res.status === 401 || res.status === 403) {
              setTurbineError("Your Pro session ended — please sign in again.");
              return;
            }
            if (res.status === 429) {
              setTurbineError("Slow down a bit — too many requests.");
              return;
            }
            if (!res.ok) {
              setTurbineError(`Lookup failed (${res.status})`);
              return;
            }
            setSelectedTurbine((await res.json()) as Turbine);
          } catch {
            setTurbineError("Network error");
          } finally {
            setTurbineLoading(false);
          }
        },
      });
      initVis(TURBINES_LAYER_ID, showTurbinesRef.current);
      initVis(TURBINES_HIT_LAYER_ID, showTurbinesRef.current);

      // Legal exclusion-zone fills (red/amber polygons, MVT). Inserted BELOW the
      // mast pins so masts/turbines stay clickable on top. Off by default.
      addExclusions(map, {
        isInteractionBlocked: () =>
          Boolean(aoiArmedRef.current || measureArmedRef.current),
        beforeId: "windmills-pts",
      });
      initVis(EXCL_FILL_LAYER_ID, showExclusionsRef.current);
      initVis(EXCL_OUTLINE_LAYER_ID, showExclusionsRef.current);

      // Policy-score + offshore are the only two whole-GeoJSON layers here and
      // both are OFF by default, yet they each fetched their data eagerly at
      // load (~57 KB + 2 requests), competing with first paint. Defer both to
      // map idle. They are added LAST (after every other layer), so deferring
      // keeps their z-order (just below the pins) unchanged. Reading the toggle
      // refs at idle-time also means they honour the very latest toggle state.
      map.once("idle", () => {
        // Policy-score choropleth (state polygons by composite attractiveness).
        // Async (fetches GeoJSON) — applies its own initial visibility. Below pins.
        void addPolicyScore(map, {
          beforeId: "windmills-pts",
          visible: showPolicyScoreRef.current,
        });

        // Offshore-wind reference layer — indicative zones + VGF/LiDAR pins, from
        // /api/offshore-wind. Async (fetches GeoJSON) — applies its own initial
        // visibility and feeds the Offshore-wind tool panel (zones/projects/policy)
        // via onData, so the panel works even with the layer toggled off. Below
        // the pins; a zone/project click jumps the left card to the Offshore tool.
        addOffshoreWind(map, {
          isInteractionBlocked: () =>
            Boolean(aoiArmedRef.current || measureArmedRef.current),
          onData: (d) => {
            setOffshoreData(d);
            setOffshoreError(null);
            setOffshoreLoading(false);
            // Layers exist now — apply the LATEST toggle state (the visibility
            // effect ran while the async add was in flight and no-op'd). This is
            // the single source of truth for the offshore layer's initial state.
            setOffshoreWindVisibility(map, showOffshoreRef.current);
          },
          onError: (msg) => {
            setOffshoreError(msg);
            setOffshoreLoading(false);
          },
          onSelectZone: (zone) => {
            setSelectedOffshoreProject(null);
            setSelectedOffshoreZone(zone);
            setActiveTool("offshore");
            setSidebarOpen(true);
          },
          onSelectProject: (project) => {
            setSelectedOffshoreZone(null);
            setSelectedOffshoreProject(project);
            setActiveTool("offshore");
            setSidebarOpen(true);
          },
        });
      });

      map.on("click", "windmills-hit", async (e: MapMouseEvent) => {
        // Armed tools head the click-priority chain: while the user is
        // drawing an AOI or measuring, mast popups must not fire (a measure
        // click on a mast snaps to it instead).
        if (aoiArmedRef.current || measureArmedRef.current) return;
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

  // Left DATA bar: mast detail + site-analysis results. Tools live on the
  // right; everything that *renders data* stays here.
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
      id: "turbines",
      label: "Turbine data",
      Icon: TurbineIcon,
      badge: selectedTurbine != null,
      content: (
        <TurbineDataTool
          selected={selectedTurbine}
          loading={turbineLoading}
          error={turbineError}
        />
      ),
    },
    {
      id: "analysis",
      label: "Site analysis",
      Icon: AnalyzeIcon,
      badge: aoi.analysis != null,
      content: (
        <AnalyzeTool
          section="results"
          uiState={aoi.uiState}
          armedMode={aoi.armedMode}
          liveAreaKm2={aoi.liveAreaKm2}
          liveOverCap={aoi.liveOverCap}
          committedAreaKm2={aoi.committedAreaKm2}
          analysis={aoi.analysis}
          committedRing={aoi.committedRing}
          error={aoi.error}
          onArm={armAoi}
          onClear={aoi.clearAll}
        />
      ),
    },
    {
      id: "offshore",
      label: "Offshore wind",
      Icon: OffshoreIcon,
      badge: selectedOffshoreZone != null || selectedOffshoreProject != null,
      content: (
        <OffshoreWindTool
          data={offshoreData}
          selectedZone={selectedOffshoreZone}
          selectedProject={selectedOffshoreProject}
          loading={offshoreLoading}
          error={offshoreError}
        />
      ),
    },
  ];

  // Right TOOLS bar: ONE panel stacking all the tools one below the other —
  // site-screening draw controls, wind-resource layer controls (moved in from
  // the old floating bottom-right card), then the dataset visibility toggles.
  const rightTools: ProTool[] = [
    {
      id: "tools",
      label: "Map tools",
      Icon: ToolsIcon,
      badge: windMetric !== "off" || terrain.enabled || terrain.tintEnabled,
      content: (
        <div className="divide-y divide-slate-700/70">
          <AnalyzeTool
            section="controls"
            uiState={aoi.uiState}
            armedMode={aoi.armedMode}
            liveAreaKm2={aoi.liveAreaKm2}
            liveOverCap={aoi.liveOverCap}
            committedAreaKm2={aoi.committedAreaKm2}
            analysis={aoi.analysis}
            error={aoi.error}
            onArm={armAoi}
            onClear={aoi.clearAll}
            onUploadFile={uploadAoiFile}
          />
          <MeasureTool
            phase={measure.phase}
            pointA={measure.pointA}
            pointB={measure.pointB}
            liveDistanceKm={measure.liveDistanceKm}
            distanceKm={measure.distanceKm}
            onToggle={toggleMeasure}
            onClear={measure.clear}
          />
          <section>
            <SectionLabel icon={<WindIcon className="h-3.5 w-3.5" />}>
              Wind resource
            </SectionLabel>
            <WindResourceCard
              embedded
              metric={windMetric}
              height={windHeight}
              value={readout?.resource?.value}
              opacity={windOpacity}
              onMetricChange={handleWindMetricChange}
              onHeightChange={setWindHeight}
              onOpacityChange={setWindOpacity}
            />
          </section>
          <section>
            <SectionLabel icon={<TerrainIcon className="h-3.5 w-3.5" />}>
              Terrain (3D)
            </SectionLabel>
            <TerrainTool
              enabled={terrain.enabled}
              exaggeration={terrain.exaggeration}
              tintEnabled={terrain.tintEnabled}
              tintOpacity={terrain.tintOpacity}
              onToggle3D={terrain.setEnabled}
              onExaggerationChange={terrain.setExaggeration}
              onToggleTint={terrain.setTintEnabled}
              onTintOpacityChange={terrain.setTintOpacity}
            />
          </section>
          <section>
            <SectionLabel icon={<LayersIcon className="h-3.5 w-3.5" />}>
              Layers
            </SectionLabel>
            <LayersTool
              showTurbines={showTurbines}
              showMasts={showMasts}
              showPowerGrid={showPowerGrid}
              showExclusions={showExclusions}
              showPolicyScore={showPolicyScore}
              showOffshore={showOffshore}
              mastCats={mastCats}
              voltageBands={voltageBands}
              onToggleTurbines={setShowTurbines}
              onToggleMasts={setShowMasts}
              onTogglePowerGrid={setShowPowerGrid}
              onToggleExclusions={setShowExclusions}
              onTogglePolicyScore={setShowPolicyScore}
              onToggleOffshore={setShowOffshore}
              onMastCatChange={(cat, next) =>
                setMastCats((prev) => ({ ...prev, [cat]: next }))
              }
              onVoltageBandChange={(kv, next) =>
                setVoltageBands((prev) => ({ ...prev, [kv]: next }))
              }
            />
          </section>
        </div>
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

      {/* Top-centre place search — flies the map to a chosen place. Sits
          between the left/right tool cards and clears the top-right nav
          control; only meaningful (and only mounted) for Pro users. */}
      {isPro && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
          <PlaceSearch mapRef={mapRef} />
        </div>
      )}

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

      {/* Top-left mast colour key — only meaningful while the Masts layer is on.
          Offset clears the left sidebar (≈320px open · ≈60px collapsed rail). */}
      {isPro && showMasts && <MastLegend offsetLeft={sidebarOpen ? 344 : 72} />}

      {/* Ranked best→worst policy-attractiveness key (top-right) — only with the layer on. */}
      {isPro && showPolicyScore && <PolicyScoreLegend />}

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
            tools={rightTools}
            activeId="tools"
            open={rightOpen}
            onActiveChange={() => {}}
            onOpenChange={setRightOpen}
          />
        </>
      )}
    </div>
  );
}

/** Mono section heading inside the stacked Map-tools panel — matches the
 *  "SITE SCREENING" status-rail typography of the Analyze section above it. */
function SectionLabel({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 px-4 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
      {icon}
      {children}
    </p>
  );
}

/** NIWE mast point colour — mirrors the "windmills-pts" map layer + LayersTool. */
const NIWE_MAST_COLOR = "#1d9bf0";

/** Compact top-left colour key for the two mast datasets. `offsetLeft` keeps it
 *  clear of the left sidebar, which changes width when opened/collapsed. */
function MastLegend({ offsetLeft }: { offsetLeft: number }) {
  return (
    <div
      className="pointer-events-none absolute top-3 z-10 flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-2 text-[11px] text-slate-200 shadow-lg backdrop-blur transition-[left] duration-200"
      style={{ left: offsetLeft }}
    >
      <LegendRow color={NIWE_MAST_COLOR} label="NIWE masts" />
      <LegendRow color={PRIVATE_MAST_COLOR} label="Private masts" />
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/10"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
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
