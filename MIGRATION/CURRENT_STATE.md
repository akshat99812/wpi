# CURRENT_STATE — the existing site-analysis engine (parity source of truth)

> **What this engine is:** a single-AOI, whole-polygon screening pipeline. One validated
> polygon → one stitched GWA raster patch per layer at `ANALYSIS_ZOOM=10` → one boolean
> in/out **pixel** mask → AOI-wide **scalar** stats → one 0–100 `score` (4 weighted
> components) → one flat `AnalysisResponse` envelope (score + 5 independently-degradable
> sections). **No H3 cells, no heatmap, no per-cell ordering, no "best-pocket", no exclusion
> buffers, no UTM, no resampling choice, 4 site classes (no "POOR").** See
> `RECONCILIATION_AND_DEFERRED.md`.

Code root: `apps/api/src/services/analysis/`. Route: `apps/api/src/routes/analyze.ts`.
Current `ANALYSIS_VERSION = "10.1.0"` (`constants.ts:12`) — keys the result cache and the
response; any parity test must use this exact string.

---

## 1. HTTP contract

- **`POST /api/analyze`** — router mounted at `/api` (`server.ts:72`). Body parser
  `express.json()` global, default 100 kb limit (`server.ts:57`). CORS `credentials:true`
  (`server.ts:47-50`); `compression()` global (`server.ts:51`); `trust proxy=1` only in
  production (`server.ts:39-41`). **No custom JSON replacer anywhere** → plain `JSON.stringify`.
- **Middleware order:** `userAuth` → Pro check → `analyzeLimiter` → handler
  (`analyze.ts:52-54`, `requirePro.ts:6-19`).
  - `userAuth` → `401 {error:"Unauthorized"}` if no session (`userAuth.ts:30-33`).
  - Pro check → `401 {error:"Unauthorized"}` if no user; `403 {error:"Pro subscription
    required"}` if not Pro. Pro = `tier==="PREMIUM"` OR email in `PRO_ALLOWLIST_EMAILS`
    (`requirePro.ts:9-16`, `lib/auth-helpers.ts:8-11`).

### Request body
```json
{ "geometry": { "type": "Polygon", "coordinates": [[[lon,lat], ...]] } }
```
zod `analyzeRequestSchema` (`geometry.ts:71-73`): `type` literal `"Polygon"`; ≥1 ring; each
vertex `[finite lon, finite lat]`. **Only the outer ring (index 0) is used; holes ignored**
(`geometry.ts:96-107`). Client always sends `coordinates:[ring]` (`client.ts:40-42`).

### Status codes & EXACT error payloads
| Status | When | Exact body | `code` |
|---|---|---|---|
| 200 | success (hit or miss) | full `AnalysisResponse` | — |
| 400 | zod fail | `{error:"request body must be { geometry: GeoJSON Polygon }", code:"INVALID_GEOMETRY"}` | `INVALID_GEOMETRY` |
| 400 | `validateAoi` throws | `{error: err.message, code: err.code}` | `INVALID_GEOMETRY`/`TOO_MANY_VERTICES`/`AREA_TOO_LARGE`/`AREA_TOO_SMALL`/`OUT_OF_INDIA`/`SELF_INTERSECTING` |
| 401 | no session / no user | `{error:"Unauthorized"}` | none |
| 403 | not Pro | `{error:"Pro subscription required"}` | none |
| 429 | per-user rate limit | `{error:"Too many analysis requests"}` | none, **no Retry-After** |
| 429 | server concurrency cap | `{error:"Server is at its analysis limit — please retry shortly"}` | none, **Retry-After: 5** |
| 500 | infra fault | `{error:"Analysis failed"}` (never leaks internals) | none |

**Parity note:** **two distinct 429s** with different bodies; only the concurrency one carries
`Retry-After: 5`. Only 400s carry a `code` (`analyze.ts:37-96`).

### Headers
`X-Analysis-Cache: HIT|MISS` (`analyze.ts:80,108`); `Retry-After: 5` only on concurrency 429;
draft-7 `RateLimit*` headers; possibly `Content-Encoding: gzip`.

### Rate limit & concurrency
- **Per-user:** 20 req / 60 s, key = `req.user?.id || req.ip || "anon"`, counts hits AND misses,
  in-memory per-process (`analyze.ts:21-41`).
- **Concurrency gate:** semaphore `MAX_CONCURRENT_ANALYSES=4`, **cache-miss only**, never queues,
  process-local (`concurrency.ts`, `analyze.ts:88-104`).

---

## 2. Response shape (field-by-field, nullability)

Source `types.ts:178-189`, mirrored client-side. Assembled `index.ts:274-289`.

