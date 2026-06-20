# 3D Terrain for the Pro Map — Research & Integration Plan

**Scope:** Add real 3D elevation (tilt-able terrain with accurate DEM data) to the Pro map at `apps/web/app/(portal)/geospatial/pro-map/page.tsx`. India-only coverage. MapLibre GL JS v5.24.0.

**Status:** Research + plan. No code changed yet.

---

## TL;DR

1. **Rendering is already solved by your stack.** MapLibre v5 has native 3D terrain — a `raster-dem` source + `map.setTerrain({ source, exaggeration })` + a `hillshade` layer + `setSky()`. No new renderer, no deck.gl/Cesium/three.js. This is a ~1 hook + ~1 toggle change in your existing `components/Map/` architecture.

2. **The real question is the elevation data**, and your current SRTM-based readout grid is the *weakest* of the modern options. For "accurate elevation" you want **Copernicus GLO-30** (best free global 30 m DEM) and/or **ISRO CartoDEM** (best free DEM for Indian plains). Avoid **FABDEM** — it's the most accurate bare-earth model but **non-commercial license**, and your Pro map is a paid feature.

3. **Two viable paths** (you asked to see both):
   - **Path A — Hosted (Mapterhorn):** free Copernicus-30 m terrain PMTiles, terrarium-encoded, drop-in via a custom protocol. ~30 min to a working 3D map. Third-party single host = reliability/attribution caveat.
   - **Path B — Self-host on your VPS:** either (B1) clip a Mapterhorn India extract to one PMTiles file you host, or (B2) build your own terrain-RGB from CartoDEM/Copernicus with `rio-rgbify`. Fits your existing `rasterio` + `/api/tiles` proxy. More control + India accuracy edge, more setup.

4. **Recommended sequence:** prototype with **Path A**, ship production on **Path B1** (self-hosted Mapterhorn India extract — Copernicus accuracy, your hosting, no raster pipeline), and keep **B2 with CartoDEM** as a later accuracy upgrade if Indian-plains precision matters.

---

## 1. How 3D terrain works in MapLibre (the rendering side)

You're on `maplibre-gl@^5.24.0`, which has mature native terrain. Three pieces:

**a) A `raster-dem` source** — DEM tiles where elevation is encoded into RGB pixels. Two encodings exist; you set which one on the source:

| Encoding | Formula | Used by |
|---|---|---|
| `terrarium` | `elev = (R*256 + G + B/256) − 32768` | Mapzen/Joerd, **Mapterhorn**, AWS Terrain Tiles |
| `mapbox` | `elev = −10000 + (R*256*256 + G*256 + B) * 0.1` | Mapbox Terrain-RGB, `rio-rgbify` default |

**b) `map.setTerrain({ source, exaggeration })`** — turns the flat map into a displaced 3D mesh. `exaggeration: 1.0` is true-to-life; `1.3–1.6` reads better for gentle terrain (most of India's wind belts are plateaus/hills, not Himalaya, so a little exaggeration helps the relief show).

**c) A `hillshade` layer + `setSky()`** — hillshade shades slopes for depth even when looking straight down; sky/fog gives the horizon when pitched. Add `pitch` (default max 60°, raise to ~85° in v5) and `NavigationControl({ visualizePitch: true })` for the tilt gesture.

Minimal working example (this is the whole rendering side):

```js
map.addSource('terrain-dem', {
  type: 'raster-dem',
  tiles: ['https://.../{z}/{x}/{y}.png'],
  encoding: 'terrarium',     // or 'mapbox'
  tileSize: 512,
  maxzoom: 12,
});

// Hillshade for depth (draws under your data layers)
map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'terrain-dem' });

// The 3D displacement
map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });

// Atmosphere when pitched
map.setSky({
  'sky-color': '#0a0e18', 'horizon-color': '#1a2236',
  'fog-color': '#0a0e18', 'sky-horizon-blend': 0.5, 'fog-ground-blend': 0.5,
});

map.easeTo({ pitch: 60 });
```

**Bonus that ties into your existing code:** once a terrain source is set, `map.queryTerrainElevation(lngLat)` returns the *exact* DEM elevation at any point. That can replace or sharpen your current coarse `lib/elevation/india-grid.json` readout (0.5°/~55 km SRTM grid) in the `CursorReadoutBar` with true 30 m elevation — a free accuracy win that comes bundled with the 3D work.

---

## 2. The elevation data (the part that determines "accuracy")

