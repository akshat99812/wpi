# GOLDEN CORPUS & PERFORMANCE BASELINE PLAN (runbook §1.4 + §1.5)

Corrected for the **real** engine: there is **no heatmap / cell array / cell ordering** to snapshot.
A fixture captures the **single-AOI** response — `score` + the 5 scalar sections — for one request.

> **STATUS: CAPTURED + VALIDATED (2026-06-18).** 10 fixtures captured from the live legacy
> endpoint (`:3005`, climate flag OFF) under `golden/<name>/`. Parity invariants all pass:
> MISS==HIT byte-identical (cache round-trip), sha256 verified, no `NaN`/`Infinity` tokens,
> `analysisVersion 10.1.0`, 5 sections + 4 score components, climate `unavailable`.
>
> | fixture | result | key fields |
> |---|---|---|
> | excellent_muppandal_point | 200 score **90** | `excellent`, ms **9.72** (golden 8.7–10.3 ✓), conf **high**, 4 masts, EHV✓, isPointMode✓ |
> | marginal_bhadla_point | 200 score 53 | `marginal`, ms 5.91 (golden 5.5–6.5 ✓) |
> | moderate_interior_tn | 200 score 48 | actually `marginal` (AOI mis-named; real frozen response) |
> | large_aoi_tn | 200 score 41 | `marginal`, multi-tile stitch |
> | tiny_aoi | 200 score 40 | `marginal`, ~1 km² |
> | ocean_nodata | 200 score **0** | **resource `unavailable`** (degrade-not-throw ✓) |
> | err_out_of_india | 400 `OUT_OF_INDIA` | code ✓ |
> | err_area_too_large | 400 `AREA_TOO_LARGE` | code ✓ |
> | err_self_intersecting | 400 `SELF_INTERSECTING` | code ✓ |
> | err_area_too_small | 400 `AREA_TOO_SMALL` | code ✓ |
>
> These are now the **frozen parity oracle** for the FastAPI port. `score.test.ts`/`index.test.ts`/
> `golden.test.ts` remain the code-level oracle (`RECONCILIATION_AND_DEFERRED.md` Part 3).
> **§1.5 perf timing** is the only remaining Gate-1 item — re-run `capture.sh` with `curl -w
> '%{time_total}'` added (MISS cold vs HIT warm) once you want the baseline numbers.

---

## 1. Fixture format

`MIGRATION/golden/<name>/`:
- `request.json` — the exact `{ "geometry": { "type":"Polygon", "coordinates":[ring] } }` body.
- `response.json` — the exact 200 body from the **legacy** endpoint (frozen truth).
- `response.sha256` — `sha256(response.json bytes)` so accidental edits are obvious.
- `meta.json` — `{ cacheHeader, statusCode, capturedAtIso, analysisVersion }` (capturedAtIso is
  ISO-8601, supplied externally — the engine itself has no clock in the payload).

Freeze with `ANALYSIS_VERSION = "10.1.0"`; re-capture on any version bump.

---

## 2. Coverage matrix (valid for THIS engine)

**Site-class spread (each a real Indian AOI):**
- `excellent` — Muppandal TN (~77.55, 8.26) — also the `golden.test.ts` live anchor.
- `good` / `moderate` — interior TN/Karnataka plateau sites.
- `marginal` — Bhadla Rajasthan (~71.92, 27.53) — the `golden.test.ts` low anchor.

**Per-section ok AND degraded paths (the degradation contract is core to parity):**
- climate **unavailable** (default flag-off) — every fixture exercises this.
- validation **ok** (mast within 25 km, confidence high) vs **no mast** (`nearestMast:null`,
  `modelDeltaPct:null`) vs DB-down (section unavailable).
- grid **ok** (sub+line found, `ehvWithin25Km:true`) vs nothing-found (nulls).
- context **ok** vs resource-artifacts-absent (context unavailable).
- resource **unavailable** — an all-nodata AOI (ocean) → ws100 empty in-mask → 200 with
  `resource.status:"unavailable"`, `score.value` ≈ 0, `confidence:"low"`.