```
AnalysisResponse {
  analysisVersion: string                    // "10.1.0"
  aoi: { areaKm2: number,                     // geodesic km² (turf, UNROUNDED float64)
         centroid: [number, number],          // [lon,lat] (turf, UNROUNDED)
         isPointMode: boolean }
  score: AnalysisScore
  sections: { resource, climate, validation, grid, context }  // each Section<T>
}
Section<T> = { status: "ok" | "unavailable", data: T | null }  // data null iff unavailable
```

- **score**: `value` 0–100 int; `confidence` `high|medium|low` (mirrors mast badge, **never in
  arithmetic**, defaults `"low"` when validation unavailable); `components[]` always 4, fixed
  order `resource, cf, grid, terrain`, each `{key, weight, raw:number|null, normalized (unrounded),
  points (1dp)}`.
- **resource**: degrades **whole** if GWA fetch/compute fails. `meanSpeed,min,max,p25,p50,p75,
  areaExceedance90` m/s; `powerDensity|null`, `powerDensityRaw|null`; `airDensity`;
  `cfIec3|null`, `cfIec2|null`; `shearAlpha`; `weibull:{A,k}|null`; `indiaPercentile|null`;
  `siteClass: excellent|good|moderate|marginal`.
- **climate**: `rose[16]`, `monthly[12]`, `diurnal[24]`. **Flag-gated OFF by default**
  (`constants.ts:102-103`) → in default deployment ALWAYS `{status:"unavailable", data:null}`.
- **validation**: `mastCountInAoi`; `nearestMast:{station,distanceKm,maws,mawpd:number|null,
  heightM,id}|null`; `modelDeltaPct:number|null` (null when nearest mast > 25 km, **unrounded**
  distance compared); `confidence`.
- **grid**: `nearestSubstation:{name|null,voltageKv|null,distanceKm}|null`;
  `nearestLine:{voltageKv|null,distanceKm}|null`; `ehvWithin25Km:boolean`;
  `dataNote="OSM-derived; may be incomplete"`. (Score-only `nearestEhvKm` stripped — `index.ts:235-246`.)
- **context**: `unavailable` if resource artifacts absent. `states:[{name,installedMw:number|null,
  potentialMw:number|null}]`; `windfarms:{count,overlapFraction}`; `terrain:{...}|null`;
  `sizing:{capacityMw,energyGwh,assumptions[]}` (not nullable). (Score-only `slope90thDeg` stripped.)

**Degradation→score:** score reads stats via `?? null`; any null → 0 points. An all-unavailable
response still returns 200, `score.value` ≈ 0, `confidence:"low"`. **Section failures NEVER 500.**

---

## 3. Pipeline / orchestration (`index.ts`)

Wall budget `ANALYSIS_BUDGET_MS = 15_000`. Dependency graph:

```
t0 ─┬─ grid      (races full 15s budget)
    ├─ climate   (flag-off → resolved unavailable, no fetch)
    └─ resource  (7 GWA layer patches ∥ Weibull COG means → mask → stats)  [GATES the rest]
          └─ on remaining budget (floored at 250ms):
               ├─ validation (needs resource.shearAlpha — the 4-dp ROUNDED value)
               └─ context    (reuses resource's elevation patch + AOI mask)
```

- **Degradation:** `runSection()` races work vs a per-section budget; any throw/timeout →
  `unavailable` (logged, never thrown). **No single top-level 15s wall timer** — each section
  races its own copy; dependents start only after resource resolves. Budgets NOT uniform.
- **Result cache:** key `md5(JSON.stringify(canonical ring) + ANALYSIS_VERSION)`, **NO TTL**,
  layout `{base}/analysis/{key[0:2]}/{key}.json`, temp+rename, size cap `RESULT_CACHE_MAX_MB=500`.
- **Ordering:** fixed section key set; fixed 4-component order; `states[]` sorted by name; climate
  arrays positional. No nondeterministic ordering.

---

## 4. Scoring (verbatim — `score.ts`, `constants.ts`)

`value = Math.round(Σ weight·normalized)` over **unrounded** normalized. `points =
round1(weight·normalized)` display-only. Null/non-finite raw → `{raw:null, normalized:0, points:0}`.

| Component | Weight | normalized | full | zero |
|---|---|---|---|---|
| resource | 45 | `clamp01((v−4.5)/3.0)` | ≥7.5 m/s | ≤4.5 |
| cf | 25 | `clamp01((cf−0.12)/0.26)` | ≥0.38 | ≤0.12 |
| grid | 20 | `clamp01((50−d)/40)` **inverted** | ≤10 km | ≥50 |
| terrain | 10 | `clamp01((20−s)/15)` **inverted** | ≤5° | ≥20° |

