# DATA_SOURCES — PostGIS tables, DB driver, external rasters/COGs/tiles, integrity (runbook §1.2 + §1.3)

All external inputs are **READ-ONLY**; the analysis engine fetches/reads but never writes back to
PostGIS or any remote source. The FastAPI port must point at the **same** DB and **same** rasters.

---

## 1. PostGIS tables

### `windmills` — NIWE/WRA wind-monitoring **MAST** points (the validation oracle)
`migrations/001_windmills.sql:14-33`. One row = one mast. Source `wra_masts.csv`, ingested by
`scripts/ingest-windmills.ts`. **Migration does `DROP TABLE IF EXISTS ... CASCADE` (destructive
re-run).**
- `geom GEOMETRY(Point, **4326**) NOT NULL`
- `id UUID` (needs `pgcrypto`), `cum_no/sl_no INT`, `state/station/district TEXT`
- `date_commence DATE`, `date_close DATE` (`YYYY-MM-DD`; measurement period — present but unused by the engine)
- `mast_height_m NUMERIC`, `elevation_masl NUMERIC`, `maws_ms NUMERIC` (mean annual wind speed m/s),
  `mawpd_wm2 NUMERIC` (mean annual power density W/m²), `coord_complete BOOLEAN`
- Indexes: `idx_windmills_geom` **GIST(geom)**, `idx_windmills_state` btree(state)

### `wind_turbines` — OSM individual turbines (**NOT on the analysis path**)
`migrations/002_wind_turbines.sql:20-41`. Powers the Pro-map turbine dot layer, not analysis.
`geom GEOMETRY(Point, 4326)`, `UNIQUE(osm_type, osm_id)`, `idx_wind_turbines_geom` GIST.
Migration uses `CREATE TABLE IF NOT EXISTS` (non-destructive).

### `StateCapacity` — **NO SQL migration; defined in Prisma**
`apps/api/prisma/schema.prisma:23-32` (`provider="postgresql"`, `url=env("DATABASE_URL")`).
Columns: `id String @id`, `state String @unique`, `installedMw Float`, `potentialMw120m Float?`,
`potentialMw150m Float?`, `pipelineMw Float?`, `cufPct Float?`, `updatedAt`. **No geom, no SRID.**
Read via raw quoted-identifier SQL `SELECT state,"installedMw","potentialMw120m","potentialMw150m"
FROM "StateCapacity"` (`context.ts:400`). Per `VERIFIED.md:210-212` the **local dev DB carries
only PostGIS + `windmills`**; `StateCapacity` exists only in prod. Absent/empty/error →
hardcoded `STATE_CAPACITY_FALLBACK` 9-state mirror (`context.ts:376-386`).

---

## 2. DB driver — `pg` (node-postgres), NOT Bun.sql

`lib/db.ts:1,11-15`: `new pg.Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis:
30_000 })`. Queries are `pool.query(sql, params)` with `$1..$n` placeholders (NOT tagged
templates). `dbAvailable()` = `Boolean(process.env.DATABASE_URL)` **only — no connectivity ping**;
a set-but-wrong URL returns true, failures surface per-query.

> **MISMATCH:** `apps/api/CLAUDE.md` mandates `Bun.sql` ("Don't use `pg`"), but the real driver
> is `pg`. **FastAPI port:** psycopg3 sync + pool sized ≥ `MAX_CONCURRENT_ANALYSES` (= 4), against
> the same DSN. The pool here is `max:10`.

---

## 3. External raster / tile / GeoJSON inputs

