# QUERY_INVENTORY — every SQL the engine issues (runbook §1.6)

The FastAPI port must run these **identical SQL strings** against the **same** PostGIS so the
spatial math (GEOS/PostGIS) is byte-for-byte the same engine → exact parity (no cross-engine
tolerance needed on these). All queries are parameterized (`$1..$n`); `DELTA_ELIGIBLE_SQL` is a
**static** string fragment interpolated in (not user input, safe).

Only **three** SQL statements exist in the whole analysis path — everything else is in-process JS.

---

## Q1 — mast counts (validation §C) · `validation.ts:157-166`

Returns 3 counts in one pass: masts inside the AOI, and delta-eligible masts within 20 km / 25 km
of the centroid.

```sql
WITH p AS (SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326) AS pt)
SELECT
  COUNT(*) FILTER (WHERE ST_Intersects(w.geom, ST_GeomFromGeoJSON($1)))           AS in_aoi,
  COUNT(*) FILTER (WHERE w.maws_ms IS NOT NULL AND w.mast_height_m IS NOT NULL
                     AND w.mast_height_m > 0
                     AND ST_DWithin(w.geom::geography, p.pt::geography, $4))       AS within20,
  COUNT(*) FILTER (WHERE w.maws_ms IS NOT NULL AND w.mast_height_m IS NOT NULL
                     AND w.mast_height_m > 0
                     AND ST_DWithin(w.geom::geography, p.pt::geography, $5))       AS within25
FROM windmills w CROSS JOIN p
```
- **Params:** `$1`=AOI Polygon GeoJSON string `{type:"Polygon",coordinates:[ring]}`; `$2`=centroid
  lon, `$3`=centroid lat; `$4`=20000 (m), `$5`=25000 (m) (`MAST_CONFIDENCE_HIGH_KM`/`MAST_DELTA_MAX_KM`
  × 1000).
- **Indexes relied on:** `idx_windmills_geom` GIST. `ST_DWithin(::geography,...)` can use the GIST
  index via the geography KNN/`&&` expansion; `ST_Intersects(...ST_GeomFromGeoJSON...)` uses it too.
- **Distance semantics:** `::geography` → **geodesic meters**. Counts are exact integers (pg returns
  as strings → JS `Number()`).
- **`EXPLAIN ANALYZE` (captured 2026-06-18, dev DB, 1019 rows):**
  ```
  Aggregate (actual time=145.9..145.9 rows=1)
    -> Seq Scan on windmills w (actual time=0.5..5.2 rows=1019)  Buffers: shared hit=20
  Execution Time: 149 ms  (Planning 141 ms — first-call PostGIS catalog warmup; ~5 ms steady)
  ```
  **Seq Scan is CORRECT here** (earlier "assert no Seq Scan" note retracted for this query): at
  1019 rows the `in_aoi` COUNT must visit every row, so the planner rightly skips the GIST index.
  On a production-sized mast table the per-row `ST_DWithin(::geography)` filters would benefit from
  the index, but a full-table aggregate stays a scan. Parity check is on the **counts**, not the plan.

## Q2 — nearest delta-eligible mast (validation §C) · `validation.ts:207-223`

KNN to the single nearest mast (within 100 km) that can produce a model delta.

```sql
WITH p AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS pt)
SELECT
  w.id::text AS id, w.station AS station, w.mast_height_m AS mast_height_m,
  w.maws_ms AS maws_ms, w.mawpd_wm2 AS mawpd_wm2,
  ST_X(w.geom) AS lon, ST_Y(w.geom) AS lat,
  ST_DistanceSphere(w.geom, p.pt) AS distance_m
FROM windmills w CROSS JOIN p
WHERE w.maws_ms IS NOT NULL AND w.mast_height_m IS NOT NULL AND w.mast_height_m > 0
  AND ST_DWithin(w.geom::geography, p.pt::geography, $3)
ORDER BY w.geom <-> p.pt
LIMIT 1
```
- **Params:** `$1`=lon, `$2`=lat, `$3`=100000 (m, `MAST_NEAREST_SEARCH_KM`×1000).
- **THREE distance engines in one query** (a port must preserve all three, do not unify):
  (a) `ST_DWithin(::geography)` geodesic-meter filter; (b) `ORDER BY w.geom <-> p.pt` **KNN
  operator on raw 4326 geometry** (planar/degree ordering); (c) returned `ST_DistanceSphere`
  **spherical meters** → `/1000` km in JS.
- **Parity caveat:** delta-suppression compares the **unrounded** `distance_m/1000` against 25 km
  (`validation.ts:311`), while `nearestMast.distanceKm` is rounded to 1 dp. Reproduce that order.
- **Indexes:** `idx_windmills_geom` GIST drives both the `<->` KNN ordering and `ST_DWithin`.
- **`EXPLAIN ANALYZE` (captured 2026-06-18, dev DB):**
  ```
  Limit (actual time=166.0..166.0 rows=1)
    -> Index Scan using idx_windmills_geom on windmills w (actual time=165.9..165.9 rows=1)
         Order By: (geom <-> $pt)
         Filter: maws_ms NOT NULL AND mast_height_m NOT NULL AND >0
                 AND ST_DWithin(::geography, 100000, true)
  Execution Time: 167 ms
  ```
  **CONFIRMED: Index Scan using `idx_windmills_geom` with the KNN `<->` order** — the GIST index
  drives the nearest-mast lookup as intended, no Seq Scan. The port (same SQL, same PostGIS) gets
  the identical plan. **This is the one query where index health matters** — re-capture in prod.

## Q3 — state installed/potential capacity (context §E) · `context.ts:400`

```sql
SELECT state, "installedMw", "potentialMw120m", "potentialMw150m" FROM "StateCapacity"
```
- **No params.** Quoted camelCase identifiers (Prisma table). `potentialMw` = `potentialMw120m`
  falling back to `potentialMw150m` (`context.ts:410`). Numbers parsed via `parseFloat`.
- **Absent/empty/error → hardcoded `STATE_CAPACITY_FALLBACK`** (`context.ts:388-419`). The dev DB
  typically lacks this table, so most local runs hit the fallback.
- **`EXPLAIN ANALYZE`:** N/A in dev — **`StateCapacity` table does not exist in the local `wpi`
  DB** (confirmed `to_regclass` → null), so the engine takes the `STATE_CAPACITY_FALLBACK` path
  here. In prod it is a trivial full-table scan of a ~9-row table; not a perf risk.

---

## Notes for the port

- These exact strings must be preserved character-for-character (especially the `::geography`
  casts, `ST_GeomFromGeoJSON`, the `<->` KNN, and the `DELTA_ELIGIBLE_SQL` predicate). psycopg3
  parameter style is `%s`, not `$1` — **translate placeholders but not the SQL body**, and keep
  the same parameter order/units (meters).
- pg returns `NUMERIC`/`bigint` as **strings**; the engine coerces with `Number()` and rejects
  non-finite by throwing. psycopg3 returns `Decimal`/`int`/`float`; coerce to `float` identically
  and reject NaN/Inf to match (`validation.ts:124-138`).
- **Largest post-scoring risk (runbook §1.6):** a plan that drops to a Seq Scan in the new service.
  Capture all three `EXPLAIN ANALYZE` plans once the DB is reachable and diff against this file.
