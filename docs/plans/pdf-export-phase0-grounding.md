# Site-Analysis PDF Export — Phase 0 Grounding Document

**Status:** authoritative recon consolidation for `pdfPlan.md`. Supersedes every placeholder signature/path in that plan. Branch: `feat/exclusion-zones`. Repo root: `/Users/akshatpatel/Desktop/wind/wce`.

This document replaces the plan's §1 Assumptions and §2 file tree with verified reality. Where the plan and a recon report conflict, the conflict is noted and the better-evidenced answer is chosen. Anything not directly confirmed in a recon report is marked **UNVERIFIED — confirm before use**.

---

## Stack reality (A1–A8 verdicts)

| # | Plan assumption | Verdict | Real fact |
|---|---|---|---|
| **A1** | Monorepo `apps/api` (Node+TS) + React web app (`apps/web`) holding `AnalysisResults.tsx`. | **partial** | Two-app layout is real: `apps/api` (Bun+TS+Express) and `apps/web` (Next.js + React 18). BUT: **not a Bun workspace monorepo** — two **independent** standalone packages, no root `package.json`. Deps go directly into `apps/api/package.json`. And `AnalysisResults.tsx` is at `apps/web/components/Map/components/AnalysisResults.tsx`, **NOT** `apps/web/src/features/site-analysis/`. |
| **A2** | Engine exposes `computeWindCuf`, `scoreWind`, `screenWind`, `windIrrRange`. | **partial / names wrong** | Real exports (all in `apps/api/src/services/analysis/`): `windCuf(ws)` + const `WIND_CUF_CURVE` (`windCuf.ts`); `windScore(...)` + `toAnalysisScore(...)` (`windScoring.ts`); `windFinancials(...)`, `windIrrRange(...)`, `irr(...)`, `npv(...)`, `mulberry32(...)`, `windEffectiveTariff(...)` (`windFinance.ts`); `screenWind(...)` (`screenWind.ts`). **There is NO standalone `windIrrRange.ts`** — `windIrrRange` lives **inside `windFinance.ts`**. PR1 edits land in `windFinance.ts`. |
| **A3** | PostGIS via knex/prisma/drizzle/raw `pg`. | **partial** | Raw **`pg` (node-postgres)**, single shared pool: `apps/api/src/lib/db.ts` exports `{ pool, dbAvailable }`, `pool.query(sql, params)` with `$1` params. (Prisma exists but only for the attribute-only `StateCapacity` table — no geometry.) |
| **A4** | A `states`/admin-boundary table exists or must be added. | **true (exists)** | `wce.jurisdiction` (migration `apps/api/migrations/004_policy_comparison.sql`) — `GEOMETRY(MultiPolygon, 4326)`, GIST-indexed (`idx_jurisdiction_geom`), populated from `apps/api/data/cache/india_states.geojson` by `seed-policy.ts`. **Data-dependency caveat:** only national + 8 wind states (TN, GJ, KA, RJ, MH, KL, AP, MP) are seeded; an AOI in any other state intersects no row. Adding the rest is a seed change, not a schema change. Do **not** reuse `context.ts::statesForAoi` (JS vertex-sampling ray-cast) for the report — use real `ST_Intersects` against `wce.jurisdiction`. |
| **A5** | MapLibre initialized with style + tile/DEM sources + token. | **partial / no token** | Style = hardcoded public URL `"https://tiles.openfreemap.org/styles/liberty"` (OpenFreeMap, no API key, no style env var) in `apps/web/app/(portal)/geospatial/pro-map/page.tsx` (~line 519). Only env var is `NEXT_PUBLIC_API_URL` (default `http://localhost:3005`), used by `transformRequest` to inject `credentials:"include"` on `/api/*` tile fetches. DEM = AWS terrarium (`terrain-dem` source, `demShared.ts`). **All data layers are added imperatively in `map.on("load")`, not in the style JSON. `preserveDrawingBuffer` is NOT set — capture needs a fresh offscreen map with it on. Terrain is OFF by default.** |
| **A6** | API has auth/session + request-validation convention. | **true** | Auth = `requirePro` (**an array** `[userAuth, proCheck]` — must be **spread** `...requirePro`), Better-Auth session → `req.user` (`AuthedUser`, `req.user.id`/`req.user.email`). 401 `{error:"Unauthorized"}`, 403 `{error:"Pro subscription required"}` come free. Validation = zod v4 `safeParse` at boundary → `400 {error, code}`, then `validateAoi` throwing `GeometryError` → `400 {error, code}`. Files: `middleware/requirePro.ts`, `middleware/userAuth.ts`, `lib/auth-helpers.ts` (`isPro`), `services/analysis/geometry.ts`. |
| **A7** | Analysis results persisted (have id) OR cheaply recomputable. | **false (no id) → recompute** | **No analysisId anywhere.** `AnalysisResponse` has no `id`; result lives only in client React state (`useAoiAnalysis.ts`), recomputed from the AOI ring via `postAnalyze(ring)` → `POST /api/analyze`. The `/report` endpoint must take **geometry** (`{geometry:{type:"Polygon",coordinates:[ring]}}`) or the already-computed `AnalysisResponse`. No client-supplied finance `inputs` — the panel uses server-side `WIND_CONFIG`. |
| **A8** | Package manager + test runner known (`pnpm` + `vitest`). | **false** | Package manager = **Bun** (`bun.lock` text JSON, `oven/bun:1` Docker). Test runner = **`bun test`** (`import { test, expect } from "bun:test"`) — no vitest/jest, no `test` script, invoked via `Makefile` (`test: cd apps/api && bun test`). Tests colocated `*.test.ts` (26 existing). No `apps/api/test/` dir, no CI for API tests (`.github/workflows/e2e.yml` runs Playwright on `apps/web` only). |

