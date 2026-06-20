# 8. Elevation color layer (hypsometric tint) · purple (low) → red (high)

**Scope addition:** a toggleable elevation-coloring layer on the Pro map — lowest terrain rendered purple, highest red, with an adjustable opacity slider and a legend. Drapes onto the 3D mesh (and works in 2D too). India-only, MapLibre GL JS v5.24.0.

---

## TL;DR

This is **native in your MapLibre version** and **reuses the `raster-dem` source you're already adding for terrain** — no new data, no pipeline, no extra tiles. MapLibre v5 ships a `color-relief` layer type (client-side hypsometric tint over DEM data). You add one layer pointed at `terrain-dem`, give it a purple→red `color-relief-color` ramp keyed on `['elevation']`, and drive `color-relief-opacity` from a slider. The legend is a CSS gradient generated from the same color array. Total new work: one small layer + a slider + a legend strip, all hanging off infrastructure Section 1 already builds.

> Requires the DEM source from §1–§4 to exist. The color layer **cannot** be added before the `raster-dem` source — it has nothing to read otherwise.

---

## 8.1 The layer (the whole rendering side)

`color-relief` is a first-class layer type in v5.24.0 — same family as `hillshade`. It does GDAL-`color-relief`-style coloring on the client. The `['elevation']` expression returns meters above sea level and is **only** valid inside `color-relief-color`.

```ts
map.addLayer(
  {
    id: 'elevation-tint',
    type: 'color-relief',
    source: 'terrain-dem',                 // SAME source as terrain + hillshade
    paint: {
      'color-relief-color': buildElevationRamp(0, 3000),  // see 8.2
      'color-relief-opacity': 0.7,
    },
  },
  'hillshade'                              // insert BELOW hillshade so relief shading sits on top of the tint
);
```

Layer ordering matters (see §8.5). Inserting **below** the `hillshade` layer means the slope-shading darkens the elevation tint → reads like a proper relief map instead of flat color.

---

## 8.2 The ramp · purple → red

A 7-stop spectral ramp (purple → blue → cyan → green → yellow → orange → red). Parametrized so you can set the elevation band — see the India caveat in §8.4.

```ts
// purple (low) → red (high)
const RAMP: [number, number, number][] = [
  [75, 0, 130],    // indigo / purple  — lowest
  [0, 60, 200],    // blue
  [0, 160, 200],   // cyan
  [0, 160, 60],    // green
  [225, 210, 0],   // yellow
  [240, 130, 0],   // orange
  [200, 0, 0],     // red              — highest
];

// builds a MapLibre interpolate expression spread across [minElev, maxElev]
function buildElevationRamp(minElev: number, maxElev: number): any {
  const expr: any[] = ['interpolate', ['linear'], ['elevation']];
  RAMP.forEach(([r, g, b], i) => {
    const t = i / (RAMP.length - 1);
    expr.push(minElev + t * (maxElev - minElev), `rgb(${r}, ${g}, ${b})`);
  });
  return expr;
}
```

Out-of-range elevations clamp to the nearest endpoint (anything below `minElev` → purple, above `maxElev` → red), which is exactly what you want for "lowest = purple, highest = red."

---

## 8.3 Opacity control

`color-relief-opacity` is a 0–1, transitionable paint property → a slider that feels smooth for free:

```ts
// from the slider's onChange (0..1)
map.setPaintProperty('elevation-tint', 'color-relief-opacity', value);
```

Because it blends, the slider doubles as a "mix elevation tint with whatever's underneath" control — useful for layering it against the GWA wind-resource raster (§8.5).

---

## 8.4 The legend

The legend is generated from the **same `RAMP` array**, so it can never drift from the layer. A vertical bar, red/high on top, purple/low at bottom, labeled with the current `[minElev, maxElev]`:

```ts
// CSS gradient string — note: bottom→top, so reverse for the "to top" direction
const gradientCss =
  `linear-gradient(to top, ${RAMP.map(([r, g, b]) => `rgb(${r},${g},${b})`).join(', ')})`;
// labels: maxElev at top, midpoint, minElev at bottom (e.g. "3000 m" / "1500 m" / "0 m")
```

Render it as a thin strip in the corner of the Pro map, styled with your `ProSidebar`/`LayersTool` tokens. Show it only when `elevation-tint` is enabled.

