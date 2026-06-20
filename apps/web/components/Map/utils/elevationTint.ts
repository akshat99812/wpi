import type { Map as MlMap } from 'maplibre-gl';
import {
  DEM_SOURCE_ID,
  HILLSHADE_LAYER_ID,
  ensureDemSource,
  overlayAnchor,
} from './demShared';

/**
 * Hypsometric elevation tint for the Pro map — a native MapLibre v5
 * `color-relief` layer that colours the shared DEM source purple (low) → red
 * (high). Reuses the SAME `raster-dem` source as the 3D terrain (demShared.ts):
 * no new data, no pipeline (elevation.md §8).
 *
 * The `['elevation']` expression (valid only inside `color-relief-color`)
 * returns metres above sea level, so the ramp is encoding-agnostic as long as
 * the source's `encoding` is set correctly — which demShared.ts guarantees.
 */

export const ELEVATION_TINT_LAYER_ID = 'elevation-tint';

// India's terrain is overwhelmingly low: the Indo-Gangetic plain, coasts, and
// most of the Deccan sit under ~900 m, with only the Ghats and Himalaya above.
// A LINEAR 0–3000 band therefore crushed ~90% of the country into the bottom
// fifth of the spectrum (all purple/blue) — no visible low/high separation.
//
// Instead we map colour to NON-LINEAR, India-tuned elevation breakpoints that
// give most of the spectrum to the 0–1500 m band where the country's area
// actually lives. Plains, plateau, hills, and mountains each get a distinct
// hue; anything above the top stop clamps to red (the Himalaya).
export const DEFAULT_TINT_OPACITY = 0.7;

// (elevation in metres ASL, [r, g, b]) — purple (low) → red (high).
export const ELEVATION_STOPS: ReadonlyArray<
  readonly [number, readonly [number, number, number]]
> = [
  [0, [60, 0, 110]], // deep purple — sea level / coast
  [150, [40, 70, 200]], // blue — Indo-Gangetic & coastal plains
  [350, [0, 150, 210]], // cyan — low plateau / river basins
  [600, [30, 170, 70]], // green — Deccan plateau
  [900, [225, 205, 0]], // yellow — high Deccan / low hills
  [1400, [240, 120, 0]], // orange — Ghats / Aravalli ranges
  [2200, [200, 0, 0]], // red — high mountains (Himalaya clamps here)
];

/** Lowest / highest stop elevations — used by the legend. */
export const DEFAULT_ELEV_MIN = ELEVATION_STOPS[0][0];
export const DEFAULT_ELEV_MAX = ELEVATION_STOPS[ELEVATION_STOPS.length - 1][0];

const rgb = ([r, g, b]: readonly [number, number, number]): string =>
  `rgb(${r}, ${g}, ${b})`;

const clampOpacity = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * A MapLibre `interpolate` expression keying colour on real metres ASL via the
 * India-tuned `ELEVATION_STOPS`. Out-of-range elevations clamp to the nearest
 * endpoint (below 0 → purple, above the top stop → red).
 */
export function buildElevationRamp(): unknown {
  const expr: unknown[] = ['interpolate', ['linear'], ['elevation']];
  ELEVATION_STOPS.forEach(([elev, color]) => expr.push(elev, rgb(color)));
  return expr;
}

/**
 * Vertical CSS gradient for the legend strip (low at bottom → high at top),
 * built from the SAME stops so the legend can never drift from the layer. Each
 * colour is positioned at its elevation fraction so the gradient is non-linear
 * exactly like the layer — the plains band gets the visible space it deserves.
 */
export function elevationGradientCss(): string {
  const max = DEFAULT_ELEV_MAX || 1;
  const stops = ELEVATION_STOPS.map(
    ([elev, color]) => `${rgb(color)} ${((elev / max) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

/**
 * Add (or refresh) the elevation tint. Inserts the `color-relief` layer BELOW
 * the hillshade if present (so relief shading lands on top of the colour), else
 * below the overlay anchor. Ensures the DEM source first — the tint works in 2D
 * too, independent of whether 3D terrain is on.
 */
export function addElevationTint(
  map: MlMap,
  opts: { opacity?: number } = {},
): void {
  try {
    if (!map.getCanvas() || !map.isStyleLoaded()) return;
    if (!ensureDemSource(map)) return;

    const opacity = clampOpacity(opts.opacity ?? DEFAULT_TINT_OPACITY);
    const ramp = buildElevationRamp();

    if (map.getLayer(ELEVATION_TINT_LAYER_ID)) {
      // Already present (e.g. a band/opacity change) — refresh paint in place.
      map.setPaintProperty(ELEVATION_TINT_LAYER_ID, 'color-relief-color', ramp as never);
      map.setPaintProperty(ELEVATION_TINT_LAYER_ID, 'color-relief-opacity', opacity);
      return;
    }

    const beforeId = map.getLayer(HILLSHADE_LAYER_ID)
      ? HILLSHADE_LAYER_ID
      : overlayAnchor(map);

    map.addLayer(
      {
        id: ELEVATION_TINT_LAYER_ID,
        type: 'color-relief',
        source: DEM_SOURCE_ID,
        paint: {
          'color-relief-color': ramp as never,
          'color-relief-opacity': opacity,
        },
      },
      beforeId,
    );
  } catch (err) {
    console.error('[elevation-tint] could not add layer', err);
  }
}

/** Remove the elevation tint (idempotent). Leaves the shared DEM source. */
export function removeElevationTint(map: MlMap): void {
  try {
    if (map.getLayer(ELEVATION_TINT_LAYER_ID)) {
      map.removeLayer(ELEVATION_TINT_LAYER_ID);
    }
  } catch (err) {
    console.error('[elevation-tint] could not remove layer', err);
  }
}

/** Live-update the tint opacity (0–1; no-op when the layer isn't on). */
export function setElevationTintOpacity(map: MlMap, value: number): void {
  try {
    if (map.getLayer(ELEVATION_TINT_LAYER_ID)) {
      map.setPaintProperty(
        ELEVATION_TINT_LAYER_ID,
        'color-relief-opacity',
        clampOpacity(value),
      );
    }
  } catch (err) {
    console.error('[elevation-tint] could not set opacity', err);
  }
}
