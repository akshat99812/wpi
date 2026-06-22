/**
 * Shared banding helpers for the wind-resource colour scale.
 *
 * The map raster is baked into DISCRETE colour bands (one flat colour per
 * `bands`-th of each metric's value domain) by scripts/build_wind_atlas.py.
 * The legends must step at exactly the same boundaries, so both WindScale (main
 * map, speed only) and WindResourceCard (pro map, metadata-driven) derive their
 * gradient + cursor colour from these helpers — there is no second source of
 * truth for where the colour changes.
 *
 * A "norm stop" is a palette anchor at a normalised offset (0..1) along the
 * domain; the band colour is the palette interpolated at the band's CENTRE,
 * which is exactly what the Python bake samples.
 */

export type NormStop = [number, [number, number, number]];

/** Interpolate the anchor palette at a normalised position (0..1). */
export function colorAtFrac(stops: NormStop[], frac: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, frac));
  for (let k = 0; k < stops.length - 1; k++) {
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    if (t >= t0 && t <= t1) {
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/** Index of the band a normalised value falls into (0..bands-1). */
export function bandIndex(frac: number, bands: number): number {
  const t = Math.min(1, Math.max(0, frac));
  return Math.min(bands - 1, Math.floor(t * bands));
}

/** Flat colour of the band containing `frac`, as a CSS `rgb(...)` string. */
export function bandedColorAt(stops: NormStop[], frac: number, bands: number): string {
  const b = bandIndex(frac, bands);
  const [r, g, bl] = colorAtFrac(stops, (b + 0.5) / bands);
  return `rgb(${r},${g},${bl})`;
}

/**
 * Hard-stepped CSS `linear-gradient` body (the part inside the parens): each
 * band is a flat colour held across its full width, so the colour visibly
 * changes at every band boundary instead of blending.
 */
export function steppedGradientStops(stops: NormStop[], bands: number): string {
  const out: string[] = [];
  for (let b = 0; b < bands; b++) {
    const [r, g, bl] = colorAtFrac(stops, (b + 0.5) / bands);
    const c = `rgb(${r},${g},${bl})`;
    const lo = ((b / bands) * 100).toFixed(3);
    const hi = (((b + 1) / bands) * 100).toFixed(3);
    out.push(`${c} ${lo}%`, `${c} ${hi}%`);
  }
  return out.join(',');
}

/** Parse `#rrggbb` to an [r,g,b] triple. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Convert a metadata `ramp` (value/color over [lo,hi]) to normalised stops. */
export function rampToNormStops(
  ramp: { value: number; color: string }[],
  lo: number,
  hi: number,
): NormStop[] {
  const span = hi - lo || 1;
  return ramp.map((s) => [(s.value - lo) / span, hexToRgb(s.color)] as NormStop);
}