---

## 8.4b India elevation range (the one real decision)

India's wind belts are mostly **0–1500 m** plateaus/hills (Deccan, Aravallis, Western/Eastern Ghats), with the Himalaya spiking to 8000 m+ in the far north. A naive linear `0 → 8000` ramp paints almost all the interesting terrain a near-uniform purple/blue — useless.

Pick one:

- **Fixed band (recommended default):** `buildElevationRamp(0, 3000)` covers the Ghats, Aravallis, and the full Deccan with real color separation; the Himalaya saturates to red, which is fine. Cheap, predictable, good legend.
- **Auto-stretch to viewport:** sample `map.queryTerrainElevation()` across the visible bounds, take min/max, rebuild the ramp on `moveend`. "True" hypsometric — every view uses the full color range — but more code and a touch janky on fast pans. Defer to a later pass.

Start fixed at `0–3000`. Expose min/max later if a use case needs it (the ramp rebuild is one `setPaintProperty('elevation-tint', 'color-relief-color', buildElevationRamp(min, max))` call).

---

## 8.5 Integration into your architecture

Threads into the §5 plan:

- **Fold into `useTerrain.ts`, or add `useColorRelief.ts`** next to it (same hook style as `useWindLayer`). It needs the DEM source to exist first, so gate it on terrain being initialized and re-add on `style.load` like everything else in `applyMode`.
- **Controls:** elevation tint is *orthogonal to basemap* and *orthogonal to 3D* (it works flat too) — so it's its **own toggle + opacity slider + legend**, grouped with the 3D toggle in the Pro panel, not a basemap option. Three small controls: `[ ] Elevation` toggle, opacity slider (0–1), legend strip.
- **Layer order (important):** `basemap → elevation-tint → hillshade → wind-resource raster → boundaries/WCE/grid → markers`. Two notes:
  - Keep `elevation-tint` **under `hillshade`** so relief shading lands on top of the color.
  - The **GWA wind-resource raster** competes for the same "surface paint" slot. They can coexist via opacity (elevation tint at ~0.5 under a semi-transparent wind raster), or you treat them as mutually exclusive surface layers in the UI. The opacity slider is what makes coexistence workable — decide the default in polish.
- **3D payoff:** like the wind raster, the tint **drapes onto the terrain mesh automatically**. Elevation-colored relief + hillshade pitched in 3D is a strong Pro visual on its own, and stacks with the wind-over-topography story.

---

## 8.6 Caveats

- **DEM source is a hard dependency.** No `raster-dem` source = nothing to color. Order the hook after terrain init.
- **Range choice drives readability**, not the renderer (see §8.4b). Wrong band = flat-looking map.
- **z12 ceiling still applies.** Same Copernicus/Mapterhorn ~30 m cap as terrain — color is interpolated above z12, don't imply sub-30 m precision.
- **Perf is cheap.** Same source as terrain/hillshade, GPU-side coloring — adds little over what §1 already costs. Still worth a mid-range mobile check with 3D + hillshade + tint all on.
- **Encoding must match the source.** The ramp keys on real meters via `['elevation']`, so it's encoding-agnostic *as long as* the source's `encoding` (`terrarium` vs `mapbox`) is set correctly per §1 — get that wrong and elevations (and thus colors) are garbage.

---

## 8.7 Rollout (slots into §7)

- **§7 step 1 (prototype):** after the 3D toggle works, add `elevation-tint` over the same DEM source, fixed `0–3000` ramp, hard-coded 0.7 opacity. Confirm purple→red reads correctly and drapes in 3D.
- **§7 step 4 (polish):** opacity slider, legend strip, the elevation-tint-vs-wind-raster default decision, and (optional) auto-stretch range.

---

## Sources (add to §Sources)

- [MapLibre GL JS — Add a color relief layer (example, v5.24.0)](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/)
- [MapLibre Style Spec — Layers (`color-relief`, `color-relief-color`, `color-relief-opacity`)](https://maplibre.org/maplibre-style-spec/layers/)
- [MapLibre Style Spec — Expressions (`['elevation']`, color-relief-color only)](https://maplibre.org/maplibre-style-spec/expressions/)
- [MapLibre design proposal — Hypsometric Tint (`color-relief`)](https://github.com/maplibre/maplibre-style-spec/issues/1067)
