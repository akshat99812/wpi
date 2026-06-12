# Phase 0 Verification Record — Wind Site Analysis v10

> Gate artifact required by plan.md §4 Phase 0. Every Phase 1+ implementation
> decision that depends on an external data source is pinned here, with the
> probe that verified it. Probes live in `apps/api/scripts/probes/` and are
> re-runnable. Verified 2026-06-11.

Reference points used throughout:

| Point | Lat | Lon | Role |
|---|---|---|---|
| Muppandal (Aralvaimozhi gap) | 8.26 N | 77.55 E | high-wind golden site |
| Bhadla (Rajasthan) | 27.53 N | 71.92 E | low-wind golden site |

---

## 1. GWA TiTiler layers (probe: `gwa_layers.py`)

Source: `https://tiles-stag.ramtt.xyz/titiler/gwa4/{layer}/tiles/{z}/{x}/{y}.tif`
— raw float32 GeoTIFF XYZ tiles, EPSG:3857, the same tiler the GWA website
uses and the same one `build_wind_atlas.py` already bakes from. Full layer
enum extracted from `https://tiles-stag.ramtt.xyz/openapi.json`.

### Layer names, units, maxzoom (all verified live)

| Layer | dtype | maxzoom | Units (empirical) |
|---|---|---|---|
| `cf_iec3` | float32 | 10 | capacity factor, **fraction 0–1** |
| `cf_iec2` | float32 | 10 | capacity factor, fraction 0–1 |
| `ws_mean_hgt50m` / `100m` / `150m` | float32 | 10 | m/s |
| `pd_mean_hgt100m` | float32 | 10 | W/m² |
| `rix` | float32 | 10 | ruggedness index, fraction — **masked: nodata over flat terrain** |
| `elevation` | float32 | 12 | m ASL |

No Weibull layers on any tiler mount (see §2). No air-density layer
(`air_density`, `rho` → 422) → **plan §2.4 barometric formula stands**:
ρ = 1.225·(1 − 2.2558e-5·h)^5.256 with h from the `elevation` layer.

### Sampled values (exact z10 pixel at the point)

| Layer | Muppandal | Bhadla |
|---|---|---|
| `cf_iec3` | **0.67233** | 0.31421 |
| `cf_iec2` | 0.61432 | 0.26488 |
| `ws_mean_hgt50m` | 7.8598 | 5.0806 |
| `ws_mean_hgt100m` | 9.4894 | 6.0240 |
| `ws_mean_hgt150m` | 10.4353 | 6.7956 |
| `pd_mean_hgt100m` | 697.38 | 206.92 |
| `rix` | nodata (flat) | nodata (flat) |
| `elevation` | 91.07 | 181.43 |

- **Golden-test band (Muppandal `cf_iec3`): 0.632–0.712** (exact pixel
  0.67233 ± 0.04 absolute, fraction units). The 0.25–0.35 band the plan warns
  about was indeed an IEC-II-flavored guess — actual IEC-III at Muppandal is
  ~0.67. Golden tests must assert on the **AOI mean at ANALYSIS_ZOOM**, not
  exact pixels vs the repo's coarse 0.1° grid (z6-resampled; differs by up to
  ~0.8 m/s in the sharp corridor gradient — verified explainable, not a bug).
- `cf_iec3 > cf_iec2` at both points (IEC-III low-wind rotors) — plan §2.1
  ordering (III primary, II secondary) confirmed sensible. Both returned.
- Shear α at Muppandal from 50/100/150 ln-ratio least squares: **0.2595**
  (plausible inland-terrain value; method verified).
- `rix` nodata semantics: the layer is masked to rugged areas only (global
  stats min 0.10; value 0.1536 verified at Munnar 10.0889 N, 77.0595 E).
  **Treat NaN as "flat / RIX≈0", never as missing data**, or terrain scoring
  breaks across most of India.
