# Wind Capacity-Factor Engine — Incorporation Plan into the Site-Analysis Tool

**Goal:** Upgrade the existing `POST /api/analyze` site-analysis engine from "GWA resource + GWA's pre-baked CF" to a **research-grade, bankable net capacity factor** (turbine-specific, wake- and loss-adjusted, with P50/P75/P90), per the CF-engine research doc — **without** re-introducing a Python production service and **without** re-fetching data we already own.

**Status:** Plan only. No code written. Grounded in the current codebase (file paths below are real).

---

## 0. TL;DR — the reframe

1. **You already have most of it.** The `apps/api/src/services/analysis/*` engine (v10.1.0) already does: polygon ingest + geodesic area + canonicalization (`geometry.ts`), z10 raster masking + zonal stats (`mask.ts`, `tiles.ts`), GWA resource at 50/100/150 m (`resource.ts`), air-density correction, shear-exponent fit, Weibull A/k means (`weibull.ts`), India percentile (`indiaCdf.ts`), mast validation (`validation.ts`), grid distance (`grid.ts`), terrain slope + sizing (`context.ts`), Open-Meteo ERA5 shape (`climate.ts`), weighted scoring (`score.ts`), result caching + concurrency + degradation. That maps onto **Layers 0–5, 9, parts of 11–12** of the research doc.

2. **The real gaps** are the physics that converts *resource* → *bankable net CF*:
   - CF today is **read from GWA's `cf_iec3` layer** (a synthetic IEC-class turbine) — not derived from a **real turbine power curve** at our chosen hub height (Layers 6–7).
   - **No wake model** (Layer 8a), **no explicit loss buckets** → no true net CF (Layer 8b).
   - **No P50/P75/P90** — only a confidence badge; GWA is a single 2008–2017 climatology so there's no interannual variability (Layer 10).
   - **Developable area is crude** — a flat `0.7` usable fraction in `context.ts`; the **`wce.*` exclusion PostGIS we just shipped is *not* wired into `analyze`** (Layers 6, 8-masking).
   - **No validation against generation actuals** (CEA/SLDC PLF) — validation is mast-*resource* only (Layer 11).

3. **The optimization thesis (how we honor "full optimization"):** **precompute-heavy, request-light.** The expensive scientific Python (`windpowerlib` power curves, `PyWake` wakes, multi-year ERA5 interannual variability) runs **offline as bake scripts** — exactly like `apps/web/scripts/build_wind_atlas.py` already bakes GWA, and `fetch-weibull-cogs.ts` already pulls Weibull COGs. The bakes emit **rasters / COGs / lookup tables**, and the existing TS engine reads + area-weights them at request time. This:
   - dodges the **rejected FastAPI/Python-service** path (the request path stays Bun/TS, in-process);
   - keeps `analyze` latency in its current ~budget (no per-request PyWake);
   - reuses every asset already baked;
   - turns "accuracy" into an offline data problem, which is where it belongs.

---

## 1. What already exists vs. the research doc's 12 layers

| Research Layer | Status today | Where |
|---|---|---|
| 0 Config/orchestration | ✅ versioned (`ANALYSIS_VERSION`), cached, concurrency-gated, degradation-safe | `constants.ts`, `resultCache.ts`, `concurrency.ts`, `index.ts` |
| 1 Geometry & input | ✅ GeoJSON polygon, canonicalized, geodesic area, India-bbox guard | `geometry.ts` |
| 2 Data acquisition | ✅ GWA (TiTiler + baked PNG/grids), Weibull COGs, DEM tiles, ERA5 (Open-Meteo), masts/turbines (PostGIS), exclusions (PostGIS) | `tiles.ts`, `weibull.ts`, `climate.ts`, connectors |
| 3 Preprocess/harmonize | ✅ z10 web-mercator mesh, in-mask ray-cast, stitched float32 patches | `mask.ts`, `mercator.ts`, `tiles.ts` |
| 4 Resource characterization | 🟡 GWA means + Weibull + shear α; **no bias-corrected hourly series, no TI** | `resource.ts`, `weibull.ts` |
| 5 Atmospheric corrections | ✅ barometric air density from elevation; applied to power density | `resource.ts` |
| 6 Turbine & layout | ❌ no turbine power curve, no layout; flat `0.7`×`5 MW/km²` sizing; **exclusions not used** | `context.ts` |
| 7 Energy conversion | 🟡 **CF read from GWA `cf_iec3`**, not power-curve-derived | `resource.ts` |
| 8 Wake & loss | ❌ none (no wakes, no loss buckets, no net CF) | — |
| 9 Spatial aggregation | ✅ area-weighted zonal stats over in-mask pixels | `resource.ts`, `mask.ts` |
| 10 Uncertainty | ❌ confidence *badge* only; no P50/P75/P90, no IAV | `score.ts` |
| 11 Validation/calibration | 🟡 mast *resource* delta; **no generation-actuals (CEA/SLDC) calibration** | `validation.ts` |
| 12 Output/report/API | ✅ JSON envelope, web UI, permalink; **no CF raster, no loss waterfall, no exceedance curve** | `routes/analyze.ts`, web `AnalysisResults.tsx` |

