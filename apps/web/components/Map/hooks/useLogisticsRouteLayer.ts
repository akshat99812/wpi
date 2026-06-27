"use client";

// Draws the logistics planner's computed routes on the pro-map: one orange line
// per leg (origin factory → site), an orange dot at each origin, and a sky dot
// at the destination. Clicking an origin dot opens a small card (factory name,
// company, parts shipped, distance); clicking the site dot shows the delivery
// site. Driven by `routes` (from the logisticsRouteStore); pass null to clear.

import { useEffect, useRef } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MlMap,
  type Popup,
} from "maplibre-gl";
import type { LogisticsRoutesPayload } from "@/lib/logistics";

const SRC = "logistics-routes";
const LINE_LAYER = "logistics-routes-line";
const ORIGIN_LAYER = "logistics-routes-origin";
const DEST_LAYER = "logistics-routes-dest";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function toFeatureCollection(routes: LogisticsRoutesPayload | null): GeoJSON.FeatureCollection {
  if (!routes) return EMPTY;
  const features: GeoJSON.Feature[] = [];
  const seenOrigins = new Set<string>();

  for (const leg of routes.legs) {
    if (Array.isArray(leg.geometry) && leg.geometry.length >= 2) {
      features.push({
        type: "Feature",
        properties: { kind: "route", mode: leg.routingMode },
        geometry: { type: "LineString", coordinates: leg.geometry },
      });
    }
    if (!seenOrigins.has(leg.origin.id)) {
      seenOrigins.add(leg.origin.id);
      features.push({
        type: "Feature",
        properties: { kind: "origin", originId: leg.origin.id },
        geometry: { type: "Point", coordinates: [leg.origin.lon, leg.origin.lat] },
      });
    }
  }
  features.push({
    type: "Feature",
    properties: { kind: "dest" },
    geometry: { type: "Point", coordinates: [routes.destination.lon, routes.destination.lat] },
  });
  return { type: "FeatureCollection", features };
}