---

## Real engine surface

The `ReportModel` MUST be built from these exact types. All paths under `apps/api/src/services/analysis/`.

### `analyzeAoi` — the entry point (`index.ts:179`)

```ts
export async function analyzeAoi(
  aoi: ValidatedAoi,
  options: AnalyzeOptions = {},
): Promise<AnalysisResponse>
```

- **Never rejects** for a section error; failed/timed-out sections degrade to `{status:"unavailable", data:null}`.
- Input `ValidatedAoi` (`types.ts:48`) — produced by `validateAoi(geometry)`, NOT raw GeoJSON:
  ```ts
  interface ValidatedAoi {
    ring: [number, number][];                  // closed outer ring, lon/lat, 6-dp
    areaKm2: number;
    centroid: [number, number];                // [lon, lat]
    bbox: [number, number, number, number];    // [W, S, E, N]
    isPointMode: boolean;
  }
  ```
- `AnalyzeOptions` (`index.ts:50`) extends `TileFetchOptions`; documented field is `budgetMs?` + injectable `fetchImpl`.

### `AnalysisResponse` — the public contract (`types.ts:239`)

```ts
interface AnalysisResponse {
  analysisVersion: string;                  // = ANALYSIS_VERSION ("11.0.0")
  aoi: { areaKm2: number; centroid: [number, number]; isPointMode: boolean };
  score: AnalysisScore;                     // ALWAYS present (zeroed when ws null)
  financials: WindFinancials | null;        // null when ws unavailable
  irrBand: IrrBand | null;                  // null when ws unavailable
  sections: {
    resource:   Section<ResourceData>;
    climate:    Section<ClimateData>;
    validation: Section<ValidationData>;
    grid:       Section<GridData>;
    context:    Section<ContextData>;
  };
}
type SectionStatus = "ok" | "unavailable";
interface Section<T> { status: SectionStatus; data: T | null; }
```