- `cf_iec3` global stats show slightly negative min (−0.0074, resampling
  artifact) → **clamp CF ≥ 0** in the pipeline.

## 2. Weibull A and k (probe: `weibull_hunt.py`)

**Decision: plan §2.2 is implementable exactly as written — GWA combined
Weibull A and k @100 m — but the delivery path is GWA's official country
COGs, not the TiTiler** (no tiler mount carries Weibull; NEWA `micro_ltm`
has `a_tot`/`k_tot` but bounds verified Europe-only).

- Endpoints: `https://globalwindatlas.info/api/gis/country/IND/combined-Weibull-A/100`
  and `.../combined-Weibull-k/100` → 302 → CloudFront COGs
  (`gwa.cdn.nazkamapps.com/country_tifs_v4/IND_combined-Weibull-{A,k}_100m.tif`).
- A: 205.4 MB, k: 185.5 MB. 12627×11404 float32, ~250 m (0.0025°), NaN
  nodata, 512-px internal tiles, overviews [2,4,8,16,32], bounds
  65.62–97.19 E / 4.77–33.28 N. HTTP range requests verified (206).
- License: standard GWA **CC-BY 4.0** (same files the GWA site offers for
  public download) — commercial use with attribution OK.
- Sampled: Muppandal **A = 10.6472, k = 2.8655**; Bhadla A = 6.7996, k = 2.3043.
- **Consistency check: exact.** A·Γ(1+1/k) = 9.4893 vs `ws_mean_hgt100m`
  9.4894 at the same pixel (0.00%); Bhadla likewise exact. GWA's mean-speed
  layer IS the combined-Weibull implied mean — same 250 m grid as the tiler.
- Implementation: one-time prep script downloads both COGs to
  `apps/api/data/gwa/` (gitignored; fetched at deploy); Weibull reads are
  windowed local-COG reads. No runtime dependency on the CDN.
- Contingency (validated, NOT used): solving k from PD/(½ρv³) moment ratio
  recovers A within 1% but k 8–16% high (GWA PD is histogram-derived, not
  fit-derived) — acceptable only as labeled "estimated distribution" fallback.

## 3. Climate source: licensing decision + reanalysis probe (probe: `era5_rose.py`)

- **No `OPEN_METEO_API_KEY` exists in any env file** (repo + apps/api +
  apps/web + deploy checked). **Decision: `CLIMATE_SECTION_ENABLED=false` in
  production.** Section B (rose/monthly/diurnal) is built but ships
  `status: "unavailable"` until a commercial Open-Meteo key is provisioned.
  The keyless tier is non-commercial → used here for a one-off dev probe
  only, never from the production route (plan §2.9 honored).
- Endpoint probed: `archive-api.open-meteo.com/v1/archive`, hourly
  `wind_speed_100m,wind_direction_100m`, m/s, year 2024, Asia/Kolkata.
  **The default `best_match` model for 100 m wind is empirically ECMWF IFS
  9 km** (matched `models=ecmwf_ifs` exactly; response metadata names no
  model). Pure `models=era5` reads ~40% low at this site (annual 4.92 vs
  6.48 m/s) — **do not pin `models=era5`**; `era5_land` has no 100 m wind.
- Muppandal rose (8784 h, 2024): **W-dominant — W 41.3% @ 7.39 m/s;
  W+WSW+SW = 51.2%** → SW-monsoon-dominant ✓ (plan §0.3 check passes), with
  a real secondary NNE lobe (21.4% @ 7.36 m/s, NE monsoon). **Expect a
  two-lobed rose at gap sites** — golden tests must not assert a single lobe.
- Monthly means are **bimodal** (Jun–Sep peak 8.24; Jan–Feb 8.05; troughs
  Mar–Apr, Oct–Nov). Diurnal: mild single peak, min 5.82 @ 07:00, max
  7.38 @ 14:00.