**Legend:** ✅ done · 🟡 partial/simplified · ❌ missing.

---

## 2. Assets we already own (do NOT re-fetch)

The single biggest optimization is reuse. Everything the CF engine needs as *input* is already in the repo:

| Need (research doc) | We already have | Location |
|---|---|---|
| Spatial resource backbone | **GWA v4** speed 50/100/150 m, PD 100 m, elevation, rix, cf_iec2/3 | TiTiler `tiles-stag.ramtt.xyz/titiler/gwa4` + baked `apps/web/public/wind-atlas/*` + `build_wind_atlas.py` |
| **Weibull A/k** (the key CF input) | **GWA combined-Weibull A & k @100 m COGs** | `apps/api/data/gwa/IND_combined-Weibull-{A,k}_100m.tif`, `fetch-weibull-cogs.ts` |
| DEM / elevation / slope | AWS terrain tiles + coarse grid + GWA elevation layer | `demShared.ts`, `lib/elevation/india-grid.json` |
| Air density | barometric from elevation (already coded) | `resource.ts` |
| Developable-area masking | **`wce.*` exclusions** (excl_polygon, excl_buffer, forest, PA, CRZ, …) | PostGIS, `routes/exclusions.ts` |
| Turbine fleet reality (hub h, rotor, rated kW) | **`wind_turbines`** OSM table | `ingest-turbines.ts` |
| Resource validation points | **`windmills`** NIWE/WRA masts (MAWS, MAWPD) | `ingest-windmills.ts` |
| Temporal shape (rose/diurnal/monthly) | ERA5 via Open-Meteo (flag-gated) | `climate.ts` |
| Offline Python toolchain | rasterio/numpy/scipy venv already set up | `apps/web/scripts/.venv`, `requirements-wind.txt`, `scripts/probes/*.py` |

**Net new data to acquire (offline only):** turbine power-curve library (`windpowerlib` OEDB), multi-year ERA5 annual means for interannual variability, CEA/SLDC generation actuals for calibration. Nothing else.

---

## 3. The optimization thesis: precompute-heavy, request-light

```
OFFLINE  (Python bakes — run rarely, like build_wind_atlas.py)          REQUEST PATH (Bun/TS — runs per analyze, fast)
─────────────────────────────────────────────────────────────         ────────────────────────────────────────────────
GWA Weibull A/k  ─┐                                                      polygon → mask (existing)
  × turbine power │  windpowerlib power-curve convolution                  │
    curve + ρ + TI ├─► CF raster per (turbine-class, hub-height) ──► COG ─┤─► area-weighted GROSS CF  (read like cf_iec3 today)
                  │                                                        │
multi-year ERA5  ─┴─► interannual σ raster ───────────────────────► COG ─┤─► P50/P75/P90 (RSS)
                                                                          │
PyWake over layouts × resource bins ─► wake-loss SURROGATE ──────► JSON ─┤─► wake loss = f(capacity_density, mean_speed, TI)
                                                                          │
CEA/SLDC actuals ─► per-state calibration factors ──────────────► JSON ─┤─► net CF × state factor
                                                                          │
wce.* exclusions (already in PostGIS) ──────────────────────────────────┤─► developable area via ST_Intersection (SQL)
                                                                          │
loss buckets (config) ──────────────────────────────────────────────────┴─► NET CF + loss waterfall
```

