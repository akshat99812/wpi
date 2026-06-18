# FP_AUDIT — floating-point + serialization parity (runbook §1.7 + §3.1)

The #1 source of parity failures after CRS. Three stages must be reproduced **in order**:
(1) computation rounding, (2) serialization (NaN/Inf→null), (3) display (client-side, out of scope).
`float64` everywhere — no `float32`, no `Decimal`/int truncation except where a `Math.round`
yields an integer-valued field (still serialized as a JSON number).

`roundTo(v,d)` = `Math.round(v·10^d)/10^d`, **non-finite passes through unchanged** (`resource.ts:56-60`).

---

## 0. Serialization (load-bearing fact)

- Success serialization is `res.json(...)` at `analyze.ts:81` (HIT) and `:109` (MISS) — **plain
  `JSON.stringify`, no custom replacer/reviver anywhere** (`server.ts` has only `trust proxy`;
  `express.json()` is the request parser, irrelevant to output). Express 4.18 → `res.json` =
  `JSON.stringify(value, undefined, undefined)`.
- Plain `JSON.stringify` emits **`null`** for `NaN`/`Infinity`/`-Infinity`.
- **Cache round-trip:** disk cache writes via `JSON.stringify` (`resultCache.ts:226`); a HIT
  re-serializes the parsed object — so NaN→null already happened on first write. The port's cache
  must serialize identically (non-finite→null) or a cached payload could differ from a live one.

> **FastAPI port:** Python `json.dumps` default emits `NaN`/`Infinity` literals (invalid JSON);
> orjson **raises** on NaN. Neither matches. Serialize with `allow_nan=False` + a custom encoder
> that maps non-finite floats → `None`, OR sanitize all non-finite floats to `None` pre-serialize.
> **Nuance:** the code already null-guards almost every field before serialization (§3 below), so
> the serializer rule is **belt-and-suspenders** — the *primary* parity mechanism is reproducing
> the null-guard branches; install the serializer fallback too.

---

## 1. Rounding that affects a client-facing value (grouped by field)

### resource (`resource.ts`) — all final-stage, JS over float32→number means
| Field | Rule | dp | Order caveat |
|---|---|---|---|
| `meanSpeed` | `roundTo(meanOf(ws100),2)` | 2 | **rounded BEFORE** `classifySite()` & `indiaPercentileOf()` — banding/percentile use the 2-dp value (`:255→272,293`) |
| `minSpeed`/`maxSpeed` | `roundTo(...,2)` | 2 | |
| `p25/p50/p75/areaExceedance90` | `roundTo(percentileOfSorted(...),2)` | 2 | R-7 linear interp at full precision then rounded |
| `powerDensity` | `roundTo(raw·(ρ/1.225),0)` | 0 | uses **unrounded** `powerDensityRaw` & **unrounded** `airDensity` (`:224-231`) |
| `powerDensityRaw` | `roundTo(...,0)` | 0 | |
| `airDensity` | `roundTo(1.225·(1−2.2558e-5·h)^5.256,3)` | 3 | computed unrounded, used unrounded in correction, then rounded for the field |
| `cfIec3`/`cfIec2` | `roundTo(max(0,mean),4)` | 4 | clamp ≥0 **before** rounding; **score consumes the 4-dp value** (`index.ts:266`) |
| `shearAlpha` | `roundTo(clamp[0,0.6] or 1/7, 4)` | 4 | **validation shear-adjust consumes the 4-dp α** (`index.ts:213`), not the raw slope |
| `indiaPercentile` | `Math.round(...)` | int | `indiaPercentileOf` returns unrounded; `Math.round` happens in `computeResource` (`:292`), not the CDF helper |
| `weibull.A`/`weibull.k` | **NOT ROUNDED** | — | full float64 to client (`:291`) — port must NOT round |
| `siteClass` | banded on the **2-dp** `meanSpeed` | — | excellent≥8/good≥7/moderate≥6/else marginal |

### score (`score.ts`)
- `components[].points` = `Math.round(x·10)/10` (**1 dp**, display only).
- `components[].normalized` = **NOT rounded** (full precision, so exact total recoverable).
- `score.value` = `Math.round(Σ weight·normalized)` over **UNROUNDED** normalized — **NOT** the sum
  of the 1-dp `points` (`:152-157`). Golden tolerance ±0.5.

### grid (`grid.ts`)
- `nearestSubstation.distanceKm`/`nearestLine.distanceKm`/`nearestEhvKm` = `round1` (**1 dp**).
- **Order caveat:** `ehvWithin25Km` flag AND nearest-EHV min selection use **UNROUNDED** distances;
  only the reported fields are rounded (`:524-541,562,577-578`). Score consumes the 1-dp `nearestEhvKm`.

### validation (`validation.ts`)
- `nearestMast.distanceKm` = `roundTo(distance_m/1000, 1)`; **suppression compares the UNROUNDED
  km** vs 25 (`:311`).