- Annual mean 6.48 m/s vs GWA 9.49 at the same point: the reanalysis
  underestimates terrain-accelerated sites — **climate section is for
  direction/seasonality shape only, never resource magnitude.**

## 4. Power-tile decode spike (probe: `power_decode.ts`)

- Decode works: `new VectorTile(new PbfReader(buf))` on the (auto-gunzipped)
  upstream body. **pbf v5 has no default export** — `import { PbfReader } from "pbf"`.
  Deps added to apps/api: `pbf@5.1.0`, `@mapbox/vector-tile@3.0.0`.
- Layers at z10: `power_line` (59), `power_substation_point` (27),
  `power_plant` (2), `power_plant_point` (3), `power_generator` (**2971 —
  individual turbines; grid.ts MUST skip this layer**). The polygon
  `power_substation` layer appears at neither z7 nor z10 →
  `power_substation_point` is the canonical substation source (point-only,
  no centroid handling needed at decode zoom).
- **Voltage encoding: tiles are already in kV** (raw OSM is volts — do NOT
  divide by 1000). Lines: `voltage` is a JS number (110/220/400 seen).
  Substations: `voltage` is a string with float noise ("110.0000…").
  Multi-voltage arrives as `voltage_2`/`voltage_3` props, not semicolons.
  Parse: `parseFloat(String(v))`, null if not finite/≤0.
  Missing tags are real (6/59 lines, 4/27 substations) → kept with
  `voltageKv: null` per plan hard rule ✓.
- Nearest-distance verified against Overpass ground truth: tile-derived
  nearest substation "Muppandal" (110 kV) @ 0.449 km vs Overpass way/309123860
  @ 0.445 km — 4 m delta, well inside tolerance. Nearest line 110 kV @ 0.18 km;
  400 kV lines present in the same tile.
- **Phase 2 must decode at z10**: z7 silently drops minor substations
  (27→7) and ALL untagged lines. Expanding-ring search runs on z10 tiles.

## 5. ANALYSIS_ZOOM (probe: `gwa_layers.py`)

**Pinned: `ANALYSIS_ZOOM = 10`.** A 5×5 km square at Muppandal covers 256
valid `ws_mean_hgt100m` pixel centers at z9 (< 300 required) vs **1089 at
z10** (≥ 300 ✓). All wind/CF/pd/rix layers have maxzoom exactly 10 (zero
headroom — never request z>10 for them); `elevation` goes to 12 but is
sampled at 10 with the rest.

## Gate check (plan §4 Phase 0)

| Item | Status |
|---|---|
| Both CF layer names + Muppandal values | ✓ `cf_iec3`=0.67233, `cf_iec2`=0.61432 |
| Golden IEC-III band recorded | ✓ 0.632–0.712 (NOT the 0.25–0.35 guess) |
| Weibull layer names + consistency | ✓ country COGs; A·Γ(1+1/k) exact match |
| Climate-source decision + license | ✓ flag OFF in prod; keyless = non-commercial; best_match = ECMWF IFS |
| Decode spike result | ✓ verified vs Overpass, voltage semantics pinned |
| Pinned zoom | ✓ z10 |

**Deviation noted for the record:** plan §2.2 assumed Weibull A/k "via the
same TiTiler path" — they are not on the tiler; the official GWA country
COGs (same data, same grid, CC-BY) are used instead. No domain decision
changes. Everything else in §2 survived probing unchanged.

---

## Addendum — Phase 1/2 live reference values (golden-test bands)

Recorded from live runs on 2026-06-11/12 (analysisVersion 10.1.0, fresh tile
cache). These are the bands `golden.test.ts` asserts against.

### Muppandal 5×5 km point square (8.26 N, 77.55 E)