| Source | Location | CRS | Format / detail | Degrade |
|---|---|---|---|---|
| **GWA TiTiler** (wind/CF/PD/RIX/elev) | `https://tiles-stag.ramtt.xyz/titiler/gwa4` ⚠️ **staging** (`constants.ts:22`) | **EPSG:3857** | float32 GeoTIFF XYZ, 256², 1-band, NaN nodata; sampled **z10** | 404→all-NaN; uncached failure → section unavailable |
| **Weibull A/k COGs** | local `data/gwa/IND_combined-Weibull-{A,k}_100m.tif` (≈205/185 MB, gitignored) | **EPSG:4326** | float32, NaN nodata, 250 m (0.0025°) grid; windowed local reads | absent → `weibull:null` |
| **OpenInfraMap power MVT** | `https://openinframap.org/map/power/{z}/{x}/{y}.pbf` | tile (3857) | gzipped MVT, layers `power_line` + `power_substation_point` (skip `power_generator`); voltages already **kV** | tile fail skipped; 7-day TTL cache |
| **India states GeoJSON** | gist raw pinned to SHA `e388c4c…` → `data/cache/india_states.geojson` (≈1 MB) | WGS84 | property `ST_NM`; post-2014 boundaries | fail → states `[]` |
| **Wind-farm boundaries** (proprietary) | local `data/private/boundaries.geojson` (≈229 KB) | WGS84 | rasterized onto AOI z10 grid | absent → `{count:0, overlapFraction:0}` |
| **India ws@100m CDF** | local `data/analysis/india-ws100-cdf.json` (846 B) | — | 101 quantiles q0..q100 (index==percentile) | absent → `indiaPercentile:null` |
| **Open-Meteo** (climate) | `https://customer-archive-api.open-meteo.com/v1/archive` | — | commercial-only; gated on flag **AND** key; 1 yr hourly @100 m | **OFF by default** |

**GWA layer names** (`GWA_LAYERS`, `constants.ts:25-34`): `cf_iec3`, `cf_iec2` (clamp ≥0 — tiny
negatives exist), `ws_mean_hgt50m/100m/150m`, `pd_mean_hgt100m`, `rix` (NaN→0 over flat), `elevation`.
Per-layer maxzoom: wind/CF/PD/RIX **exactly 10** (never request z>10); `elevation` maxzoom 12 but
sampled at z10 with the rest.

**GWA climatology window (years): NOT stated in code** — GWA v4 is referenced
(`build-india-cdf.ts:73`) but the reanalysis time window is undocumented. → see Unclears.

---

## 4. Cross-engine split (which inputs cross the DB boundary)

- **PostGIS (server-side):** only `windmills` mast queries + the `StateCapacity` SELECT.
- **Everything else in-process JS:** GWA tile decode/stitch, AOI mask, resource/terrain stats,
  Weibull COG reads, grid OSM-MVT distances, geometry validation (turf). The FastAPI port reaches
  the same PostGIS for masts/capacity and reimplements the rest in Python float64.

---

## 5. Integrity / SHA-256 pinning status (runbook §1.2 "pin the rasters")

- **No SHA-256/checksum/integrity verification exists for ANY external input.** Only **MD5** is
  used, purely for cache keys (`resultCache.ts:28,57`, `climate.ts:41,357`) — not integrity.
- **Recommend pinning** (these are gitignored / re-fetched at deploy and can change silently):
  - Weibull COGs `IND_combined-Weibull-{A,k}_100m.tif` (≈205.4 / 185.5 MB) — fetched over a 302
    to CloudFront with no content hash.
  - `india_states.geojson` cached copy (URL is commit-pinned but the cache read is unchecked).
  - **GWA TiTiler is a STAGING host** ("stag") — float32 tiles consumed with no integrity check;
    a staging endpoint can change without notice. **Flag for prod hardening.**
- OpenInfraMap MVT + Open-Meteo are inherently mutable live feeds (pinning N/A).

---

## 6. Scoring-config source of truth (runbook §1.3)

**Config is HARDCODED in TypeScript, not in a DB or config file** — and it is **split across two
files**, which a naive "read the config table" port would miss:
- Score **weights** `{resource:45, cf:25, grid:20, terrain:10}` → `constants.ts:73-78`.
- Score **normalization breakpoints** (resource 4.5/7.5, cf 0.12/0.38, grid 10/50 km, terrain
  5/20°) → **`score.ts:55-69`** (module-local consts, NOT in constants.ts).
- Site-class bands `{excellent:8, good:7, moderate:6}` → `constants.ts:86-90`.
- Other thresholds scattered: EHV 220 kV (`grid.ts:58`), search pads (`grid.ts:51`), mast
  20/25/100 km (`constants.ts:81-83`, `validation.ts:51`), area caps / India bbox / vertex cap
  (`constants.ts:39-44`).
- The only **file-backed** config: `india-ws100-cdf.json` (101 quantiles) and the
  `STATE_CAPACITY_FALLBACK` mirror.

**Pin for parity:** take a SHA-256 of `constants.ts` AND `score.ts` (the two config homes) and
assert it at port startup — the runbook's "config SHA-256" must cover both files.
