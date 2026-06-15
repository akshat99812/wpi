# Wind Site Analysis v10 — Implementation Plan

> **Audience:** Claude Code. Execute phases in order. Phase 0 is a hard gate — do not write Phase 1+ code until every Phase 0 item is verified and its result recorded in `services/analysis/VERIFIED.md`.

## 1. What we're building

A Pro-gated site-screening feature on the Wind Power India map. The user clicks a point (becomes a 5×5 km square client-side) or draws a rectangle/polygon, and gets a sectioned analysis answering "is this site worth a closer look?" One pipeline serves both entry modes: `POST /api/analyze` with `{ geometry: Polygon }`.

**Product framing constraint:** everything is screening-grade, never bankable. Every estimate carries explicit assumptions. Never use the term "P90" anywhere in code, API, or UI.

## 2. Non-negotiable domain decisions (do not revisit)

These were decided after expert review. Implement exactly as stated.

1. **Capacity factor uses the GWA IEC Class III layer as the India default.** Label: "Indicative Capacity Factor (IEC-III)". If the IEC-II layer is equally available via the same TiTiler path, return both in the response (`cfIec2`, `cfIec3`) and show III as primary, II as secondary. Never default to IEC-II.
2. **Wind speed distribution chart comes from GWA Weibull A and k layers** (area-mean A and k → render the Weibull PDF), NOT from a histogram of pixel mean speeds. The spatial spread across pixels is reported only as a single stat: `areaExceedance90` = "90% of site area exceeds X m/s" (10th percentile of pixel speeds). Do not label any spatial percentile "P90".
3. **Mast validation delta methodology:** delta = (mast measured mean − GWA speed sampled **at the mast's own coordinates**, shear-adjusted to the mast's measurement height using the AOI's α) / GWA value, as ±%. Never compare mast measurement against the AOI-average GWA speed. Present as: "Model runs ±X% vs measurement near this site."
   - Delta is **suppressed** (null) when nearest mast > 25 km.
   - **Confidence badge:** `high` = ≥2 masts within 20 km · `medium` = 1 mast within 25 km · `low` = nothing within 25 km (badge only, no delta).
4. **Power density is air-density corrected** using the elevation grid: ρ = 1.225·(1 − 2.2558e-5·h)^5.256 applied to the GWA power-density value (which assumes sea-level ρ unless Phase 0 finds a GWA density layer — then use that instead). Display corrected value; keep raw value in the response as `powerDensityRaw`.
5. **Indicative sizing:** `usableArea = aoiArea × (1 − windfarmOverlapFraction) × 0.7`; `capacityMW = usableArea × 5`; `energyGWh = capacityMW × 8.76 × cfIec3`. Assumptions block in the response and UI must state: 5 MW/km², 0.7 usable-land fraction, IEC-III class, existing-farm area excluded. If AOI is 100% inside existing farms, sizing returns ~0 with overlap shown — not an error.
6. **Screening Score (0–100), computed server-side:** Resource 45 · CF 25 · Grid 20 · Terrain 10. Response includes the full per-component breakdown (`score.components[]` with weight, raw value, normalized value, points). Validation confidence does NOT feed the score — it is returned separately as `score.confidence` (`high|medium|low`, mirroring the mast badge) and displayed as a chip next to the score.
   - Component normalizations (v2, calibrated to the India ws@100m distribution — median 4.5, q98 7.4 m/s — so the windiest ~2% of sites approach full marks): Resource = clamp((meanSpeed − 4.5) / 3) · CF = clamp((cf − 0.12) / 0.26) · Grid = 1 if EHV ≤ 10 km, linear to 0 at 50 km · Terrain = 1 if slopeP90 ≤ 5°, linear to 0 at 20°.
7. **Draw cap: 2,500 km²** (validated server-side AND enforced live during drawing client-side). Min 1 km². ≤100 vertices, India bbox, non-self-intersecting.
8. **Response budget: 15 s wall clock.** Sections that miss the budget return `status: "unavailable"`; the response still returns 200 with whatever completed.
9. **ERA5/Open-Meteo licensing:** keyless tier is non-commercial; this is a commercial Pro feature. Phase 0 must resolve this (paid API key in env, or section B ships as `unavailable` until resolved). Do not ship section B on the keyless endpoint.

## 3. API contract

`POST /api/analyze` (Pro auth middleware, user-keyed rate limit 20/min)

Request: `{ "geometry": GeoJSON Polygon }`

Response envelope:

```jsonc
{
  "analysisVersion": "10.0.0",
  "aoi": { "areaKm2": 25.0, "centroid": [lon, lat], "isPointMode": false },
  "score": {
    "value": 82,
    "confidence": "high",
    "components": [
      { "key": "resource", "weight": 45, "raw": 7.4, "normalized": 0.6, "points": 27 },
      { "key": "cf", "weight": 25, "raw": 0.34, "normalized": 0.63, "points": 16 },
      { "key": "grid", "weight": 20, "raw": 8.2, "normalized": 1.0, "points": 20 },
      { "key": "terrain", "weight": 10, "raw": 3.1, "normalized": 1.0, "points": 10 }
    ]
  },
  "sections": {
    "resource": { "status": "ok", "data": {
      "meanSpeed": 7.4, "minSpeed": 6.1, "maxSpeed": 8.2,
      "p25Speed": 7.0, "p50Speed": 7.4, "p75Speed": 7.8,
      "areaExceedance90": 6.6,
      "powerDensity": 412, "powerDensityRaw": 455, "airDensity": 1.13,
      "cfIec3": 0.34, "cfIec2": 0.29,
      "shearAlpha": 0.21,
      "weibull": { "A": 8.3, "k": 2.1 },
      "indiaPercentile": 88,
      "siteClass": "good"   // excellent ≥8 | good 7–8 | moderate 6–7 | marginal <6
    }},
    "climate":    { "status": "ok|unavailable", "data": { "rose": [...16], "monthly": [...12], "diurnal": [...24] } },
    "validation": { "status": "ok", "data": {
      "mastCountInAoi": 1,
      "nearestMast": { "station": "...", "distanceKm": 12.4, "maws": 7.1, "mawpd": 380, "heightM": 100, "id": "..." },
      "modelDeltaPct": 3.2,          // null if >25 km
      "confidence": "high|medium|low"
    }},
    "grid": { "status": "ok", "data": {
      "nearestSubstation": { "name": "...", "voltageKv": 220, "distanceKm": 8.2 },   // voltageKv may be null → display "unknown kV"
      "nearestLine": { "voltageKv": 400, "distanceKm": 3.1 },
      "ehvWithin25Km": true,
      "dataNote": "OSM-derived; may be incomplete"
    }},
    "context": { "status": "ok", "data": {
      "states": [{ "name": "Tamil Nadu", "installedMw": ..., "potentialMw": ... }],
      "windfarms": { "count": 2, "overlapFraction": 0.18 },
      "terrain": { "elevMean": 240, "elevMin": 180, "elevMax": 410, "slopeMeanDeg": 3.1, "slopeSteep10Deg": 7.8 },
      "sizing": {
        "capacityMw": 71, "energyGwh": 212,
        "assumptions": ["5 MW/km² density", "0.7 usable-land fraction", "IEC-III capacity factor", "existing wind-farm area excluded"]
      }
    }}
  }
}
```

Errors: 400 for invalid/oversized/out-of-India geometry with a machine-readable `code`. Never 500 for a section failure — that's `status: "unavailable"`.

## 4. Phases

### Phase 0 — Verification gate (no product code before this is done)

Write throwaway probe scripts under `scripts/probes/`, record every result (layer names, units, sample values, decisions) in `services/analysis/VERIFIED.md`.

1. **GWA TiTiler probes** at Muppandal (~8.26 N, 77.55 E) and one Rajasthan low-wind point:
   - IEC-III CF layer: confirm name, units, plausible value. **Record the actual Muppandal IEC-III value — this becomes the golden-test band. Do NOT use 0.25–0.35 (that was an IEC-II guess).**
   - IEC-II CF layer (for the secondary readout).
   - Weibull A and k layers @100 m: confirm and sanity-check (mean ≈ A·Γ(1+1/k) should be close to the speed layer's value at the same pixel).
   - RIX/ruggedness layer (if present → upgrades terrain), air-density layer (if present → replaces barometric formula).
2. **Open-Meteo licensing decision:** confirm whether a commercial API key is provisioned (`OPEN_METEO_API_KEY` in env). If not, section B is built but feature-flagged off (`CLIMATE_SECTION_ENABLED=false`) and ships as `unavailable`. Record the decision.
3. **ERA5 probe** (with whichever key situation applies): 100 m wind speed + direction hourly for one year at Muppandal centroid; verify rose is SW-dominant.
4. **Power-tile decode spike:** fetch our `/api/tiles/power` tiles at z10 around a centroid, decode server-side (`pbf` + `@mapbox/vector-tile`), confirm extraction of line/substation geometry + voltage and a correct nearest-distance computation against a visually verified case.
5. **Pin `ANALYSIS_ZOOM`** (z9 or z10): a 5×5 km square must cover ≥300 valid pixels.

**Gate check:** VERIFIED.md contains: both CF layer names + Muppandal values, Weibull layer names + consistency check result, climate-source decision + license status, decode spike result, pinned zoom. Stop and report to the user if any probe fails or contradicts an assumption in section 2.

### Phase 1 — Backend core

- `POST /api/analyze` route: Pro-gate middleware, zod validation of geometry (cap 2,500 km², ≥1 km², ≤100 vertices, India bbox, ring closure, non-self-intersection via a small robust check — do not hand-roll segment intersection if turf is already a dependency), rate limit.
- `services/analysis/`:
  - `tiles.ts` — tile-cover for the AOI at ANALYSIS_ZOOM, fetch GWA float32 tiles through the **existing tileCache** under a new namespace, ∞ TTL (fixed climatology; STALE fallback comes free).
  - `mask.ts` — polygon→pixel mask (point-in-polygon per pixel center; AOIs are small at z9/10, no need for scanline cleverness).
  - `resource.ts` — section A stats per the contract: speed percentiles, areaExceedance90, shear α from 50/100/150 layers (ln-ratio least squares across the three heights), Weibull area means, CF (both classes), air-density correction from the elevation grid, India percentile from existing validation-report stats, site-class banding.
  - `score.ts` — pure function, fully unit-tested against the normalizations in section 2.6.
- Sectioned response assembly with per-section status; 15 s overall budget via `Promise.race` per section group; per-section timing logs.
- Result cache: `md5(canonicalGeometry + analysisVersion)` → disk. **Canonicalization rounds every coordinate to 6 decimals** before hashing (draw-tool float jitter must not defeat the cache).
- `analysisVersion` constant in one place; bump on any algorithm change.

### Phase 2 — Backend enrichments

- **validation.ts:** PostGIS `ST_Intersects` count + `<->` KNN nearest mast. Sample GWA speed at mast coordinates (single-pixel fetch through the same cache), shear-adjust to mast height with the AOI α: `v_mastH = v_100 × (mastH/100)^α`. Delta + suppression + badge per section 2.3.
- **grid.ts:** decode power tiles in an expanding ring around the AOI (start at AOI bbox + 10 km, expand until hit or 100 km cap). Haversine point-to-segment for lines, point-to-point for substations. Voltage tag missing → `voltageKv: null`, never drop the feature. Include `dataNote`.
- **climate.ts** (behind `CLIMATE_SECTION_ENABLED`): ERA5 hourly fetch at centroid → 16-sector rose (frequency + mean speed), 12-month means, 24-hour means. Disk-cached forever, key = centroid rounded to 0.05° + analysisVersion. **No TTL.**
- **context.ts:** state point-in-polygon against cached states GeoJSON (+ STATE_DATA join), windfarm-boundary intersection → count + overlapFraction, elevation-grid stats + slope (per-pixel slope from elevation neighbors at grid resolution; report mean and 90th-percentile slope as `slopeSteep10Deg`), sizing per section 2.5.

### Phase 3 — Frontend selection tools

- "Analyze" tool in the left ProSidebar: Point / Rectangle / Polygon / Clear.
- **terra-draw** for rectangle + polygon (MapLibre adapter). Point mode hand-rolled: hover shows a ghost 5×5 km square, click commits.
- Live km² readout while drawing; hard stop + inline message at **2,500 km²** during drawing, not after submit.
- AOI layer styled like windfarm boundaries (sky outline, faint fill), above rasters / below pins. Draw-armed flag heads the existing click-priority chain (mast/grid popups bail while armed). Esc cancels.
- AbortController: new AOI cancels the in-flight request.

### Phase 4 — Results panel

- Auto-opens (MastDataTool reveal pattern). State machine: `idle → drawing → loading → partial | ok → error`.
- Layout top-to-bottom:
  1. **Score header:** big number + confidence chip; tap/click expands the component breakdown (weight → points per component, straight from `score.components`).
  2. **Stat grid:** resource + grid + validation + sizing headline numbers.
  3. **Badges:** site class, EHV-within-25-km, "N farms already here", validation confidence.
  4. **Charts:** (a) Weibull speed-distribution curve (render PDF from A,k — annotate mean), (b) wind rose — custom SVG, sectors colored by the metadata.json ramp, (c) monthly bars + diurnal line (existing Finance-dashboard chart lib), (d) India-percentile context bar. Charts b–c render only when `climate.status === "ok"`.
  5. Per-section "unavailable" placeholders; nearest-mast row click-through to existing mast detail; assumptions block under sizing; attribution footer (GWA CC-BY · ERA5 · OSM/ODbL) + "screening estimate — not bankable" disclaimer.
- "90% of site area exceeds X m/s" appears as a stat line, never as a chart, never as "P90".

### Phase 5 — Share/export

- Permalink: geometry → 6-dp rounded → compressed base64 in URL hash; on load, redraw AOI + re-run analysis.
- Copy-as-CSV of the stats block (flat key,value rows including assumptions).

### Phase 6 — Verification

Golden tests (run against live deps where possible, recorded fixtures otherwise):
- **Muppandal AOI:** mean speed 7–8 m/s; CF within the IEC-III band recorded in VERIFIED.md; Weibull consistency (A·Γ(1+1/k) within 5% of mean speed); SW-dominant rose (if climate enabled); mast count equals direct SQL; nearest substation matches a visually verified OpenInfraMap case; score reproducible by recomputing from `score.components`.
- **Bhadla AOI:** low score; tool does not flatter solar country.
- **Mast-delta sanity:** at one known mast, |delta| within a plausible bound (record the expected range during Phase 2 and assert against it).
- **Edge cases:** >2,500 km² → 400; degenerate/self-intersecting → 400; out-of-India → 400; AOI fully inside an existing farm → sizing ≈ 0 with overlap ≈ 1.0; ERA5 forced failure → climate `unavailable`, everything else `ok`; section exceeding budget → `unavailable`, 200 overall.
- **Frontend:** draw/cancel/abort flows, click-priority chain while armed, permalink round-trip, partial-response rendering, typecheck + lint + e2e smoke.

## 5. Ship order

- **v1:** Phases 0–2 (climate section flag-off if licensing unresolved), 3, 4 (without rose/monthly/diurnal if flagged off), 5, 6.
- **v1.1:** enable climate section (rose, monthly, diurnal) once the Open-Meteo key is in place.
- **v1.2:** CSV polish, state-context polish.
- **v2 (do not build now):** multi-AOI compare (response shape already supports a list), saved AOIs, PDF export, turbine selector / wake-aware AEP, land-use screening, offshore.

## 6. Hard "do not" list

- Do not default CF to IEC-II.
- Do not chart pixel-mean speeds as a "wind speed distribution".
- Do not print "P90" anywhere.
- Do not compare mast measurement to AOI-average GWA speed.
- Do not show a mast delta when the nearest mast is >25 km away.
- Do not call the keyless Open-Meteo endpoint from production.
- Do not drop grid features with missing voltage tags.
- Do not let one section's failure 500 the whole response.
- Do not hash unrounded geometry into the result-cache key.
- Do not put validation confidence inside the score arithmetic.