| Quantity | Live value | Golden band |
|---|---|---|
| AOI mean `ws100` | 9.72 m/s | 8.7–10.3 (exact pixel 9.4894 ± 0.8 corridor-gradient drift, §1) |
| AOI mean `cf_iec3` | 0.6718 | 0.632–0.712 |
| shearAlpha | 0.2315 | 0.18–0.30 |
| Weibull (COG area means) | A=10.95, k=2.76 | A·Γ(1+1/k) within 5% of meanSpeed (live: 0.26%) |
| areaExceedance90 | 8.91 | < p25 < p50 < p75 < max ordering |
| indiaPercentile | ~99 | ≥ 95 |
| Nearest mast | "Muppandal (1)", 0.6 km, 20 m, maws 7.08 | count-in-AOI = direct SQL; confidence high |
| modelDeltaPct | +5.1% | within ±20 (α-sensitive: 100→20 m extrapolation) |
| Nearest substation | Aralvaimozhi 110 kV, ~1.0 km | < 5 km (Overpass-verified family, §4) |
| Nearest line / EHV | 220 kV at ~0.2 km, EHV ≤ 25 km true | EHV true |
| Windfarm overlap | count 1, fraction 0.9357 | §2.5 behavior: sizing collapses (~5.7 MW) |
| Terrain | slope mean 5.1°, 90th 19.6° (Aralvaimozhi is rugged) | terrain points small |
| Score | 90, confidence high | 80–95; value == Σ components ± 0.5 |
| Timing | cold 2.7 s, warm (result cache) 70 ms | cold < 15 s |

### Bhadla 5×5 km point square (27.53 N, 71.92 E)

meanSpeed 5.91 (band 5.5–6.5) · cfIec3 0.3005 · siteClass marginal ·
score 53 < Muppandal (resource component only 10.2/45 — the tool does not
flatter solar country on WIND resource; flat terrain + nearby grid earn
their points honestly and the marginal badge tells the story).

### Corridor polygon (~1,513 km², 6 vertices)

cold 3.3 s within the 15 s budget · all sections ok · min/max pixel speeds
2.32/21.98 are real GWA extremes inside the AOI (areaExceedance90 is the
robust stat, not min/max).

### Operational notes

- Local dev DB carries only PostGIS + `windmills`; `StateCapacity` lives in
  the production DB. context.ts falls back to the committed STATE_DATA
  mirror when the table is absent/empty (warn-logged).
- `data/gwa/` COGs (391 MB) are gitignored — run
  `bun scripts/fetch-weibull-cogs.ts` at deploy or Weibull degrades to null.
- A transient GWA-tiler stall was observed once (resource section degraded
  to unavailable on a cold cache, exactly as designed; the retry passed).
  STALE-fallback only exists for already-cached tiles — first-ever requests
  have no fallback by nature.

## Addendum — Phase 6 browser e2e (verified 2026-06-12)

Headless Chromium (Playwright) against local dev servers (web :3000,
api :3001), logged in as a PREMIUM-tier test user. 10/10 checks, zero
page errors:

| Check | Evidence |
|---|---|
| Pro login → pro-map | gate page replaced by live map |
| Analyze tool open on load | Point / Rectangle / Polygon visible on entry |
| Rectangle draw → live result | score 32/100, 33.3 km², mean wind 5.22 m/s @100 m |
| Permalink round-trip | `#aoi=` hash written; reload restores AOI and re-runs to the **identical** score (deterministic) |
| Copy CSV / Copy link buttons | absent (removed by design) |
| Mast height chips | `<50 m / 50–100 m / >100 m` render under the Masts toggle |
| WindResourceCard | renders bottom-right quadrant |

Frontend Pro gating is `user.tier === "PREMIUM"` from the Better Auth
session (apps/web pro-map page); the API-side `PRO_ALLOWLIST_EMAILS`
allowlist does NOT unlock the web UI — local e2e users need
`tier='PREMIUM'` in `apps/api/data/auth.sqlite`.

Earlier same-session runs (screenshots in /tmp/wce-e2e/) also covered:
polygon draw + Enter-commit, Esc-cancel, low-zoom draw, and the
mid-draw km² readout.