**CRITICAL contract notes:**
- The response echoes only `aoi.{areaKm2, centroid, isPointMode}` — **NOT `ring`/`bbox`.** To draw the AOI polygon on a PDF map, the report needs the original `ValidatedAoi.ring`/`bbox` from the input.
- **The `ws == null` (absent resource) path:** `score` is present but `{value:0, rating:"Poor", cuf:null, components:[…raw:null,points:0…]}`; `financials` and `irrBand` are `null`. **The PDF MUST branch on `cuf === null` (or `sections.resource.status === "unavailable"`), NOT on `value === 0`.** (Plan decision D4 confirmed correct and load-bearing.)

### Section payloads

```ts
// ResourceData (types.ts:87) — Section A. meanSpeed is THE `ws` driving score+finance.
interface ResourceData {
  meanSpeed; minSpeed; maxSpeed; p25Speed; p50Speed; p75Speed; areaExceedance90;   // m/s @100m
  powerDensity:number|null; powerDensityRaw:number|null; airDensity;               // W/m², kg/m³
  cfIec3:number|null; cfIec2:number|null;
  cfPowerCurve:{iec1;iec2;iec3}|null;
  cfNet:{grossCf;wakeLossFraction;otherLossFraction;lossBuckets:{availability;electrical;soiling;curtailment};netCf}|null;
  cfExceedance:{p50;p75;p90;sigmaTotal}|null;
  shearAlpha; weibull:{A;k}|null; indiaPercentile:number|null;
  siteClass:"excellent"|"good"|"moderate"|"marginal";
}
// ClimateData (types.ts:142) — Section B. FLAG-GATED OFF today → ALWAYS `unavailable`.
interface ClimateData { rose:{sector;freqPct;meanSpeed}[16]; monthly:number[12]; diurnal:number[24]; }
// ValidationData (types.ts:148) — Section C. `confidence` is copied into score.confidence.
interface ValidationData {
  mastCountInAoi:number;
  nearestMast:{station;distanceKm;maws;mawpd:number|null;heightM;id}|null;
  modelDeltaPct:number|null; confidence:"high"|"medium"|"low";
}
// GridData (types.ts:162) — Section D. distances from CENTROID; `nearestEhvKm` STRIPPED from response.
interface GridData {
  nearestSubstation:{name:string|null;voltageKv:number|null;distanceKm}|null;
  nearestLine:{voltageKv:number|null;distanceKm}|null;
  ehvWithin25Km:boolean; dataNote:string;
}
// ContextData (types.ts:173) — Section E. `slope90thDeg` STRIPPED; `terrain.slopeSteep10Deg` IS the 90th-pctile.
interface ContextData {
  states:{name;installedMw:number|null;potentialMw:number|null}[];
  windfarms:{count;overlapFraction};
  turbines:{count;ratedMw:number|null;ratedCount}|null;
  exclusions:{redFraction;amberFraction;categories:{layerCode;cls:"red"|"amber";fraction;km2}[]}|null;
  terrain:{elevMean;elevMin;elevMax;slopeMeanDeg;slopeSteep10Deg}|null;
  sizing:{capacityMw;energyGwh;assumptions:string[];usableKm2;developableFraction;excludedFraction:number|null;steepFraction:number|null};
}
```

### `AnalysisScore` (`types.ts:227`)

```ts
interface AnalysisScore {
  value:number;            // 0–100; 0 when ws==null
  rating:"Excellent"|"Good"|"Moderate"|"Marginal"|"Poor";   // "Poor" when ws==null
  cuf:number|null;         // fraction 0–1; null when ws==null  ← THE null-discriminator
  confidence:"high"|"medium"|"low";
  components:ScoreComponent[];   // always exactly 2: resource(weight 72), grid(weight 28)
}
interface ScoreComponent { key:"resource"|"grid"; weight; raw:number|null; normalized; points; }
```
(`ScoreRating` 5 capitalized values is distinct from `ResourceData.siteClass` 4 lowercase values.)

### Finance/CUF/scoring/MC signatures (`windFinance.ts`, `windCuf.ts`, `windScoring.ts`, `screenWind.ts`)