Your map currently has **no DEM tiles at all** — the "Terrain" basemap is OpenTopoMap *raster imagery* (2D contour pictures), and the only numeric elevation is the coarse SRTM readout grid. For real 3D you need a DEM tileset. Here's the honest comparison of the free options, India-weighted:

| DEM | Native res | Accuracy (vertical) | Commercial use | India suitability | Notes |
|---|---|---|---|---|---|
| **Copernicus GLO-30** | 30 m | NMAD ~1.3 m (best radar 30 m) | ✅ Free & open | Excellent general | TanDEM-X based; modern; the default choice |
| **ISRO CartoDEM v3** | 30 m | RMSE ~2 m on Indian plains (best there) | ✅ Public domain (NDSAP)* | Best for Indian flat/plateau terrain | Bhuvan download, manual, registration |
| **NASADEM** | 30 m | Better than SRTM | ✅ Public domain | Good | Reprocessed SRTM |
| **AW3D30 (ALOS)** | 30 m | ~5 m | ✅ Free | Good | Optical stereo |
| **SRTM 30 m** | 30 m | NMAD ~3.7 m | ✅ Public domain | Dated | *What your readout grid uses now* |
| **FABDEM** | 30 m | Best bare-earth (forests/buildings removed) | ❌ **Non-commercial (CC-BY-NC-SA)** | Excellent, but **off-limits** | Pro map is paid → exclude |

\* CartoDEM is released under India's NDSAP as "public domain / free download," but the portal doesn't spell out explicit commercial-redistribution terms — **verify with NRSC/Bhuvan before shipping it in a paid product.** Copernicus has a clean, explicit open-commercial license, which is why it's the safer default.

**Bottom line on accuracy:** Copernicus GLO-30 is the best *globally consistent, clearly-commercial* choice and is what you'll get "for free" via Mapterhorn. CartoDEM can beat it specifically on Indian plains by ~half a metre RMSE, but only matters if sub-2 m vertical precision drives a real decision (e.g., micro-siting), and it costs you a manual pipeline + a license check. For a visual 3D map + readout, **Copernicus 30 m is the right call**; treat CartoDEM as an optional precision upgrade.

---

## 3. Path A — Hosted (Mapterhorn) · fastest to a working 3D map

[Mapterhorn](https://mapterhorn.com) (Protomaps-adjacent, led by ex-MapLibre coordinator Oliver Wipfli) publishes global **Copernicus GLO-30** terrain as **terrarium-encoded PMTiles**, z0–12, served free from `download.mapterhorn.com`. Integration is a custom protocol that reads byte-ranges from their PMTiles:

```ts
import { Protocol } from 'pmtiles';                 // npm i pmtiles
const protocol = new Protocol({ metadata: true });

maplibregl.addProtocol('mapterhorn', async (params, abort) => {
  const [z, x, y] = params.url.replace('mapterhorn://', '').split('/').map(Number);
  const name = z <= 12 ? 'planet' : `6-${x >> (z - 6)}-${y >> (z - 6)}`;
  const url = `pmtiles://https://download.mapterhorn.com/${name}.pmtiles/${z}/${x}/${y}.webp`;
  const res = await protocol.tile({ ...params, url }, abort);
  if (res.data === null) throw new Error(`tile ${z}/${x}/${y} missing`);
  return res;
});

// then in the style:
sources: {
  'terrain-dem': {
    type: 'raster-dem',
    tiles: ['mapterhorn://{z}/{x}/{y}'],
    encoding: 'terrarium', tileSize: 512,
    attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
  }
}
```

**Pros:** zero pipeline, free, Copernicus-30 accuracy, true 3D in ~30 min, commercial-OK data.
**Cons:** depends on a single grant-funded third-party host (no SLA); you must carry their attribution; global z-cap is 12 (≈ fine for India — there's no high-res India layer, so z12 is the DEM ceiling everywhere here anyway, and MapLibre over-samples above that). For a *prototype* this is ideal; for *production* you don't want a core Pro feature pointed at someone else's free bucket.

**AWS Terrain Tiles** (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, terrarium, no key) is the even-simpler classic fallback, but it's the older SRTM-era Mapzen/Joerd merge — *less* accurate than Mapterhorn's Copernicus and historically wobbly on long-term hosting commitments. Prefer Mapterhorn.

---

## 4. Path B — Self-host on your Hostinger VPS · production-grade

This fits what you already do: you self-host Qdrant, you proxy tiles through `/api/tiles` with `TILE_CACHE_TTL`, and your Python scripts already use `rasterio`. PMTiles is a **single file, served by static byte-range** — no tile server, no new infra.

### B1 — Self-host a Mapterhorn India extract (recommended production path)

Clip the planet to India once, host the one file yourself. Copernicus accuracy, your hosting, **no raster pipeline:**

```sh
# pmtiles CLI (go-pmtiles). bbox = min_lon,min_lat,max_lon,max_lat
pmtiles extract https://download.mapterhorn.com/planet.pmtiles india-terrain.pmtiles \
  --bbox=68,6,98,37.5