**Rule:** anything that needs `xarray`/`PyWake`/`windpowerlib`/hourly time series is **offline**. The request path only does raster window reads, zonal stats, SQL intersects, table lookups, and arithmetic — all things the TS engine already does well. **No Python in the request path. No new always-on service.**

---

## 4. Target architecture (how it slots into the existing engine)

### 4a. Offline precompute pipeline (new Python bakes)
Lives alongside the existing bakes (`apps/web/scripts/build_wind_atlas.py`, `apps/api/scripts/fetch-weibull-cogs.ts`). Proposed new scripts (Python, bake-only, never imported by runtime):

- `scripts/cf/build_cf_rasters.py` — for each turbine class × hub height: read GWA Weibull A/k (extrapolate A to hub height via shear), convolve with the turbine power curve under per-cell air density + TI → write **CF COG** (`apps/api/data/cf/cf_<class>_<hubm>.tif`). This is the artifact that *replaces reading `cf_iec3`*.
- `scripts/cf/build_iav_raster.py` — pull ~20–30 yr ERA5 annual-mean wind, compute coefficient-of-variation → **IAV σ COG** (`.../cf/iav_sigma.tif`).
- `scripts/cf/build_wake_surrogate.py` — run PyWake over representative layouts (capacity densities × spacings) and resource/TI bins → fit a small surrogate (polynomial/grid) → **`apps/api/data/cf/wake_surrogate.json`**.
- `scripts/cf/build_state_calibration.py` — ingest CEA/SLDC actual PLF by state, compare to modelled, emit **`apps/api/data/cf/state_calibration.json`**.

