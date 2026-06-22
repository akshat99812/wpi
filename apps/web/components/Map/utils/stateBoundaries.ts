import type maplibregl from 'maplibre-gl';
import { INDIA_GEOJSON_URL, INDIA_GEOJSON_FALLBACK_URL } from '../constants';

/**
 * India state-boundary overlay for the Pro map.
 *
 * Draws boundary lines that read on BOTH basemaps — a dark casing carries the
 * line on the colourful "liberty" road map, a light core line reads on the
 * dark satellite imagery. The layers sit above both basemaps but below the
 * windmill pins (via `beforeId`).
 */

const SOURCE_ID = 'pro-states';
const CASING_ID = 'pro-state-casing';
const LINE_ID = 'pro-state-line';

/** Show/hide both boundary layers (casing + core line). Idempotent — safe to
 *  call before the layers exist (skips any that aren't added yet). */
export function setStateBoundariesVisibility(
  map: maplibregl.Map,
  visible: boolean,
): void {
  try {
    for (const id of [CASING_ID, LINE_ID]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  } catch (err) {
    console.error('[pro-map] could not set state-boundary visibility', err);
  }
}

// Cache the GeoJSON across remounts so we don't refetch the ~1 MB file.
let cached: GeoJSON.FeatureCollection | null = null;

async function fetchFirstWorking(
  urls: string[],
): Promise<GeoJSON.FeatureCollection | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as GeoJSON.FeatureCollection;
      if (data?.features?.length) return data;
    } catch {
      // try next source
    }
  }
  return null;
}

export async function addLightStateBoundaries(
  map: maplibregl.Map,
  opts: { beforeId?: string } = {},
): Promise<void> {
  const data =
    cached ?? (await fetchFirstWorking([INDIA_GEOJSON_URL, INDIA_GEOJSON_FALLBACK_URL]));
  if (!data) {
    console.error('[pro-map] failed to load India state boundaries');
    return;
  }
  cached = data;

  try {
    // The map may have been torn down (unmount/restyle) while the fetch was
    // in flight — bail rather than throw on a dead style.
    if (!map.getCanvas()) return;

    // Only place below the pins if that layer actually exists yet.
    const before = opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data });
    }

    // Dark casing — strengthened so the boundary reads on the colourful road
    // basemap.
    if (!map.getLayer(CASING_ID)) {
      map.addLayer(
        {
          id: CASING_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': 'rgba(18,24,38,0.6)',
            'line-width': 2,
            'line-blur': 0.2,
          },
        },
        before,
      );
    }

    // Light core line on top — reads on the dark satellite imagery.
    if (!map.getLayer(LINE_ID)) {
      map.addLayer(
        {
          id: LINE_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': 'rgba(255,255,255,0.85)',
            'line-width': 0.9,
          },
        },
        before,
      );
    }
  } catch (err) {
    console.error('[pro-map] could not add state boundaries', err);
  }
}