Weights `constants.ts:73-78`; **breakpoints in `score.ts:55-69`, NOT constants.ts** (v2
India-calibrated). Worked example (plan §3): `7.4, 0.34, 8.2, 3.1` → `43.5/21.2/20/10` → **95**.

**`siteClass` is separate** (`resource.ts:141-146`, bands `constants.ts:86-90`): excellent ≥8,
good ≥7, moderate ≥6, else **marginal** — on the **2-dp-rounded** meanSpeed. 4 classes, no POOR.

---

## 5. Section algorithms

- **A · resource** (`resource.ts`, JS): mean/min/max/p25/p50/p75 + `areaExceedance90` (10th-pct,
  R-7) over in-mask finite pixels; shear α = least-squares slope of ln(v)/ln(h) over 50/100/150 m,
  clamp [0,0.6], 1/7 fallback; air density `1.225·(1−2.2558e-5·h)^5.256`; power = pd100·ρ/1.225;
  CF clamp ≥0; India pct via 101-quantile CDF; Weibull A/k (`weibull.ts`, EPSG:4326, own ray-cast
  + Lanczos gamma, A/k **unrounded**, gamma NOT re-invoked at request time).
- **B · climate** (`climate.ts`): OFF by default; commercial Open-Meteo only; 16 rose + 12 monthly
  + 24 diurnal; cached forever.
- **C · validation** (`validation.ts`): PostGIS `windmills`. GWA ws100 at mast pixel,
  shear-adjust to mast height with **rounded** α, delta `((maws−model)/model)·100`, suppressed
  >25 km (unrounded), confidence high(≥2@20km)/medium(≥1@25km)/low. See `QUERY_INVENTORY.md`.
- **D · grid** (`grid.ts`, **all in-JS over OSM MVT, NOT PostGIS**): expanding-ring [10,25,50,100]
  km from **centroid**; substation dist = **haversine**, line dist = **equirectangular**
  point-to-segment; EHV ≥220 kV via `max(voltage,voltage_2,voltage_3)`; reported `voltageKv` =
  primary `voltage` only.
- **E · context** (`context.ts`): states via in-JS even-odd point-in-polygon of centroid+vertices
  (point sampling, not true intersection); farm overlap by rasterizing onto z10 pixel grid
  (pixel-count fraction); terrain slope via central differences (per-row mercator pixel size);
  sizing `usable=area·(1−overlap)·0.7`, `capacity=usable·5`, `energy=capacity·8.76·cfIec3`;
  StateCapacity from PostGIS + hardcoded fallback.

---

## 6. Geometry validation (`geometry.ts`) — all in-JS via turf, NO PostGIS

outer-ring-only → auto-close → vertex cap ≤100 (ring **as sent**) → canonical 6-dp (−0→0) →
consecutive dedupe → self-intersection (`@turf/kinks`) → geodesic area caps 1–2500 km²
(`@turf/area`) → India bbox per-vertex `[67,6,98,38]` → centroid (`@turf/centroid`, vertex-mean)
+ bbox + point-mode fingerprint (4 axis-aligned corners, 24–26 km²). **No `ST_MakeValid`/
`buffer(0)` — invalid geometry REJECTED, never repaired.** Cache key = `md5(JSON.stringify(ring)
+ "10.1.0")`, **no delimiter**.

---

## 7. WHERE EACH CALCULATION RUNS (the §4.2 tolerance decider)

| Step | Engine | Parity strategy |
|---|---|---|
| validate / area / centroid / kinks | **JS — turf** (geodesic degrees; centroid = vertex-mean) | match **turf**, not Shapely planar; booleans exact, area/centroid ≤1e-4 |
| cache key md5 | JS — Node crypto | identical string, exact |
| GWA fetch/decode/stitch | JS — geotiff + manual | float64; exact pixel `Math.floor` |
| AOI pixel mask | JS — even-odd ray cast on pixel **centers** | port both ray-casts (mask + weibull); `−0.5` offset exact |
| resource stats / shear / air ρ / percentiles | JS | float64, replicate rounding **order** (`FP_AUDIT.md`) |
| Weibull A/k | JS over **EPSG:4326** COG window | separate CRS from 3857 tiles |
| terrain slope / farm overlap / sizing | JS | float64, per-row mercator pixel size |
| grid distances | JS — **haversine + equirectangular**, centroid anchor | not PostGIS; equirectangular≠geodesic |
| **mast distance/count** | **PostGIS** (`ST_DWithin::geography`, `ST_DistanceSphere`, KNN `<->`, `ST_Intersects`) | **identical SQL** → exact ≤1e-6 |
| StateCapacity read | PostGIS | identical SQL |
| score | JS pure | exact 1e-9 |
| serialization | `res.json` → `JSON.stringify` (NaN/Inf→null) | custom encoder non-finite→null (`FP_AUDIT.md`) |