- `modelDeltaPct` = `roundTo(((maws−model)/model)·100, 1)`; model uses the **4-dp α**.
- `maws`, `mawpd`, `heightM` = **NOT rounded** (raw from DB).

### context (`context.ts`)
- `windfarms.overlapFraction` = `Math.round(ratio·10000)/10000` (**4 dp**), 0 when insideCount 0.
- `terrain.elevMean/Min/Max` = **integer** (`Math.round`); `slopeMeanDeg`/`slopeSteep10Deg`/score's
  `slope90thDeg` = **1 dp**.
- `sizing.capacityMw` = `Math.round(usable·5·10)/10` (**1 dp**); `sizing.energyGwh` =
  `Math.round(capacityMw·8.76·(cfIec3??0)·10)/10` — **chained rounding**: `round1( round1(capacity)
  · 8.76 · round4(cf) )`. Reproduce exactly (`:334→336`).

### climate (`climate.ts`, off by default)
- `rose.freqPct` 1 dp; `rose.meanSpeed`/`monthly`/`diurnal` 2 dp; `sectorIndexFor` =
  `Math.round(dir/22.5)%16` (half-UP at edges).

### aoi block (`geometry.ts`)
- Ring vertices canonicalized to **6 dp** (−0→0) BEFORE area/centroid/bbox/cache-key
  (intermediate, but its effect is final).
- `aoi.areaKm2` and `aoi.centroid` reach the client **UNROUNDED** (full turf float64), computed
  from the 6-dp ring but not re-rounded.

---

## 2. Truncation / floor that selects WHICH pixels are sampled (affects every raster stat)

- `tileCoverForBbox`: `Math.min(n-1, Math.max(0, Math.floor(v)))` (`mercator.ts:46`).
- `mask.ts centerIndexRange`: `Math.ceil((min)·256−0.5)` start, `Math.floor((max)·256−0.5)` end —
  the **−0.5 is the pixel-center offset**, parity-critical (`mask.ts:93-94`).
- `fetchPointValue`: tile/pixel indices via `Math.floor`, clamped to `[0,255]` (`tiles.ts:326-332`).
- `weibull bboxPixelWindow`: floor/ceil expand outward to whole pixels (half-open) (`weibull.ts:86-90`).
- R-7 percentile splits: `Math.floor(position)` then interpolate (`resource.ts:83`, `context.ts:320`).
- Boundary coercions: `Number()` (pg strings, throws non-finite), `parseFloat` (StateCapacity,
  voltages), `parseInt` (climate time slices). psycopg3 returns Decimal/float — coerce to float,
  reject NaN/Inf identically.

---

## 3. NaN / Infinity / nodata per stage — what could reach `JSON.stringify`

Nodata = `NaN` in the stitched `Float32Array` (`tiles.ts:257`); every consumer filters with
`Number.isFinite` before aggregating.

- **resource:** empty ws100 in-mask → **throws** → section unavailable; cf/pd empty → `null`; shear
  → 1/7 fallback; india pct → `null`. (Residual NaN risk: none, given the empty-array throw.)
- **score:** `raw null || !Number.isFinite(raw)` → `{raw:null, normalized:0, points:0}`; `clamp01`
  bounds; `value` finite. No NaN reaches wire.
- **grid:** `Infinity` sentinels always converted via `Number.isFinite(best)?best:null`. No Inf out.
- **validation:** `toFiniteNumber` throws on non-finite → section unavailable; delta `null` on
  nodata/`v100<=0`. No NaN out.
- **context:** terrain `null` when no finite elevation; overlap `0`; sizing always numeric (cf null
  → `·0`). No NaN out.
- **climate:** every aggregate `count===0?0`; strict upstream rejection. No NaN out.

**Net:** the engine converts non-finite → `null` (or degrades the section) **before** serialization
at essentially every field. Port must (a) reproduce every null-guard branch exactly, AND (b) still
install the non-finite→`null` serializer fallback to match `res.json`.

---

## 4. FastAPI parity checklist
- [ ] `float64` everywhere; no `Decimal`/`float32` on the scoring path.
- [ ] Replicate every rounding **order** above (esp. mean→band, 4-dp α→delta, chained sizing energy).
- [ ] `weibull.A/k`, `aoi.areaKm2`, `aoi.centroid` serialized **unrounded**.
- [ ] Custom JSON encoder: non-finite floats → `null` (`allow_nan=False` is insufficient — it
      raises; map to `None`).
- [ ] Reproduce all per-field `null`-guard branches (the primary mechanism).
- [ ] Match turf area/centroid (WGS84 r=6378137; centroid = vertex-mean), not Shapely planar.
- [ ] Verify against the ocean/nodata golden fixtures (`GOLDEN_AND_BASELINE_PLAN.md`).
