"use client";

// Draws every "shown" saved site on the pro-map at once as a translucent
// emerald polygon with a dashed outline and a name label. Independent of the
// single committed AOI (AoiDrawController) — so several saved sites can be
// compared on the map simultaneously. Driven by the shown-sites map store;
// pass an empty array to clear. Mirrors useLogisticsRouteLayer's apply/idle
// pattern.

import { useEffect } from "react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { SavedSite } from "@/lib/savedSites";

const SRC = "saved-sites-overlay";
const FILL_LAYER = "saved-sites-overlay-fill";
const LINE_LAYER = "saved-sites-overlay-line";
const LABEL_LAYER = "saved-sites-overlay-label";

const COLOR = "#34d399"; // emerald — matches the "saved" theme, distinct from the sky AOI

/** Close a ring (first === last) so it's a valid GeoJSON Polygon outer ring. */
function closedRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function toFeatureCollection(sites: SavedSite[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of sites) {
    if (!Array.isArray(s.ring) || s.ring.length < 4) continue;
    features.push({
      type: "Feature",
      properties: { id: s.id, name: s.name },
      geometry: { type: "Polygon", coordinates: [closedRing(s.ring)] },
    });
  }
  return { type: "FeatureCollection", features };
}

function boundsOf(sites: SavedSite[]): [[number, number], [number, number]] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const s of sites) {
    if (!Array.isArray(s.ring)) continue;
    for (const [lon, lat] of s.ring) {
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
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
  map.addLayer({
    id: FILL_LAYER,
    type: "fill",
    source: SRC,
    paint: { "fill-color": COLOR, "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: LINE_LAYER,
    type: "line",
    source: SRC,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLOR,
      "line-width": 2,
      "line-opacity": 0.95,
      "line-dasharray": [2, 1.5],
    },
  });
  map.addLayer({
    id: LABEL_LAYER,
    type: "symbol",
    source: SRC,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      // Match the glyphs the style is known to ship (see useStateBoundaries).
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-max-width": 10,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#d1fae5",
      "text-halo-color": "#0b0f19",
      "text-halo-width": 1.4,
    },
  });
}

export function useSavedSitesLayer(
  mapRef: React.MutableRefObject<MlMap | null>,
  sites: SavedSite[],
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = toFeatureCollection(sites);
    const bounds = boundsOf(sites);
    let cancelled = false;

    const apply = () => {
      if (cancelled) return;
      const m = mapRef.current;
      if (!m) return;
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
      // Frame the shown sites (best-effort). The data panel sits on the LEFT,
      // so pad that side. Skip when nothing is shown (don't yank the camera).
      if (bounds) {
        try {
          const w = m.getContainer().clientWidth || 1200;
          const left = Math.min(420, Math.round(w * 0.4));
          m.fitBounds(bounds, {
            padding: { top: 70, bottom: 70, left, right: 80 },
            maxZoom: 10,
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
  }, [sites, mapRef]);
}
