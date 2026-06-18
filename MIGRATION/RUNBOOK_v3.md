# Site-Analysis Service Migration Runbook — v3 (engine-corrected)
### Express (TypeScript) → FastAPI (Python) · Parity-First

**Audience:** Claude Code (or any engineer), executing this migration in the `wce` monorepo.
**Supersedes v2.** v2 was written against an assumed **H3-cell suitability mapper**. The real
engine is a **single-AOI scalar screener**. This v3 corrects every section to the engine that
actually exists, and folds in the Phase-1 discovery results (already complete — see
[`README.md`](./README.md)).

> **Objective of this phase:** move the existing, already-working site-analysis engine out of
> Express into a standalone FastAPI service with **exact behavioural parity** against the captured
> golden corpus. No new features, no accuracy "fixes," no methodology changes. The oracle is the
> **legacy Express code + its frozen outputs** (`golden/`), NOT any future suitability spec.

---

## 0. What changed from v2 (read this first)

The v2 spatial model was fictional relative to the code. Corrections (evidence:
[`RECONCILIATION_AND_DEFERRED.md`](./RECONCILIATION_AND_DEFERRED.md), 76 mismatches):

| v2 assumed | Reality | Effect on the runbook |
|---|---|---|
| H3 tiling / cell grid | one z10 web-mercator **pixel** patch + boolean AOI mask | **no `tiling.py` stage**; fold into `sampling.py`/`tiles.py` |
| per-cell heatmap, top-cells, best-pocket | one score + 5 **scalar** sections | no cell arrays/ordering to port or diff |
| 5 classes incl. POOR | **4 classes**: excellent/good/moderate/**marginal** | fix the site-class enum |
| exclusion buffers gate scoring | pure weighted sum, no veto | no exclusion stage |
| UTM reprojection, zone-crossing | geodesic-degrees (turf) + native tile/COG CRS + PostGIS geography | no `ST_Transform`; tolerance is per-section, not one AOI reproject |
| bilinear resampling choice | always nearest/exact-pixel | resampling is a non-choice |
| config/bands in a DB/file | **hardcoded**; score breakpoints in `score.ts`, weights in `constants.ts` | SHA-pin BOTH files, not a config table |
| multi-cell aggregation | whole-AOI scalar reduction over in-mask pixels | aggregate = mean/percentile over one pixel array |

**Still valid from v2 (keep):** parity-first discipline; sync routes + threadpool + **per-thread
raster handles**; run the mast/StateCapacity SQL **identically** in the same PostGIS; **NaN/Inf →
null** serialization; the golden-corpus oracle; restart-free kill-switch → shadow → cutover;
`DEFERRED_IMPROVEMENTS.md`; deterministic ordering of the (few) collections that exist.

---

## 1. Discovery & parity baseline — ✅ DONE

Completed and committed under `MIGRATION/`. Do not redo; consume these:
- [`CURRENT_STATE.md`](./CURRENT_STATE.md) — contract, pipeline, scoring, 5 sections, geometry,
  and the **where-each-calc-runs (SQL vs JS)** table.
- [`DATA_SOURCES.md`](./DATA_SOURCES.md) — tables/SRIDs, `pg` driver (not Bun.sql), rasters/COGs,
  integrity gaps, config locations.
- [`QUERY_INVENTORY.md`](./QUERY_INVENTORY.md) — the **only 3 SQL statements**, verbatim, with
  captured `EXPLAIN ANALYZE` (Q2 uses `idx_windmills_geom` KNN; Q1 seq-scans correctly at 1019 rows).
- [`FP_AUDIT.md`](./FP_AUDIT.md) — every rounding step + **order** + NaN→null serialization.
- [`RECONCILIATION_AND_DEFERRED.md`](./RECONCILIATION_AND_DEFERRED.md) — assumption table, test
  oracle, 11 deferred items.
- [`golden/`](./golden/) — **10 frozen fixtures, all parity invariants validated** (the oracle).

**Remaining (non-blocking):** §1.5 perf timing — re-run `golden/capture.sh` with `curl -w
'%{time_total}'` for MISS-cold vs HIT-warm numbers.

### ✅ Gate 1 — effectively GREEN. Proceed.

---

## 2. Scaffold the FastAPI service

A running, healthy, empty service wired to the **same** DB and **same** rasters. No engine logic.

### 2.1 Placement & structure
`services/site-analysis/` (confirm monorepo convention first). Suggested:
`app/{main,config,db}.py`, `app/api/routes.py`, `app/models/` (Pydantic),
`app/engine/{pipeline,geometry,tiles,mask,resource,weibull,indiacdf,grid,validation,context,climate,score,serialize}.py`,
`app/engine/compute.py` (**pure numeric core — arrays in/out, no IO**, the future Rust/PyO3 seam),
`tests/`, `Dockerfile`, `pyproject.toml`.
**Note the module list has NO `tiling.py`** — the only "tiling" is the internal GWA tile fetch,
which lives in `tiles.py`.

### 2.2 Dependencies (pin + lock)
`fastapi`, `uvicorn[standard]`, `pydantic`, `psycopg[binary,pool]` (**psycopg3, sync**), `numpy`,
`rasterio` (GWA float32 GeoTIFF tiles + Weibull COGs), `shapely`, `pyproj`, plus an **MVT decoder**
for the OSM power tiles (`mapbox-vector-tile` + `protobuf`, the Python analogue of
`@mapbox/vector-tile`+`pbf`). **No `geopandas`** on the request path. **No `h3`** (the v2 dep — not
needed). Pin exact Python (e.g. 3.12.x) + commit a lock file; GDAL-ecosystem drift changes output.

> **Geometry parity caveat:** the legacy engine does area/centroid/self-intersection with **turf**
> (geodesic, WGS84 r=6378137, centroid = **vertex-mean**). Shapely's centroid is planar/area-based —
> **do not use it for `aoi.centroid`**. Port turf's algorithms (or call a turf-equivalent), and
> verify against the `golden/` `aoi.centroid`/`areaKm2` values, which are serialized **unrounded**.

### 2.3 Dockerfile
As v2 (python:3.12-slim, `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR`, `CPL_VSIL_CURL_USE_HEAD=NO`,
`--workers 2`), but **no OSGeo base image** — binary wheels (rasterio bundles GDAL, shapely bundles
GEOS, pyproj bundles PROJ) cover everything.

### 2.4 Wire to the SAME inputs (real specifics from `DATA_SOURCES.md`)
- **PostGIS** (`postgres://wpi:***@host:5432/wpi`): `windmills` (1019 mast points, SRID 4326,
  GIST `idx_windmills_geom`). `StateCapacity` is **Prisma-managed and absent in dev** → the engine
  falls back to a hardcoded 9-state table; replicate that fallback exactly. `pg` pool is `max:10`;
  size the psycopg3 pool ≥ `MAX_CONCURRENT_ANALYSES` (= 4).
- **GWA TiTiler** `https://tiles-stag.ramtt.xyz/titiler/gwa4` (**staging**, EPSG:3857, float32, NaN
  nodata), sampled **z10**; layers `cf_iec3,cf_iec2,ws_mean_hgt{50,100,150}m,pd_mean_hgt100m,rix,elevation`.
- **Weibull COGs** local `data/gwa/IND_combined-Weibull-{A,k}_100m.tif` (**EPSG:4326**, 250 m).
- **OSM power MVT** `https://openinframap.org/map/power/{z}/{x}/{y}.pbf` (z10, layers
  `power_line` + `power_substation_point`; skip `power_generator`).
- **States** gist (commit-pinned) → `data/cache/india_states.geojson` (`ST_NM`).
- **Farms** `data/private/boundaries.geojson`; **India CDF** `data/analysis/india-ws100-cdf.json`.
- Mount the raster dir + read the local GeoJSON **read-only**; the engine never writes back.
- **`GET /health`** verifies: DB reachable; each raster opens read-only; GWA tile fetch 200s; each
  COG's CRS is EPSG:4326 and the tiles EPSG:3857; `india-ws100-cdf.json` parses to 101 quantiles;
  and the **config SHA** (`constants.ts` + `score.ts`, §7) matches.

### 2.5 Concurrency / async model (critical)
- Spatial routes are **synchronous `def`** (threadpool); blocking rasterio/shapely/numpy never run
  in `async def`. DB driver **sync** (psycopg3 + pool). **Raster handles per-thread/per-request** —
  rasterio `Dataset` is not thread-safe; never share a global handle. Mirror the legacy
  per-section concurrency shape (grid ∥ climate ∥ resource; then validation + context on the
  resource artifacts) and the **per-section budget** (15 s wall, dependents floored at 250 ms).
- Replicate the route guards: **`MAX_CONCURRENT_ANALYSES = 4`** counting semaphore (cache-miss
  only), per-user rate limit 20/60 s keyed on user id. Both are process-local in the legacy code.

### 2.6 Auth / Pro gate (parity-critical — the service is Pro-gated)
The legacy endpoint runs `requirePro` (Better Auth session → Pro check: `tier==="PREMIUM"` OR email
in `PRO_ALLOWLIST_EMAILS`). The FastAPI service sits **behind Express** in shadow/cutover, so the
simplest correct design is: **Express keeps doing auth** and proxies an already-authorized request
to FastAPI on an internal-only port (not public). Do not re-implement Better Auth in Python. The
five 401/403/429 paths and their **exact bodies** (`CURRENT_STATE.md` §1) stay in the Express layer.

### 2.7 Feature flag (restart-free)
DB/polled-file toggle `SITE_ANALYSIS_BACKEND ∈ {legacy, service}`, default `legacy`, read per
request. Rollback = flip the value, no redeploy.

### ✅ Gate 2
`docker compose up` → `/health` green (same DB, same rasters read-only, correct CRSs, config-SHA
match). Sync-route + threadpool + per-thread-raster model in place. No engine logic yet.

---

## 3. Port the engine (verbatim, parity-first) — stage by stage, each its own commit + tests

### 3.1 Models & serialization (`models/`, `serialize.py`)
- Pydantic request/response mirror the contract field-for-field (`CURRENT_STATE.md` §2): the
  envelope `{analysisVersion, aoi{areaKm2,centroid,isPointMode}, score, sections{resource,climate,
  validation,grid,context}}`; `Section<T> = {status, data|null}`; `siteClass` enum **exactly**
  `excellent|good|moderate|marginal`; the 400 error bodies + codes.
- **Serializer: non-finite floats → `null`** (`allow_nan=False` alone *raises* — map to `None`).
  Reproduce the per-field null-guards too (they are the primary mechanism — `FP_AUDIT.md` §0/§3).
  `weibull.A/k`, `aoi.areaKm2`, `aoi.centroid` are serialized **unrounded**.

### 3.2 Logic, stage by stage (port order; `compute.py` stays pure)
1. **`geometry.py`** — validate/canonicalize: outer-ring-only, auto-close, vertex cap ≤100 (on the
   ring **as sent**), 6-dp canonical rounding (−0→0), consecutive dedupe, self-intersection (turf
   kinks), geodesic area 1–2500 km² (turf area), India bbox `[67,6,98,38]` per-vertex, centroid
   (turf vertex-mean), point-mode fingerprint (4 axis-aligned corners, 24–26 km²). **No
   `ST_MakeValid`/`buffer(0)`** — reject, never repair. Cache key = `md5(JSON.stringify(ring) +
   "10.1.0")`, no delimiter — reproduce the **exact** serialization (key order, no spaces).
2. **`tiles.py`** — GWA z10 float32 tile fetch + decode + stitch into a row-major patch (NaN
   nodata); infinite disk cache (climatology never changes); `fetchPointValue` single-pixel sample
   via `Math.floor` indices. CRS EPSG:3857; pixel math from `mercator.ts` (port verbatim).
3. **`mask.ts` → `mask.py`** — even-odd ray cast marking a pixel when its **center** is in the ring
   (the `−0.5` pixel-center offset is parity-critical). Nearest/all-or-nothing per pixel.
4. **`resource.py`** — mean/min/max/p25/p50/p75 + `areaExceedance90` (10th-pct, **R-7 linear**)
   over in-mask finite pixels; shear α = least-squares ln(v)/ln(h) over 50/100/150 m, clamp
   [0,0.6], 1/7 fallback; air density `1.225·(1−2.2558e-5·h)^5.256`; power = pd100·ρ/1.225; CF
   clamp ≥0. Reproduce the **rounding order** (`meanSpeed` rounded to 2 dp *before* banding +
   percentile; α rounded to 4 dp *before* feeding validation — `FP_AUDIT.md` §1).
5. **`weibull.py`** — area-mean A/k over the **EPSG:4326** COG window via its own ray-cast;
   A/k passed through **unrounded**; the Lanczos gamma exists but is **not invoked at request time**.
6. **`indiacdf.py`** — 101-quantile linear interpolation; `Math.round` to int happens at the field.
7. **`grid.py`** — **in-JS-equivalent, NOT PostGIS.** Expanding-ring OSM-MVT search [10,25,50,100]
   km from the AOI **centroid**; substation distance = **haversine**, line distance =
   **equirectangular** point-to-segment (two engines — keep both); EHV ≥220 kV via
   `max(voltage,voltage_2,voltage_3)`; reported `voltageKv` = primary `voltage` only;
   `ehvWithin25Km`/min-EHV decided on **unrounded** distances.
8. **`validation.py`** — **run the two SQL statements IDENTICALLY** (`QUERY_INVENTORY.md` Q1/Q2):
   `ST_DWithin(::geography)`, `ST_DistanceSphere`, KNN `<->`, `ST_Intersects(ST_GeomFromGeoJSON)`.
   Three distance engines — do not unify. Shear-adjust with the **4-dp** α; delta suppressed >25 km
   (unrounded). Coerce psycopg `Decimal`→`float`, reject NaN/Inf like `toFiniteNumber`.
9. **`context.py`** — states via in-JS even-odd point-in-poly of centroid+vertices (point sampling,
   not true intersection) + the **hardcoded `STATE_CAPACITY_FALLBACK`** when the table is absent;
   farm overlap by rasterizing onto the z10 grid (pixel-count fraction); terrain slope via central
   differences (per-row mercator pixel size `156543.03392·cos(lat)/2^z`); sizing
   `usable=area·(1−overlap)·0.7`, `capacity=usable·5`, `energy=round1(round1(capacity)·8.76·round4(cf))`
   (chained rounding — reproduce).
10. **`climate.py`** — gated OFF by default (`CLIMATE_SECTION_ENABLED` + `OPEN_METEO_API_KEY`);
    commercial endpoint only. In default deployment this ships `{status:"unavailable"}` — every
    golden fixture confirms it.
11. **`score.py`** — 4 components (resource 45, cf 25, grid 20, terrain 10); breakpoints
    resource 4.5/7.5, cf 0.12/0.38, grid 10/50 (inverted), terrain 5/20 (inverted);
    `value = round(Σ weight·normalized)` over **unrounded** normalized; `points` = 1-dp display;
    null/non-finite raw → zero row; `confidence` attached verbatim, **never** in the arithmetic.
12. **`pipeline.py`** — same stage ordering + per-section degrade-to-`unavailable` + the strip of
    score-only extras (`nearestEhvKm`, `slope90thDeg`).

### 3.3 Allowed vs forbidden this phase
- **Allowed (behaviour-preserving):** read the GWA tile window once and sample all pixels from the
  array; vectorise the in-mask reductions; one set-based query if it returns identical numbers.
- **Forbidden (defer → `DEFERRED_IMPROVEMENTS.md`):** UTM/`geography` reprojection where the engine
  used degrees; bilinear where it used nearest; true polygon intersection where it point-samples
  states; edge-anchored grid distance where it uses the centroid; unifying the two grid distance
  engines; rounding `weibull.A/k`; adding a data-vintage field.

### 3.4 Numerics — `float64` everywhere; replicate rounding **order**, not just precision (`FP_AUDIT.md`).

### 3.5 Contract verification BEFORE numerical parity
Diff field names, nesting, **nullability**, status codes, error bodies, and NaN→null across the
`golden/` fixtures. Frontend breakage is usually a contract bug, not a scoring bug.

### ✅ Gate 3
Ported-stage unit tests + coordinate-pinning pass; contract verification green; a smoke AOI returns
the old shape.

---

## 4. Parity verification (the decisive gate)

### 4.1 Harness
`MIGRATION/parity/run.py`: POST each `golden/<name>/request.json` to the new service; diff against
the frozen `response.json` and its `response.sha256`. Emit structured divergences
(`{path, expected, got}`). The corpus already passed self-checks (MISS==HIT, no NaN, codes) — the
port must reproduce it.

### 4.2 Comparison rules (conditional tolerance, per `CURRENT_STATE.md` §7)
- Exact: exclusion/no-go N/A; **site-class labels**; the 4 score `points`/`value` (±0.5 slack from
  documented rounding); 400 codes; `ehvWithin25Km`; `mastCountInAoi`; `isPointMode`.
- **Mast distances/counts (PostGIS, identical SQL):** exact ≤1e-6.
- **Raster stats (JS nearest-pixel):** exact — same pixels, same float64 reductions.
- **Geometry-derived in turf→shapely (`areaKm2`, `centroid`):** allow ≤1e-4, log each; if larger,
  it's a port bug (likely Shapely planar centroid vs turf vertex-mean).
- **Grid line distance (equirectangular in JS):** exact to the JS formula — do **not** substitute
  `ST_Distance`/geodesic; that's a different number.
- Coordinate-pinning: dump the legacy sampled tile row/col + value for a known cell and assert the
  port reproduces both.

### 4.5 Load & concurrency test
Realistic AOIs at ~2× peak concurrency: identical outputs under load (no races), psycopg pool
stable, **no concurrent-read RasterioIOError** (proves the per-thread handle design), p95/memory
within the §1.5 baseline.

### ✅ Gate 4 / 4.5 — 100% golden parity under §4.2; throughput OK at 2×.

---

## 5. Integration with a kill-switch
Branch in the Express route on the §2.7 flag: `legacy` → in-process engine (unchanged); `service`
→ proxy to FastAPI, body passthrough, response unchanged, **Express still does auth + the rate/
concurrency 429s**. **Shadow mode:** Express returns the legacy result instantly and fires an async
diff against the new service using §4.1's format; investigate every functional divergence as a port
bug. ✅ Gate 5: zero functional divergence on real traffic.

---

## 6. Cutover & decommission
Flip the flag to `service` (optional canary), monitor with instant rollback, then remove the
in-Express engine in one dedicated commit (keep the proxy/flag one release). Update
`CURRENT_STATE.md` + the architecture diagram. ✅ Gate 6.

---

## 7. Cross-cutting
- **FFI seam:** `engine/compute.py` stays a pure boundary for a future Rust/PyO3 kernel — seam only.
- **Config SHA pin:** assert a SHA-256 of **both** `constants.ts` AND `score.ts` at startup (the
  breakpoints live in `score.ts`, the weights/bands in `constants.ts` — a single-file pin misses
  half the config). Plus the `india-ws100-cdf.json` (101 quantiles) and the Weibull COGs.
- **Observability:** structured logs w/ request id; per-section ms + in-mask pixel count, compared
  to the §1.5 baseline so you prove the optimisation, not just parity.
- **Vintage:** the legacy response stamps `analysisVersion` only (no data-vintage) — replicate as-is.
- **Tests shipped:** unit per stage, coordinate-pinning, contract verify, the parity harness,
  `/health` smoke — all in CI.
- **`DEFERRED_IMPROVEMENTS.md`:** seeded in `RECONCILIATION_AND_DEFERRED.md` Part 4 (centroid-anchored
  grid distance, two grid distance engines, state point-sampling, turf-vs-PostGIS geometry, dual
  ray-casts, staging tiler + no SHA pins, the shear-fallback docstring drift, z10 elevation,
  unused gamma, no data-vintage, per-process caps).

---

## 8. Definition of done (this phase)
FastAPI service deployed alongside Express, same DB + rasters, sync-route + threadpool + per-thread
raster handles; **100% `golden/` parity** + clean load test + zero shadow divergence; frontend
unchanged (contract + NaN/null verified); served behind a restart-free flag with instant rollback;
perf ≤ §1.5 baseline; old in-Express engine removed (recoverable); docs updated;
`DEFERRED_IMPROVEMENTS.md` populated. **Accuracy/methodology improvements begin only after sign-off.**
