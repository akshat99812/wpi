# RECONCILIATION & DEFERRED — runbook assumptions vs the real engine

**BLUF:** the runbook v2 describes a **cell-based H3 suitability mapper**; the actual engine is a
**single-AOI scalar screener**. ~9 of the runbook's 14 assumed-engine claims are **ABSENT or
DIFFERENT**. The cell/heatmap/pocket/exclusion/UTM machinery does not exist. Acting on the runbook
as written would build the wrong service. (76 total mismatches flagged across the discovery sweep;
the structural ones are in Part 1.)

---

## Part 1 — PRESENT / ABSENT / DIFFERENT (the 14 assumptions)

| # | Runbook assumption | Verdict | Evidence |
|---|---|---|---|
| 1 | H3 tiling / cell grid | **ABSENT** | no `h3`/hexagon/cell-grid anywhere; only "grid" is the z10 web-mercator **pixel** patch `LayerPatch` (`types.ts:22`, `constants.ts:19`) and the OSM power-tile search |
| 2 | Per-cell heatmap + cell ordering | **ABSENT** | response = 1 score + 5 scalar sections (`types.ts:178-189`); only arrays are climate rose/monthly/diurnal and the fixed-4 `score.components[]` |
| 3 | "best-pocket %" | **ABSENT** | nearest real stat is `areaExceedance90` (10th-pct of pixel speeds), a single scalar — explicitly NOT a pocket (`resource.ts:39`, `types.ts:92`) |
| 4 | "top cells" collection | **ABSENT** | no cells exist |
| 5 | 5 classes incl. POOR | **DIFFERENT** | **4 classes, no POOR**: `excellent\|good\|moderate\|marginal` (`types.ts:83`, bands `constants.ts:86-90`); lowest is "marginal" |
| 6 | Exclusion buffers that GATE scoring | **ABSENT (as gating)** | score is a pure weighted sum, no veto (`score.ts:129`); geometry validation rejects whole AOIs (400) but does not gate per-area; windfarm overlap only shrinks sizing area (`context.ts:333`) |
| 7 | Multi-cell aggregation / class breakdown | **DIFFERENT** | whole-AOI scalar reduction over in-mask pixels; `siteClass` is one AOI-wide label, no per-cell breakdown (`resource.ts:248-294`) |
| 8 | UTM-zone handling / reproject to UTM | **ABSENT** | no UTM, no `ST_Transform`; geometry geodesic-degrees (turf), rasters native 3857/4326, PostGIS `::geography` casts |
| 9 | `ST_MakeValid`/`buffer(0)` on AOI | **ABSENT** | validity = turf `kinks` check in JS (`geometry.ts:175,308`); raw ring → PostGIS via `ST_GeomFromGeoJSON`, no repair |
| 10 | Nearest vs bilinear resampling | **DIFFERENT** | always exact-pixel/nearest; no bilinear kernel (`mask.ts:99`, `tiles.ts:330`, `weibull.ts:359`) |
| 11 | Partial-overlap centroid vs area-fraction | **DIFFERENT/mixed** | area for resource/terrain/Weibull; true pixel area-fraction for windfarm; centroid+vertex sampling for states; centroid anchor for grid distance & mast confidence (`context.ts:132`, `grid.ts:21`, `validation.ts:304`) |
| 12 | Config/bands in DB or file | **DIFFERENT** | hardcoded; crucially the score **breakpoints live in `score.ts:56-69`, NOT constants.ts**; no DB/file band config (only the India CDF + state-capacity fallback are file/DB) |
| 13 | Vintage/version stamping | **DIFFERENT** | `analysisVersion` present (`constants.ts:12`) but **no data-vintage field** (no GWA climatology year, climate year, or Weibull date) in the payload |
| 14 | Coastline/ocean nodata fixtures | **PRESENT** | meaningful, but as degrade-to-null / "resource unavailable" when ws100 fully empty in-mask — never a scored exclusion zone (`resource.ts:248`, `weibull.test.ts:263`) |

---

## Part 2 — Consequences for the runbook (rewrite/strike before Phase 2)