```ts
// windFinance.ts
const WIND_CONFIG: WindConfig          // 21 fields (capexCr 9, ppa 3.5, omCr 0.13, life 20, recWind 0.35,
                                       //   todMerchantWind 0.4, carbon 0.25, debtFrac 0.75, loanTenure 15,
                                       //   interestRate 0.095, discount 0.1, mcRuns 4000, hoursYr 8766 …)
function mulberry32(seed:number): Rng                  // Rng = () => number; canonical seed 42
function npv(rate:number, cf:number[]): number
function irr(cf:number[]): number | null               // null when no sign change
function windEffectiveTariff(cfg=WIND_CONFIG): number  // ppa+recWind+todMerchantWind+carbon (default 4.50)
function windFinancials(ws:number|null, cfg=WIND_CONFIG): WindFinancials | null
function windIrrRange(ws:number|null, rng:Rng, cfg=WIND_CONFIG): IrrBand | null

interface WindFinancials {                 // top-level `financials`
  irr:number|null; projIrr:number|null; payback:number|null;   // irr/projIrr are FRACTIONS (0.23 = 23%)
  npvCr:number;    // ₹ Cr/MW
  lcoe:number|null;// ₹/kWh
  annualMwh:number;// MWh/yr per 1 MW
  effTariff:number;// ₹/kWh stacked
}
interface IrrBand { p10;p25;p50;p75;p90;n:number; }  // fractions; P25/P75 NOT P20/P80

// windCuf.ts
const WIND_CUF_CURVE: ReadonlyArray<readonly [number,number]>   // 9 knots [ws@100m, cuf], [4,0.25]…[9,0.46]
function windCuf(ws:number|null): number | null                 // single scalar; clamps ≤4→0.25, ≥9→0.46

// windScoring.ts
interface WindScore { score;res;grid;cuf;rating:ScoreRating; }
function windScore(ws:number|null, lineKm:number|null, subKm:number|null): WindScore | null
function toAnalysisScore(s:WindScore|null, confidence:ScoreConfidence): AnalysisScore

// screenWind.ts — the ONLY caller of windFinancials/windIrrRange; fixes MC_SEED = 42
interface WindScreening { score:WindScore|null; financials:WindFinancials|null; irrBand:IrrBand|null; }
function screenWind(ws:number|null, lineKm:number|null, subKm:number|null): WindScreening
```

**What the engine does NOT return (must be recomputed for figures):**
1. **20-yr cashflow waterfall** — `cashflowModel(...)` in `windFinance.ts` (~120–177) builds per-year `eqCF[]`/`projCF[]` but is module-private and returns scalars only. Cumulative-cashflow / payback chart needs this exposed.
2. **MC raw draws / histogram** — `windIrrRange` collects `rs:number[]` (4000 draws) then reduces to 5 percentiles and discards them. Histogram needs the array surfaced.
3. **Tornado / OAT sensitivity** — does not exist anywhere. Build over `windFinancials` (PR2).
4. **CUF curve** — already derivable: `WIND_CUF_CURVE` + `windCuf(ws)` sweep. No engine change needed.
5. Tariff-stack breakdown, full `WindConfig` assumptions, `nearestEhvKm`, `slope90thDeg`, AOI `ring`/`bbox`, render timestamp/provenance — live in module constants or the input, not the response.

---

## Phase 1 gap analysis (what to build)

### PR1 — MC IRR histogram (Phase 1.1)
- **Reuse:** `windIrrRange(ws, rng, cfg)` in **`windFinance.ts`**. The 4000-run loop already collects `rs:number[]`; the private `pctile()` helper is reusable. `IrrBand` already returns P10/P25/P50/P75/P90 + `n`. Seed pinned via `screenWind.ts` `MC_SEED=42`.
- **Missing:** the histogram (`{binEdges, counts}`) and/or raw `draws[]` — `rs` is discarded before return.
- **Approach:** extend `IrrBand` (or add sibling `windIrrDistribution`) to surface `histogram:{binEdges:number[];counts:number[]}` (≤24 bins) from the in-scope `rs`; gate raw `draws[]` behind a debug opt. **Percentiles must stay byte-identical.** Bands are P10/P25/P50/P75/P90 — no P5/P95/P20/P80.