**Entry modes & geometry:**
- point-mode 5×5 km click square (`isPointMode:true`) vs hand-drawn polygon.
- tiny AOI (~1 km², near `AOI_MIN_KM2`) vs large AOI (~2500 km², near `AOI_MAX_KM2`).
- AOI spanning multiple z10 GWA tiles (stitch boundary).
- Weibull-absent case (`weibull:null`) by pointing at a region outside the COG coverage, OR by
  temporarily moving `data/gwa/*.tif` (then restore).

**400 error contract (no upstream needed — validate the `code`s):**
- area < 1 km² → `AREA_TOO_SMALL`; area > 2500 km² → `AREA_TOO_LARGE`.
- vertex outside `[67,6,98,38]` → `OUT_OF_INDIA`.
- self-intersecting ring → `SELF_INTERSECTING`.
- >100 vertices → `TOO_MANY_VERTICES`.
- malformed body → `INVALID_GEOMETRY`.
- Capture each `{status:400, body:{error,code}}` as a fixture too (error behavior is part of parity).

---

## 3. Capture procedure (BLOCKED — run when the legacy stack is up)

```bash
# 0. Prereqs: API running (default :3005), PostGIS up with windmills ingested,
#    GWA tiler reachable, data/gwa/*.tif present. Climate stays flag-off.
# 1. Obtain a Pro session cookie (Better Auth). Either log in via the web app and copy the
#    session cookie, or use a PRO_ALLOWLIST_EMAILS account. Export it:
export PRO_COOKIE='better-auth.session_token=...'

# 2. For each AOI in the matrix, POST and freeze the response + hash:
curl -s -X POST http://localhost:3005/api/analyze \
  -H 'Content-Type: application/json' -H "Cookie: $PRO_COOKIE" \
  -d @MIGRATION/golden/<name>/request.json \
  -o MIGRATION/golden/<name>/response.json -D MIGRATION/golden/<name>/headers.txt
shasum -a 256 MIGRATION/golden/<name>/response.json | awk '{print $1}' \
  > MIGRATION/golden/<name>/response.sha256
# Note: hit each AOI TWICE — first MISS warms the cache, second confirms HIT parity
# (X-Analysis-Cache header in headers.txt). The HIT body must byte-match the MISS body.
```

A small driver script (`MIGRATION/golden/capture.ts` / `.sh`) iterating the matrix is the clean
way; left unbuilt until the environment exists so it can be tested against real responses.

---

## 4. Performance baseline (runbook §1.5 — BLOCKED, template ready)

`MIGRATION/PERFORMANCE_BASELINE.md` — for each golden fixture, from the **legacy** engine:

| Metric | How |
|---|---|
| total request ms | `curl -w '%{time_total}'`, cache **MISS** (cold) and **HIT** |
| per-stage ms | from the `[analysis] section=<name> ms=…` server logs (`index.ts:103`) |
| section concurrency | confirm grid/climate/resource overlap; validation/context after resource |
| DB query count | 3 max (Q1 counts, Q2 nearest, Q3 StateCapacity) — see `QUERY_INVENTORY.md` |
| peak memory | RSS sample during a large-AOI MISS |
| upstream tile count | GWA: 7 layers × tile-cover; power MVT: expanding-ring tiles fetched |

After migration, compare so "parity = yes" can't hide "5× slower". Target (§8): equal or better.

---

## 5. EXPLAIN ANALYZE (runbook §1.6 — BLOCKED)

The three SQL plans (Q1/Q2/Q3 in `QUERY_INVENTORY.md`) must be captured once the DB is reachable
and asserted to use `idx_windmills_geom` (no Seq Scan). Command template is in that file.

---

## 6. What unblocks this

1. `docker compose up` the PostGIS + API stack; ingest `windmills` (`scripts/ingest-windmills.ts`).
2. Ensure `data/gwa/*.tif` present (`scripts/fetch-weibull-cogs.ts`) and the GWA tiler reachable.
3. A Pro session cookie.
Then the matrix capture + perf baseline + EXPLAIN can all run in one sitting, completing Gate 1.
