# Phase 2 Kickoff — cold-start brief (read this first in the new session)

You are picking up the **Express→FastAPI site-analysis migration** at **Phase 2 (scaffold)**.
Phase 1 is complete; the corrected plan is **[`RUNBOOK_v3.md`](./RUNBOOK_v3.md)**. Read it +
the artifacts below before writing any code.

## Status
- **Gate 1: GREEN.** Discovery done, golden corpus captured + validated (the parity oracle).
- The engine is a **single-AOI scalar screener** (NOT the H3/heatmap mapper the original v2 runbook
  assumed). Internalize `RECONCILIATION_AND_DEFERRED.md` before you trust any prior assumption.

## Read in this order
1. `RUNBOOK_v3.md` §2 — the Phase-2 spec you are executing.
2. `CURRENT_STATE.md` §7 — the where-each-calc-runs (SQL vs JS) table (drives tolerances).
3. `DATA_SOURCES.md` — exact DB/raster/COG/CRS wiring for `/health`.
4. `FP_AUDIT.md`, `QUERY_INVENTORY.md` — needed in Phase 3, skim now.
5. `golden/` — the frozen fixtures you must reproduce in Phase 4.

## Phase 2 goal (no engine logic yet)
A running, healthy, **empty** FastAPI service wired to the **same** PostGIS + **same** rasters.

**First tasks (checklist):**
- [ ] Confirm monorepo convention, then scaffold `services/site-analysis/` per `RUNBOOK_v3.md` §2.1
      (module list has **NO `tiling.py`** — fold GWA tile fetch into `tiles.py`).
- [ ] `pyproject.toml` + lock: fastapi, uvicorn[standard], pydantic, **psycopg[binary,pool]**,
      numpy, rasterio, shapely, pyproj, an MVT decoder (mapbox-vector-tile + protobuf). **No
      geopandas, no h3.** Pin Python 3.12.x.
- [ ] Dockerfile (slim, binary wheels, GDAL env vars) + add to `docker-compose.yml` on the PostGIS
      network; mount rasters read-only; inject the same `DATABASE_URL`.
- [ ] `GET /health`: DB reachable, rasters open read-only, GWA tile 200s, COG CRS=4326 / tiles=3857,
      `india-ws100-cdf.json`=101 quantiles, **config SHA = sha256(constants.ts + score.ts)**.
- [ ] Sync `def` routes + threadpool + **per-thread raster handles**; psycopg3 sync pool ≥4.
- [ ] Restart-free feature flag `SITE_ANALYSIS_BACKEND ∈ {legacy,service}` default `legacy`.
- [ ] **Auth stays in Express** — do NOT reimplement Better Auth; the service runs internal-only.

**Gate 2:** `docker compose up` → `/health` green; sync+threadpool+per-thread-raster in place;
no engine logic. Do not start Phase 3 (porting) until Gate 2 is green.

## Local runtime facts (for testing this session's work)
- Legacy API is live on **`http://localhost:3005`** (note: `.env` says 3001, but it runs on 3005).
- PostGIS: `docker exec wce-postgis-1 psql -U wpi -d wpi` — `windmills` has **1019** masts;
  `StateCapacity` is **absent in dev** (engine uses a hardcoded fallback — replicate it).
- Pro-gated: to hit `/api/analyze`, use the seeded Pro fixture documented in
  `apps/api/scripts/make-pro-user.ts` (`pro@test.com`). Auth obtaining is **user-driven** — the
  permission guard blocks the agent from minting/harvesting sessions; ask the user to sign in.
- Golden corpus: `MIGRATION/golden/<name>/{request.json,response.json,response.sha256}` — the
  Phase-4 oracle.

## Top parity gotchas (the things that bite)
- `aoi.centroid` is turf **vertex-mean**, NOT Shapely planar centroid. `areaKm2`/`centroid`/
  `weibull.A`/`weibull.k` are serialized **unrounded**.
- Serializer must map non-finite floats → `null` (`allow_nan=False` *raises*).
- Reproduce rounding **order**: meanSpeed 2-dp *before* banding/percentile; shear α 4-dp *before*
  the mast delta; chained sizing energy.
- Two grid distance engines (haversine for subs, equirectangular for lines) — keep both; grid is
  **in-JS**, not PostGIS. Only masts + StateCapacity are PostGIS — run that SQL **identically**.
- Climate ships `unavailable` by default (flag off) — every golden fixture confirms it.

## Housekeeping carried over
- Rotate the dev password that was exposed in the prior session transcript.
- Optionally delete the throwaway `akshatpatel@gmail.com` test account (FREE, harmless).