All idempotent, cached, provenance-logged — same discipline as the existing bakes. Heavy artifacts (COGs) follow the gitignore + `scp`-to-VPS pattern we just used for `exclusions.pmtiles` (they're large and regenerable).

### 4b. Request-path upgrades (TS, in the existing engine)
Re-shape `services/analysis/` minimally:

- **`resource.ts`** → keep resource stats; **stop using `cf_iec3` for the headline CF.**
- **New `energy.ts`** → read the precomputed CF COG for the configured turbine class + hub height (windowed read + in-mask area-weight — identical pattern to `tiles.ts`/`weibull.ts`) → **gross CF**.
- **New `developable.ts`** → `ST_Intersection`/`ST_Area` against `wce.excl_polygon` + `excl_buffer` (+ slope mask from DEM, + optional land-cover) → **developable km²** and a developable-pixel mask that energy aggregation respects. Replaces the flat `0.7`.
- **New `wakeloss.ts`** → look up wake loss from the surrogate JSON given chosen capacity density + AOI mean speed + TI.
- **New `losses.ts`** → apply IEC-61400-15 loss buckets (config defaults, overridable) → **net CF**; emit the loss waterfall.
- **New `uncertainty.ts`** → combine IAV σ (from COG) + model/power-curve/loss σ in quadrature → **P50/P75/P90** (`P_ε = P50·(1 − z·σ)`).
- **`validate.ts` extension** → blend mast-resource delta (existing) with **state generation-actuals** calibration factor.
- **`score.ts`** → switch the CF component from GWA `cf_iec3` to the new **net P50 CF**; keep the weighting model (resource 45 / CF 25 / grid 20 / terrain 10) but recalibrate breakpoints to net-CF ranges (new score version).
- **`context.ts` sizing** → drive MW from developable area × capacity density (a config, not flat `5 MW/km²`), feeding the layout the wake surrogate assumes.

### 4c. Output upgrades (Layer 12)
Extend the `AnalysisResponse` envelope (and the mirrored web types in `apps/web/lib/analysis/types.ts`): add gross/net CF, P50/P75/P90, loss waterfall, developable km², turbine assumptions, and a per-cell **CF GeoTIFF/PNG** for the map. Wire net P50/P90 PLF straight into **`BankabilityCalc.tsx`** (today PLF is manual) — closing the loop from resource → finance.

---

## 5. Component designs (the upgrades, in priority order)

**5.1 Power-curve CF (replaces GWA `cf_iec3`) — highest accuracy lever.**
Offline: `AEP = 8760·Σ f(v)·P(v)` per GWA cell, where `f` is the per-cell Weibull (we already have A/k COGs), `P` is the turbine power curve (windpowerlib OEDB), corrected for air density (IEC 61400-12, already coded analytically) and TI. Bake one COG per (turbine class, hub height). Request path reads it exactly like it reads GWA layers today. **Why offline:** power-curve convolution × every cell × multiple turbines/heights is a bake, not a request.

**5.2 Developable area via the exclusions we just shipped.**
Wire `wce.*` into `analyze` (it isn't today). `developable = AOI − (excl_polygon ∪ excl_buffer) − slope>threshold − non-buildable land cover`. Energy aggregation runs over developable cells only. This makes both CF *and* sizing honest, and reuses the exclusion engine end-to-end.

**5.3 Wake-loss surrogate (PyWake offline → lookup).**
Live PyWake per request is too slow and would drag Python into the path. Instead bake a surrogate: wake loss ≈ f(capacity density, mean speed, TI, turbine). Request path does a table lookup. Typical 5–20% array loss.

**5.4 Loss buckets → net CF.** Multiplicative IEC-61400-15 buckets (availability ~3–5%, electrical ~2–3%, soiling/degradation ~1–3%, curtailment per-state, hysteresis small) as config with sane defaults; expose in the report as a waterfall. `CF_net = CF_gross·(1−wake)·Π(1−L_i)`.

**5.5 Uncertainty P50/P75/P90.** IAV σ from multi-year ERA5 (bake), plus model/power-curve/loss σ, combined RSS. `P75 = P50·(1−0.674σ)`, `P90 = P50·(1−1.282σ)`. Replaces the badge-only treatment.

**5.6 Validation/calibration vs actuals.** Offline: build per-state modelled-vs-CEA/SLDC bias → calibration factor JSON (the Ember approach). Request path multiplies and surfaces the residual bias + confidence. This is the "reality check" the badge can't give.

**5.7 Turbine & layout defaults from `wind_turbines`.** Use the real OSM fleet (hub heights, rotor diameters, rated kW already ingested) to pick sensible per-region default turbine classes and capacity density, instead of hardcoding — and to sanity-check the layout the wake surrogate assumes.

**5.8 Bankability loop.** Feed net P50 (and P90 for downside) into `BankabilityCalc.tsx` so PLF stops being a manual guess.

---

## 6. Full-optimization checklist

- **Reuse, don't refetch** — GWA, Weibull, DEM, exclusions, masts, turbines, ERA5 are all already here (§2).
- **Precompute the physics** — power curves, wakes, IAV, calibration are bakes; request path is reads + arithmetic (§3).
- **One mask, many layers** — the existing in-mask ray-cast (`mask.ts`) already serves all zonal reads; CF/IAV COGs join the same pass — no extra geometry work.
- **Windowed COG reads** — CF/IAV COGs read only the AOI window (like `weibull.ts`), not whole-India.
- **Cache dimensions** — extend the result-cache key (`md5(geometry + ANALYSIS_VERSION)`) to include turbine-class + hub-height + loss-profile so re-runs stay free and variants don't collide.
- **Surrogate over simulation** — PyWake/atlite never run per request.
- **Large artifacts off-git** — CF/IAV COGs follow the `exclusions.pmtiles` pattern (gitignored, `scp` to `/opt/wce/data/...` bind mount, md5-verified). Migration/scripts manual, documented.
- **Degradation preserved** — every new section degrades to `unavailable` (HTTP 200) like the current ones; net CF falls back to gross, gross falls back to GWA `cf_iec3`, so the engine never hard-fails.

---

## 7. Versioning, flags, rollout (mirrors current discipline)

- **Bump `ANALYSIS_VERSION`** once per phase (invalidates cache cleanly, as today).
- **Flag-gate** each new section (`CF_POWERCURVE_ENABLED`, `WAKE_ENABLED`, `UNCERTAINTY_ENABLED`, `DEVELOPABLE_ENABLED`) — same pattern as `CLIMATE_SECTION_ENABLED`.
- **Shadow mode** — compute new net CF alongside the current GWA-`cf_iec3` CF and log both before switching the headline, so we can compare against the §11 India benchmarks (national ~30% CUF; CERC 22–24% norms; red flag if net CF >~35% or <~12% in a known wind state).

---

## 8. Phased roadmap (each phase shippable)

| Phase | Deliverable | New artifacts | Engine changes | Done when |
|---|---|---|---|---|
| **A. Developable area** | wire `wce.*` exclusions + slope into `analyze`; honest usable km² & sizing | — (reuse PostGIS) | `developable.ts`, `context.ts` | usable area = AOI − exclusions − steep slope; shadow-logged |
| **B. Power-curve CF** | turbine-specific gross CF from Weibull × power curve | `cf_<class>_<hub>.tif` COGs | `build_cf_rasters.py`, `energy.ts` | gross CF within tolerance of GWA cf_iec3 on IEC-III; per-turbine variation visible |
| **C. Wakes + losses** | net CF + loss waterfall | `wake_surrogate.json` | `build_wake_surrogate.py`, `wakeloss.ts`, `losses.ts` | net CF = gross −wakes −losses; waterfall in report |
| **D. Uncertainty** | P50/P75/P90 + exceedance curve | `iav_sigma.tif` | `build_iav_raster.py`, `uncertainty.ts` | exceedance curve rendered; σ sourced from real IAV |
| **E. Validation** | state calibration vs CEA/SLDC; recalibrated score | `state_calibration.json` | `build_state_calibration.py`, `validate.ts`, `score.ts` | modelled CF within target band of state actuals |
| **F. Output + finance** | CF raster on map, net PLF → BankabilityCalc | — | `report.ts`, web types + UI | CF GeoTIFF overlay; bankability auto-filled |

Phase A is the fastest win (pure reuse of the exclusion engine, no new Python). Phase B is the core accuracy lever.

---

## 9. Decisions (LOCKED 2026-06-21)

1. **Turbine fleet → Representative IEC classes.** Bake CF for ~3 standard IEC class turbines (I/II/III) at a couple of hub heights. Small bake matrix. A specific-turbine picker is a possible later add, not in scope now.
2. **Headline CF → Shadow first, then switch.** Compute net CF alongside the current GWA `cf_iec3`, log/compare vs §11 benchmarks, flip the headline only after validation.
3. **Validation data → I source & ingest it.** Research + build an ingest for CEA/SLDC/Grid-India per-state wind generation + installed capacity → monthly/annual state PLF (Phase E). Today's `data/by-source/cea.json` is aggregate-only.
4. **Offline bake home → Laptop.** Run bakes locally (like `build_wind_atlas.py`), `scp` artifacts to the VPS bind mount (the `exclusions.pmtiles` pattern). No new infra.
5. **Uncertainty depth → Engineering-grade** (default): IAV from ERA5 + fixed model/power-curve/loss σ, combined RSS. A fuller per-source budget can come later.

---

## 10. Risks & caveats

- **GWA is a single 2008–2017 climatology** → true interannual variability must come from ERA5 (Phase D); don't fake P90 from it.
- **ERA5 is ~31 km** → fine for IAV and shape, not for absolute resource; the GWA-anchored CF (Phase B) carries the spatial accuracy.
- **Wake surrogate is an approximation** of a real layout; flag capacity density + spacing as assumptions and report sensitivity (the research doc's own caveat).
- **Curtailment/grid availability** are policy/grid effects physics can't model — they enter only via §5.6 calibration.
- **Large COGs** (CF × classes × heights, IAV) add storage; manage with the off-git `scp` pattern and prune unused class/height combos.
- **Don't re-propose a Python production service** — bakes are offline; the request path stays TS (per the abandoned-FastAPI decision).

---

## 11. Testing & QA

- **Unit:** power-curve convolution vs hand calc; Weibull-A shear extrapolation; air-density vs IEC examples; loss-waterfall arithmetic; P50/P90 formula; developable-area set algebra.
- **Integration:** full pipeline on fixed AOIs (a Tamil Nadu/Gujarat wind-rich block, a low-wind block) with cached fixtures — same harness style as the current analyze tests.
- **Cross-validation:** engine CF vs renewables.ninja and vs GWA cf_iec3 for the same points, within a stated band.
- **Ground truth:** net CF vs CEA/SLDC state PLF; track bias over time (Phase E).
- **Benchmarks/guardrails (§11 of research doc):** national ~30% CUF; CERC 22–24% norms; red-flag net CF >~35% or <~12% in a known wind state.
- **Reproducibility:** every bake logs dataset/library versions + config hash + git SHA, like the existing bakes.

---

*Prepared as an incorporation plan over the existing `apps/api/src/services/analysis` engine. Next action on approval: Phase A (wire `wce.*` exclusions into developable area) — no new Python, pure reuse.*