| Runbook § | Problem | Action |
|---|---|---|
| §1.4 "large multi-cell AOI (tiling + aggregation + **heatmap ordering**)" | no heatmap/cells | replace with the corrected coverage in `GOLDEN_AND_BASELINE_PLAN.md` (single-AOI scalar snapshot) |
| §3.2 (4) `tiling.py` | no tiling-into-cells stage | the only "tiling" is internal z10 tile fetch — fold into `sampling.py`; delete `tiling.py` as a scoring stage |
| §4.2 "Cell/tile IDs, counts, geometry: exact" | no cell IDs | drop; parity is on the scalar fields + 5 sections |
| §1.1 "best-pocket %, top-cells ordering" | absent | strike |
| 5-class / POOR legend, exclusion-buffer gating, UTM-zone-crossing fixtures | absent | strike or move to the future suitability-spec phase |
| §2.5 sizing | psycopg pool must be ≥ `MAX_CONCURRENT_ANALYSES`=4 (current pg pool `max:10`) | keep, with the real numbers |

What **remains valid and important** in the runbook: parity-first discipline, sync routes +
threadpool + per-thread raster handles, identical SQL in PostGIS, NaN→null serialization, the
golden-corpus oracle, the kill-switch/shadow/cutover sequence, and `DEFERRED_IMPROVEMENTS.md`.

---

## Part 3 — Existing tests = code-level parity oracle (seed the golden corpus from these)

- **`score.test.ts`** — strongest pure-math oracle. Pins every breakpoint (resource
  `clamp((v−4.5)/3)` 0/0.5/1 at 4.5/6/7.5; cf `(cf−0.12)/0.26`; grid `(50−d)/40` full ≤10 zero ≥50;
  terrain `(20−s)/15` full ≤5 zero ≥20), the plan §3 example → **43.5/21.2/20/10, value 95**,
  component order, null/NaN→zero-row, confidence independence, `value==Math.round(Σ w·norm)` ±0.5.
- **`index.test.ts`** — envelope/wiring oracle (hermetic synthetic tiles): section key set
  `[climate,context,grid,resource,validation]`, `analysisVersion`, climate flag-off → unavailable,
  a constant good-site → `EXPECTED_SCORE=80`, degrade-not-throw (section failure → unavailable,
  `value` 0, all `raw:null`, still 200-shaped).
- **`golden.test.ts`** — live band oracle (skippable `SKIP_LIVE=1`). Muppandal (77.55, 8.26):
  meanSpeed 8.7–10.3, cfIec3 0.632–0.712, shearAlpha 0.18–0.30, `siteClass "excellent"`,
  indiaPercentile ≥95, stat ordering, Weibull `A·Γ(1+1/k)` within 5% of mean, mastCount==direct
  SQL count, confidence "high", |delta|≤20, nearest sub/line <5 km, ehvWithin25Km, score 80–95,
  windfarm overlap >0.8 → capacity <20 MW, "Tamil Nadu", isPointMode. Bhadla (71.92, 27.53):
  meanSpeed 5.5–6.5, `siteClass "marginal"`, resource points <22.5, score ≥20 below Muppandal.
- **`validation.test.ts`** — pins `v100·(mastH/100)^α`, `deltaPct` 1-dp + sign, confidence badge.

The migrated engine must reproduce all of these to the digit (pure-math) / within band (live).

---

## Part 4 — DEFERRED_IMPROVEMENTS (noticed, deliberately UNCHANGED this phase)

Replicate faithfully now; these seed the future suitability-spec phase. **A "fix" that changes any
output is a Phase-1 failure.**

1. **Grid distances are centroid-anchored**, not edge-to-feature — large AOIs overstate distance.
   Also substations use **haversine** while lines use **equirectangular** (two engines).
2. **State detection is point-sampling** (centroid + ring vertices), not true polygon intersection —
   a sliver crossing between two vertices can be missed (documented at `context.ts`).
3. **Geometry math is in-JS turf (geodesic degrees)**, not PostGIS — cross-engine area/centroid
   tolerance applies; the port must match turf, not Shapely.
4. **Two independent ray-cast implementations** (mask EPSG:3857, weibull EPSG:4326) — port both;
   they can silently diverge.
5. **GWA tiler is a STAGING host** (`tiles-stag.ramtt.xyz`) with no integrity check; **no SHA-256
   pin** on any external input (Weibull COGs, states GeoJSON). Harden later.
6. **`shearAlpha` docstring vs behavior:** comment says 1/7 fallback is "only if 50/150 m layers
   empty", but `resolveShearAlpha` falls back for ANY non-finite fit (`resource.ts:163-169`).
7. **`elevation` sampled at z10** though its maxzoom is 12 (deliberate; below native res).
8. **`gammaFn` exported but unused at request time** (one-time VERIFIED check only).
9. **No data-vintage in the response** (only `analysisVersion`). Consider adding later.
10. **Climate is flag-OFF** in prod; the entire section ships `unavailable` by default.
11. **Concurrency/size-guard are per-process** (module-level counters) — not cluster-wide; effective
    cap is `4 × instances`.