### PR2 — Tornado sensitivity (Phase 1.2)
- **Reuse:** baseline = `windFinancials(ws, cfg).irr` (the only exported path reproducing the headline; `cashflowModel` is private).
- **Plan ASSUMPTION CORRECTION:** plan says "all eight sampler variables". Reality: `windIrrRange` makes 8 `tri()` calls but they map to **6 economic dimensions** — PPA/REC/TOD/carbon are summed into the effective tariff, not swept independently in the MC. Each IS a separate `WindConfig` field so each *can* be a tornado bar, but MC and tornado differ here.
- **Approach:** new `windSensitivity.ts`. For each leverable field, call `windFinancials(ws, {...cfg, field:low})` / `{...cfg, field:high}` (immutable spread) and record ΔIRR vs headline. **Use the same triangular bounds as `windIrrRange`:** PPA [3.3,3.7], REC [0.25,0.45], TOD [0.3,0.52], carbon [0.15,0.32], O&M [0.12,0.15], interest [0.085,0.105], CAPEX [8.5,9.5], CUF ±[0.92,1.08]. **CUF/wind-speed is NOT a `WindConfig` field** — that arm perturbs the `ws` argument, not `cfg`.

### PR4 — Nearby-better-site (Phase 1.3)
- **Reuse:** `windScore` + `screenWind` for scoring; the batched-spatial pattern in **`developable.ts:77-114`** (`WITH aoi AS (...)` + `&&` GIST prefilter + `ST_Intersects`); `pool.query` from `lib/db.ts`. For raster wind reads, `resource.ts`/`tiles.ts` (GWA tiler at `constants.ts` `GWA_TILER_BASE`).
- **Missing:** the whole candidate search + ranking is net-new (`nearbySite.ts`).
- **Approach:** bounded candidate set (≤24 points), single batched PostGIS KNN/`<->` over a `VALUES` list (never N loop queries), batch raster reads, `windScore`+`screenWind` each, rank, keep strictly-better, own timeout degrading to `{found:false}`. Caching = in-process LRU + in-flight dedupe (no Redis), polish not launch dep. **UNVERIFIED — confirm** whether `resource.ts` exposes a reusable point-sample helper for arbitrary lat/lon; else sample via the GWA tiler directly.