# (matches your elevation-grid bbox of lat 7–38 / lon 67–98, +Andaman/Lakshadweep margin)
```

Host `india-terrain.pmtiles` on the VPS (or behind `/api/tiles`), point the source at `pmtiles://https://yourhost/india-terrain.pmtiles`. You own uptime, you can drop the third-party attribution dependency (still credit Copernicus/Mapterhorn per their terms), and the file is a fraction of the planet. **Measure the actual extract size** after running it (order of magnitude: a few hundred MB to ~1.5 GB for z0–12 webp) — PMTiles only serves the byte-ranges requested, so file size affects storage, not per-tile latency.

### B2 — Build your own terrain-RGB from CartoDEM / Copernicus (max India accuracy)

Only if you want CartoDEM's Indian-plains edge or full control of the source DEM:

1. **Get the DEM.** Copernicus GLO-30 GeoTIFFs free from AWS Open Data (`s3://copernicus-dem-30m/`), OpenTopography, or Sentinel Hub. CartoDEM 30 m from Bhuvan/NRSC (manual, per-tile, registration; check commercial terms).
2. **Mosaic + clean** with GDAL (`gdalbuildvrt` / `gdal_calc.py` to fix nodata seams).
3. **Encode to terrain-RGB** with [`rio-rgbify`](https://github.com/mapbox/rio-rgbify): for terrarium use `-b 32768 -i 0.00390625` (=1/256); for mapbox encoding use defaults (`-b -10000 -i 0.1`). Output MBTiles. (See `nst-guide/terrain` for a worked Copernicus→tiles pipeline.)
4. **Convert to PMTiles:** `pmtiles convert india.mbtiles india-terrain.pmtiles`.
5. **Serve** as in B1; set `encoding` on the MapLibre source to match what you generated.

**Pros:** full source/version control, CartoDEM accuracy option, no external runtime dependency.
**Cons:** real GDAL/rasterio work, a few GB of intermediate data, you own the licensing diligence.

> **Middle-ground recommendation:** B1 gives you ~90% of B2's benefit (your hosting, your file, Copernicus accuracy) for ~10% of the effort. Start there. Reach for B2 only if a concrete decision needs CartoDEM-grade vertical precision.

---

## 5. Integration into *your* architecture

The main map (`components/Map/`) and the Pro map (`pro-map/page.tsx`) both create a raw `maplibregl.Map`. Since 3D is a Pro feature, wire it into the **Pro map** first.

**New files / changes:**

- **`components/Map/hooks/useTerrain.ts`** — new hook mirroring your existing hook style (`useWindLayer`, `useStateBoundaries`). Responsibilities: register the `pmtiles` protocol once, add the `raster-dem` source + `hillshade` layer, `setTerrain`/`setSky`, and expose `enable()/disable()` + an `exaggeration` setter. Re-install on `style.load` (you already have this pattern in `MapCanvas`'s `applyMode`).
- **`pmtiles` dependency** — `npm i pmtiles` in `apps/web` (you don't have it yet; you already use PMTiles-style serving conceptually via `/api/tiles`).
- **A "3D" control on the Pro map** — the Pro map uses `BasemapToggle` (`ProBasemap = "road" | "satellite"`). Terrain is *orthogonal* to basemap (it drapes whatever's underneath), so add a **separate 3D toggle + exaggeration slider**, not a new basemap. Reuse your `ProSidebar`/`LayersTool` panel styling.
- **Naming:** your main map already has a 2D "Terrain" basemap (OpenTopoMap). Call the new one **"3D"** / **"3D Terrain"** so the two don't get conflated in the UI.
- **Readout upgrade (optional, high value):** swap `lookupElevation()` for `map.queryTerrainElevation()` in the `CursorReadoutBar` path when terrain is active → exact 30 m elevation instead of the 55 km grid interpolation.

**What you get for free:** your raster/fill overlays **drape onto the terrain automatically** — the GWA **wind-resource raster** (`addWindResourceLayer`) and state boundaries will follow the 3D surface with no extra work. That's a genuinely compelling Pro visual: wind resource painted over real topography (wind sites are terrain-driven, so this is more than eye-candy).

---

## 6. Caveats & things to test

- **DOM markers vs terrain.** Your turbine/mast pins are HTML markers and overlay layers. In pitched 3D, verify they (a) sit on the surface and (b) occlude correctly behind ridgelines. MapLibre clamps markers to terrain in recent versions, but **test it** — it's the most likely rough edge. Symbol/circle layers and `queryTerrainElevation` handle this cleanly; DOM markers are the risk.
- **Mobile GPU / perf.** Terrain mesh + hillshade is heavier than a flat raster. Test on mid-range mobile; consider defaulting 3D **off** and gating the toggle, capping `maxPitch`, and keeping `tileSize: 512`.
- **DEM zoom ceiling.** Copernicus/Mapterhorn cap at z12 (≈30 m). Zooming past that over-samples — fine visually, but don't imply sub-30 m precision in the UI.
- **Licensing diligence.** Keep Copernicus/Mapterhorn attribution. **Do not** ship FABDEM (non-commercial). Verify CartoDEM commercial terms with NRSC before B2.
- **Hosting reliability.** Don't point production at `download.mapterhorn.com` — self-host the extract (B1).
- **`/api/tiles` caching.** If you serve the PMTiles through your existing proxy, make sure it passes HTTP `Range` requests through (PMTiles needs byte-range), and set a long `TILE_CACHE_TTL` — DEM tiles are immutable.

---

## 7. Suggested rollout

1. **Prototype (½ day):** Path A (Mapterhorn protocol) + `useTerrain` hook + a 3D toggle on the Pro map. Confirm relief, hillshade, sky, pitch gesture, and that wind raster + pins behave when pitched.
2. **Productionize data (½ day):** run the B1 `pmtiles extract` for India, host the file on the VPS / behind `/api/tiles`, repoint the source. Drop the external host dependency.
3. **Readout upgrade (1–2 hr):** wire `queryTerrainElevation` into the cursor readout when 3D is active.
4. **Polish:** exaggeration slider, mobile perf pass, default-state decision, attribution string.
5. **(Optional, later):** B2 CartoDEM pipeline if Indian-plains precision becomes a real requirement.

---

## Sources

- [MapLibre GL JS — 3D Terrain example](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/)
- [MapLibre GL JS — RasterDEMTileSource API](https://maplibre.org/maplibre-gl-js/docs/API/classes/RasterDEMTileSource/)
- [MapLibre GL JS — Sky, Fog, Terrain example](https://maplibre.org/maplibre-gl-js/docs/examples/sky-fog-terrain/)
- [Mapterhorn — Terrain for Web Mapping (Protomaps blog)](https://protomaps.com/blog/mapterhorn-terrain/)
- [Building a 3D Map Application Using Mapterhorn Terrain Data (DEV / MIERUNE)](https://dev.to/mierune/building-a-3d-map-application-using-mapterhorn-terrain-data-elo)
- [Terrain Tiles — Registry of Open Data on AWS (Mapzen/Joerd, terrarium)](https://registry.opendata.aws/terrain-tiles/)
- [Vertical accuracy of free global DEMs: FABDEM, Copernicus, NASADEM, AW3D30, SRTM (Int. J. Digital Earth, 2024)](https://www.tandfonline.com/doi/full/10.1080/17538947.2024.2308734)
- [Global evaluation of radar DEMs: SRTM, NASADEM, GLO-30 (JGR Biogeosciences, 2024)](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2023JG007672)
- [Accuracy assessment of public DEMs incl. CARTOSAT/CartoDEM using DGPS (Remote Sensing, MDPI)](https://www.mdpi.com/2072-4292/14/6/1334)
- [FABDEM license (CC-BY-NC-SA) — data.bris](https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn)
- [Copernicus DEM GLO-30 — Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30)
- [CartoDEM / Cartosat-1 DEM — Bhuvan NRSC (data.gov.in)](https://www.data.gov.in/catalog/digital-elevation-model-dem-generated-cartosat-1-satellite-data-india)
- [rio-rgbify — terrain-RGB encoding](https://github.com/mapbox/rio-rgbify)
- [nst-guide/terrain — worked DEM→tiles pipeline](https://github.com/nst-guide/terrain)
- [PMTiles for MapLibre GL — Protomaps docs](https://docs.protomaps.com/pmtiles/maplibre)
- [MapTiler — Terrain RGB tiles](https://docs.maptiler.com/guides/map-tiling-hosting/data-hosting/rgb-terrain-by-maptiler/)