// Bounding box over every coordinate in the payload: [[w,s],[e,n]] or null.
function boundsOf(
  routes: LogisticsRoutesPayload | null,
): [[number, number], [number, number]] | null {
  if (!routes) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const eat = (lon: number, lat: number) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };
  for (const leg of routes.legs) {
    for (const [lon, lat] of leg.geometry ?? []) eat(lon, lat);
    eat(leg.origin.lon, leg.origin.lat);
  }
  eat(routes.destination.lon, routes.destination.lat);
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function ensureLayers(map: MlMap, data: GeoJSON.FeatureCollection): void {
  const existing = map.getSource(SRC) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(SRC, { type: "geojson", data });
  // White casing under the orange line so it reads on any basemap.
  map.addLayer({
    id: `${LINE_LAYER}-casing`,
    type: "line",
    source: SRC,
    filter: ["==", "kind", "route"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0b0f19", "line-width": 6, "line-opacity": 0.55 },
  });
  map.addLayer({
    id: LINE_LAYER,
    type: "line",
    source: SRC,
    filter: ["==", "kind", "route"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ff8a1f", "line-width": 3.5, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: ORIGIN_LAYER,
    type: "circle",
    source: SRC,
    filter: ["==", "kind", "origin"],
    paint: {
      "circle-radius": 6,
      "circle-color": "#ff8a1f",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: DEST_LAYER,
    type: "circle",
    source: SRC,
    filter: ["==", "kind", "dest"],
    paint: {
      "circle-radius": 7,
      "circle-color": "#38bdf8",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

// ── Click card ────────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

// One-time dark styling for the logistics popup so it matches the app theme.
function ensurePopupStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("logistics-popup-style")) return;
  const el = document.createElement("style");
  el.id = "logistics-popup-style";
  el.textContent = `
.maplibregl-popup.logistics-popup .maplibregl-popup-content{background:#0b0f19;border:1px solid #27324a;border-radius:10px;padding:10px 12px;box-shadow:0 10px 28px rgba(0,0,0,.55)}
.maplibregl-popup.logistics-popup .maplibregl-popup-tip{border-top-color:#0b0f19;border-bottom-color:#0b0f19;border-left-color:#0b0f19;border-right-color:#0b0f19}
.maplibregl-popup.logistics-popup .maplibregl-popup-close-button{color:#9aa4ba;font-size:15px;padding:0 6px;right:2px}
.maplibregl-popup.logistics-popup .maplibregl-popup-close-button:hover{background:transparent;color:#e8ecf4}`;
  document.head.appendChild(el);
}

function originCardHtml(routes: LogisticsRoutesPayload, originId: string): string | null {
  const leg = routes.legs.find((l) => l.origin.id === originId);
  if (!leg) return null;
  const o = leg.origin;
  const parts = routes.shipments.filter((s) => s.originId === originId);
  const partsHtml = parts.length
    ? parts
        .map(
          (p) =>
            `<span style="display:inline-block;margin:2px 4px 0 0;padding:1px 6px;border:1px solid #27324a;border-radius:5px;font-size:10px;color:#e8ecf4">${esc(p.label)} ×${p.count}</span>`,
        )
        .join("")
    : '<span style="color:#9aa4ba">—</span>';
  const mode = leg.routingMode === "ors" ? "routed" : "estimate";
  return `<div style="font-family:Inter,system-ui,sans-serif;min-width:190px;max-width:240px">
  <div style="font-weight:600;font-size:12px;color:#e8ecf4;line-height:1.25">${esc(o.name)}</div>
  <div style="font-size:11px;color:#9aa4ba;margin-top:2px">${esc(routes.oemLabel)} · ${esc(o.city)}, ${esc(o.state)}</div>
  <div style="font-size:10px;color:#9aa4ba;margin-top:7px;text-transform:uppercase;letter-spacing:.04em">Ships from here</div>
  <div style="margin-top:2px">${partsHtml}</div>
  <div style="font-size:11px;color:#e8ecf4;margin-top:7px;border-top:1px solid #1a2540;padding-top:6px">
    <span style="color:#9aa4ba">To site:</span> ${Math.round(leg.distanceKm).toLocaleString("en-IN")} km · ${leg.durationHr.toFixed(1)} h
    <span style="color:#ff8a1f">(${mode})</span>
  </div>
</div>`;
}

function destCardHtml(routes: LogisticsRoutesPayload): string {
  const d = routes.destination;
  const where = d.name ? esc(d.name) : `${d.lat.toFixed(3)}, ${d.lon.toFixed(3)}`;
  return `<div style="font-family:Inter,system-ui,sans-serif;min-width:170px">
  <div style="font-weight:600;font-size:12px;color:#38bdf8">Delivery site</div>
  <div style="font-size:11px;color:#e8ecf4;margin-top:2px">${where}</div>
  <div style="font-size:11px;color:#9aa4ba;margin-top:4px">${esc(routes.turbineLabel)} · ${routes.legs.length} origin${routes.legs.length > 1 ? "s" : ""}</div>
</div>`;
}

export function useLogisticsRouteLayer(
  mapRef: React.MutableRefObject<MlMap | null>,
  routes: LogisticsRoutesPayload | null,
): void {
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const boundRef = useRef(false);
  const popupRef = useRef<Popup | null>(null);

  function bindInteractions(map: MlMap): void {
    if (boundRef.current) return;
    boundRef.current = true;
    ensurePopupStyle();

    const openCard = (lngLat: maplibregl.LngLat, html: string | null) => {
      if (!html) return;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({
        offset: 12,
        maxWidth: "260px",
        className: "logistics-popup",
      })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map);
    };

    map.on("click", ORIGIN_LAYER, (e) => {
      const id = e.features?.[0]?.properties?.originId as string | undefined;
      const r = routesRef.current;
      if (!id || !r) return;
      openCard(e.lngLat, originCardHtml(r, id));
    });
    map.on("click", DEST_LAYER, (e) => {
      const r = routesRef.current;
      if (!r) return;
      openCard(e.lngLat, destCardHtml(r));
    });

    for (const layer of [ORIGIN_LAYER, DEST_LAYER]) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = toFeatureCollection(routes);
    const bounds = boundsOf(routes);
    let cancelled = false;

    const apply = () => {
      if (cancelled) return;
      const m = mapRef.current;
      if (!m) return;
      // isStyleLoaded() can be transiently false (terrain/raster sources) even
      // after the one-shot 'load' has fired — retry on 'idle', which keeps
      // firing, instead of a 'load' that never comes again.
      if (!m.isStyleLoaded()) {
        m.once("idle", apply);
        return;
      }
      try {
        ensureLayers(m, data);
      } catch {
        m.once("idle", apply);
        return;
      }
      bindInteractions(m);
      // If the routes were cleared, drop any open card.
      if (!routes) popupRef.current?.remove();
      // Frame the routes (best-effort). The analysis sidebar (with the planner)
      // sits on the LEFT, so pad that side to keep routes in the visible map.
      if (bounds) {
        try {
          const w = m.getContainer().clientWidth || 1200;
          const left = Math.min(460, Math.round(w * 0.42));
          m.fitBounds(bounds, {
            padding: { top: 60, bottom: 60, left, right: 80 },
            maxZoom: 9,
            duration: 600,
          });
        } catch {
          /* framing is non-essential */
        }
      }
    };

    apply();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, mapRef]);
}