### PR3 — Policy context (Phase 1.4) — **REUSE, do not build from scratch**
- **Verdict: REUSE the already-built policy-comparison feature. Do NOT create `policyData.ts` + `StaticPolicyProvider`.**
- **Reuse — exact names:**
  - States geometry: **`wce.jurisdiction`** — SRID-4326 MultiPolygon, GIST-indexed, populated. Query `ST_Intersects(j.geom, ST_SetSRID(ST_GeomFromGeoJSON($1),4326))`. **Table EXISTS — not a missing schema dependency.**
  - Policy data: **`wce.policy_dimension` (24 dimensions) + `wce.policy_value` (224 sourced rows)** — carries `source_name`, `source_url`, `raw_excerpt`, `policy_year`, `as_of_date`, `confidence` (a superset of the report's need).
  - Service: **`apps/api/src/services/policy/query.ts`** — `getMeta()` and `getCompare(['national', <stateCode>], year)` with built-in time-travel. Routes at `routes/policy.ts`.
- **Missing:** a thin `policyContext.ts` that resolves AOI→state via `ST_Intersects`, calls `getMeta()`+`getCompare(...)`, maps into the report's `sources`/`asOf`. **Data dependency (not a schema gap):** `wce.jurisdiction` holds only national + 8 states; seed remaining states from `apps/api/data/cache/india_states.geojson`. Degrade to national-only if no state matches.

---

## File-path remap

| Plan path (§2) | Real location / verdict |
|---|---|
| `…/analysis/windCuf.ts`,`windScoring.ts`,`windFinance.ts`,`screenWind.ts` | exist |
| `…/windIrrRange.ts (EXTEND)` | **does NOT exist** — `windIrrRange` is a function inside `windFinance.ts`. PR1 edits `windFinance.ts`. |
| `…/windSensitivity.ts (NEW)` | new file at `apps/api/src/services/analysis/windSensitivity.ts` |
| `…/nearbySite.ts (NEW)` | new file at `apps/api/src/services/analysis/nearbySite.ts` |
| `…/policyContext.ts (NEW)` | new file — but reads `services/policy/query.ts`, NOT a local data file |
| `…/policyData.ts (NEW)` | **DO NOT CREATE** — reuse `wce.policy_*` via `services/policy/query.ts` |
| `apps/api/src/services/report/*` | dir does not exist — create under `apps/api/src/services/report/` |
| `apps/api/src/services/index.ts (wire route)` | wrong file. Routes mount in **`apps/api/src/server.ts`** via `app.use('/api', router)`. New route file = `apps/api/src/routes/siteAnalysisReport.ts` → `router.post("/site-analysis/report", …)`. |
| `apps/web/src/features/site-analysis/AnalysisResults.tsx` | Real: `apps/web/components/Map/components/AnalysisResults.tsx`. Mount Export button above `<ReportDisclaimer/>` (~line 250). `{score,financials,irrBand,sections,aoi}=analysis` already destructured. The `maplibregl.Map` is NOT in scope here (lives in `pro-map/page.tsx` `mapRef`). |
| `apps/web/src/features/site-analysis/report/{mapCapture,exportReport}.ts` | Remap to `apps/web/components/Map/report/…`. **UNVERIFIED — confirm exact subdir.** Fetch mirrors `apps/web/lib/analysis/client.ts::postAnalyze`. AOI helpers in `apps/web/lib/analysis/{geometry,permalink}.ts`. |
| `apps/api/test/report/ (NEW)` | Convention is colocated `*.test.ts`. Prefer `apps/api/src/services/report/*.test.ts`. |
| `Dockerfile (Chromium+fonts)` | Real = `apps/api/Dockerfile` (`oven/bun:1` Debian). Prod: `deploy/docker-compose.prod.yml`, `deploy/update.sh`, nginx `deploy/nginx/api.windpowerindia.com.conf`. |

---

## Tooling decisions

- **Test runner + command:** `bun test`. New suites colocated `apps/api/src/services/report/*.test.ts` and `…/analysis/{windSensitivity,nearbySite}.test.ts`. Run `cd apps/api && bun test`. Templates: `concurrency.test.ts`, `resultCache.test.ts`, `geometry.test.ts`. Drop the plan's `vitest`. **UNVERIFIED — confirm** whether CI should be extended to run API `bun test` (today only `apps/web` Playwright runs in CI).
- **puppeteer vs puppeteer-core:** **full `puppeteer` (bundled Chromium).** Deployment is a long-running `oven/bun:1` container behind nginx on a VPS — not serverless. Launch one warm browser and reuse (plan D5 confirmed).
- **tsconfig change for SSR React TSX in `apps/api`:** **NONE needed.** `apps/api/tsconfig.json` already has `"jsx":"react-jsx"`, `moduleResolution:"bundler"`, `noEmit:true`. SSR via `react-dom/server` compiles as-is. Only action is a dependency one — `apps/api` currently has **zero React**.
- **Dependencies to add (into `apps/api/package.json`):**
  - runtime: `puppeteer react react-dom d3-scale d3-shape`
  - dev: `@types/react @types/react-dom @types/d3-scale @types/d3-shape`
  - **`"trustedDependencies": ["puppeteer"]`** — **mandatory**: Bun skips postinstall by default, so plain `bun add puppeteer` installs WITHOUT Chromium and `launch()` fails. Trusted-deps makes Bun fetch Chromium.
  - **Commit the updated `bun.lock`** (Dockerfile runs `bun install --frozen-lockfile`).
  - **Docker (PR14):** `oven/bun:1` lacks Chromium shared libs — install the OS lib set or distro `chromium` + `PUPPETEER_EXECUTABLE_PATH` (`--no-sandbox` only under container isolation).

---

## Blockers, data deps & open questions

| Item | BLOCKING for PR0? | Detail |
|---|---|---|
| Missing content/figure spec (F1–F22) `…Content-and-DataViz-Plan.md` | **NON-BLOCKING for PR0** (BLOCKING for PR6/PR7) | Referenced in `pdfPlan.md:4`, not in repo. PR0 needs no figure spec. Obtain or write it before PR6. |
| `wce.jurisdiction` covers only 8 states + national | NON-BLOCKING for PR0 (data dep for PR3) | Seed remaining states from on-disk `india_states.geojson`, no migration. |
| Puppeteer-on-Bun runtime risk | NON-BLOCKING for PR0; **smoke-test first** | `apps/api` runs on Bun, not Node. Verify `bun add puppeteer` (with trustedDependencies) + `browser.launch()` early. Fallbacks: `PUPPETEER_EXECUTABLE_PATH` + distro chromium, or a Node sidecar for render. |
| No `analysisId`; endpoint takes geometry/`AnalysisResponse` | NON-BLOCKING (resolves open-Q #2) | Take `{geometry}` and recompute via `analyzeAoi`, or accept the client's `AnalysisResponse`. |
| Map capture: no `preserveDrawingBuffer`, terrain off, layers imperative | NON-BLOCKING (blocks PR9) | Offscreen map created fresh with `preserveDrawingBuffer:true`, replicate `transformRequest`, replay `addSource`/`addLayer` + AOI ring, `enableTerrain()` + await DEM `data` for 3D. AOI ring via `decodeAoiHash(window.location.hash)` or expose from `useAoiAnalysis`. |
| Open-Q #1 (CECL vs CERC), #5 (font/logo), #8 (defaults), #9 (tile redistribution license) | NON-BLOCKING for PR0 | Product-owner questions; PR7/PR11/PR14/GA gating. |

---

## Revised PR0 action list

1. **Smoke-test Puppeteer on Bun FIRST.** Add `puppeteer` + `"trustedDependencies":["puppeteer"]`, `bun install`, run a throwaway `launch()` + `page.pdf()`. If it fails → `PUPPETEER_EXECUTABLE_PATH` + distro chromium; note in PR.
2. **Add dependencies** to `apps/api/package.json` (runtime + dev types above); add `trustedDependencies`; commit regenerated `bun.lock`. (`zod` already 4.4.3.)
3. **Add the feature flag** following the existing convention (`CLIMATE_SECTION_ENABLED = process.env.* === "true"` in `constants.ts`). No central `config.ts`. Add `REPORT_PDF_ENABLED`, default off — either in `constants.ts` or a small `report/config.ts`.
4. **Scaffold `apps/api/src/services/report/`** with stub files: `reportModel.ts`, `renderReportHtml.ts`, `renderPdf.ts`, `browserPool.ts`, `config.ts`, `templates/` placeholder. Do NOT create `policyData.ts` or a standalone `windIrrRange.ts`.
5. **Create route stub** `apps/api/src/routes/siteAnalysisReport.ts` (`router.post("/site-analysis/report", ...requirePro, …)`) and register in `server.ts`. Mirror `routes/analyze.ts`.
6. **Write the engine-surface note into the PR description** (the corrected signatures above).
7. **Verify:** `cd apps/api && bun run build` (tsc, `noEmit`) and `cd apps/api && bun test` (26 suites stay green; stubs compile).

**Guardrails for every later PR:** confirm real signatures from the repo; keep `buildReportModel` pure; close Chromium pages in `finally`; never render `0` for a null resource (branch on `cuf === null`); reuse the policy DB (`services/policy/query.ts` + `wce.jurisdiction`), not a static file; tornado/MC must reuse `windFinancials`/`windIrrRange` exactly so figures agree with the headline.
