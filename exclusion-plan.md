# WCE — Legal Boundary Data Generation Plan (FULL DATA)

**Claude Code step-by-step runbook for acquiring and building the legal exclusion-zone geodatabase.**
Companion to the engine runbook — this covers *only* sourcing → normalising → loading the `wce.*` tables with real, current, commercially-usable data. Targets the Bun/TS backend (`scripts/ingest-exclusions.ts`, `src/services/exclusions/`, raw `pg`, `data/by-source/`).

---

## 0. What "legal boundary" means here (read first)

Three honesty tiers — every feature is tagged with which one it is, because it changes whether it's a hard exclusion or a verify-before-use flag:

1. **Notified / official boundary** — the gazette boundary or its official GIS rendering (CRZ CZMP-2019 from NCSCM, notified ESZ, RF/PF from GatiShakti/SOI, notified wetlands). → `is_legal_boundary = true`.
2. **Derived legal zone** — a buffer the law defines off a feature (ASI 100 m/300 m, default 10 km ESZ, settlement 500 m). Legally meaningful *rule*, but the precision depends on the input geometry. → `is_legal_boundary = true` only when buffered off a notified limit; otherwise `false`.
3. **Indicative proxy** — community or global data standing in for an unpublished legal boundary (OSM PA relations, WDPA, FSI forest *cover*). → `is_legal_boundary = false`, must be verified against the gazette before clearance use.

**Hard commercial constraint:** WDPA (Protected Planet) prohibits commercial use and derivatives without UNEP-WCMC permission and disclaims boundary legal status. **Do not embed WDPA in the platform.** Use it only as an offline cross-check. Everything ingested below is CC0 / CC-BY / ODbL (OSM) / Indian Government open data — commercially usable with attribution.

**Provenance is mandatory.** Every row gets `source_id`, `legal_tier` (1–7), `is_legal_boundary`, `license`, `acquired_at`, `notes` (gazette/citation). This drives the Screening vs Clearance split and the click-to-inspect "why".

---

## 1. Master data source matrix (the full list)

`legal_tier`: 1 = gazette notification · 2 = official govt GIS portal · 3 = official aggregated open data · 4 = authoritative global third-party (reference only) · 5 = community-mapped (OSM) · 6 = derived/computed buffer · 7 = indicative screening proxy.

| layer_code | class | legal basis | authoritative body | **practical source (real)** | format | tier | is_legal | derivation |
|---|---|---|---|---|---|---|---|---|
| `national_park` / `wildlife_sanctuary` | red | Wild Life (Protection) Act 1972 §18/§35 | State notification; WII/MoEFCC compile | **OSM** `boundary=protected_area`/`national_park` relations (ODbL); WDPA = offline cross-check only | OSM | 5 | false → verify | Overpass → dissolve |
| `conservation_reserve` / `community_reserve` | red | WLPA 1972 §36A/§36C | State | OSM relations | OSM | 5 | false | Overpass |
| `tiger_reserve_core` | red | WLPA 1972 §38V | NTCA | OSM + NTCA core/critical notifications | OSM | 5 | false → verify | Overpass + manual |
| `forest_legal` (RF/PF) | red | Forest (Conservation) Act 1980; IFA 1927; Van Adhiniyam | State Forest Dept | **india-geodata** `environment/forests` (RF/PF from GatiShakti + SOI) | GeoJSONL | 2–3 | true | `gh release download` |
| `forest_cover` (FSI) | screening only | — (not a legal boundary) | Forest Survey of India | india-geodata `environment/forests` (FSI cover) | GeoTIFF/poly | 7 | false | screening proxy only |
| `wetland_notified` | red | Wetlands (Conservation & Mgmt) Rules 2017 (EP Act 1986) | State Wetland Authority / MoEFCC | india-geodata **wetlands** (PARIVESH-surveyed boundaries) | GeoJSONL | 2 | true (notified subset) | `gh release download` |
| `ramsar` | red | Ramsar Convention + Wetlands Rules 2017 | MoEFCC | india-geodata **wetlands** (Ramsar polygons) | GeoJSONL | 2 | true | `gh release download` |
| `crz_1` | red | CRZ Notification 2019 (EP Act 1986) | NCSCM / MoEFCC | india-geodata `environment/coastal` → **NCSCM / Parivesh CRZ-2019 Regulatory Zones** | GeoJSONL | 1–2 | true | filter CRZ-I |
| `crz_other` (II/III/IV) | amber | CRZ 2019 | NCSCM | same coastal release | GeoJSONL | 2 | true | filter non-I |
| `mangrove` | red | CRZ-I(A) / Forest law | NCSCM / FSI | coastal release + FSI mangrove layer | GeoJSONL | 2 | true | filter |
| `esz_notified` | amber | EP Act 1986 §3(2)(v); per-site notification | MoEFCC | **PARIVESH / Bharatmaps** notified-ESZ layer where published; else **e-Gazette PDF** (egazette.nic.in) → digitise | SHP/PDF | 1 | true | download / digitise |
| `esz_default_10km` | amber | default until notified (Wildlife Action Plan 2002; SC 2022 min 1 km) | — | **derived** 10 km buffer off the PA layer | derived | 6 | false | `ST_Buffer` 10 km |
| `asi_prohibited_100m` | red | AMASR Act 1958 §20A (+Amendment 2010) | ASI / NMA | monument locations (**data.gov.in** ASI lists / **OSM** `historic=*`) → 100 m buffer | derived | 3→6 | true if off protected limit, else false | buffer |
| `asi_regulated_300m` | amber | AMASR §20B (200 m beyond) | NMA | same locations → 300 m buffer | derived | 3→6 | indicative | buffer |
| `airport_height` | amber (external) | Aircraft Act; GSR 751(E) Height Rules 2015; AAI CCZM | AAI | airport locations (india-geodata `infrastructure/airports`); **AAI NOCAS** per-turbine height | external | 2 | n/a | out-of-engine height check |
| `defence` | clearance-only | — | MoD / IAF | not public | manual | 1 | indicative | manual upload (labelled indicative) |
| `settlement_500m` | red | MNRE siting practice (15+ inhabited buildings) | — | india-geodata habitations (**SOI HUTS / GatiShakti settlement / ESRI built-up**) or **OSM** buildings → cluster + buffer | derived | 6–7 | false | DBSCAN + 500 m buffer |
| `road_setback` / `rail_setback` | red (dynamic) | MNRE setback `hub+0.5·rotor+5` | — | **Geofabrik** India OSM extract (roads/rail) or india-geodata infra | OSM/GeoJSONL | 5 | n/a | dynamic `ST_DWithin` |
| `ehv_setback` | red (dynamic) | MNRE setback | — | **existing OpenInfraMap integration** (already in your stack) or OSM `power=line` | MVT/OSM | 5 | n/a | dynamic `ST_DWithin` |
| `existing_wtg_5d7d` | red (dynamic) | spacing/wake practice | — | **your `wind_turbines` table** (already ingested) | DB | — | n/a | dynamic `ST_DWithin` |

Admin base (for clipping/validation, not exclusions): india-geodata `admin/states`, `admin/districts`, `admin/villages` (SOI/LGD), and `india-composite.geojson` country outline.

---

## 2. Tooling setup (Phase A.0)

Install once on the box / in the ingest environment:
```bash
# GitHub CLI for india-geodata releases (release assets, not git-lfs)
gh --version || (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg ... ) # per platform
gh auth login            # or set GH_TOKEN

# GDAL (shapefile/geojsonl -> GeoJSON, reprojection) + 7zip for india-geodata .7z assets
ogr2ogr --version || sudo apt-get install -y gdal-bin
7z   || sudo apt-get install -y p7zip-full
# osmium for Geofabrik PBF filtering (roads/rail/power); osmtogeojson already in node_modules
osmium --version || sudo apt-get install -y osmium-tool
```
Resolve india-geodata's exact release tags first (they're `category/subcategory`):
```bash
gh release list --repo yashveeeeeeer/india-geodata          # confirm tags
# confirmed: admin/states, admin/districts, admin/villages, environment/coastal, environment/forests
# resolve wetlands tag: gh release list --repo yashveeeeeeer/india-geodata | grep -i -E 'water|wetland'
```
Landing layout (matches your `data/by-source/`):
```
data/by-source/<source_id>/raw/        # downloaded shp/geojsonl/pbf
data/by-source/<source_id>/<source_id>.geojson   # normalised, EPSG:4326 -> loader input
```

**Connector contract** (from the engine runbook) — each source produces a normalised GeoJSON FeatureCollection, then `src/services/exclusions/loader.ts` streams it to PostGIS:
```ts
type NormalisedFeature = {
  geometry: GeoJSON.Geometry;     // EPSG:4326
  layer_code: string; class: 'red'|'amber';
  source_id: string; is_legal_boundary: boolean;
  attrs?: Record<string, unknown>;   // name, notification_no, gazette_date, iucn, etc.
};
```
Loader SQL per feature (polygon layer):
```sql
INSERT INTO wce.excl_polygon (source_id,layer_code,class,geom,attrs)
VALUES ($1,$2,$3, ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON($4))), $5);
```
Seed `wce.source_registry` row before loading each source (sets `legal_tier`, `license`, `is_legal_boundary`).

---

## PHASE A — Admin base + national clip

Goal: a country/state mask to clip every layer to India land and tag features by state.

```bash
# Country outline + states (CC-BY / CC0)
gh release download admin/states --repo yashveeeeeeer/india-geodata --pattern "*.parquet" --dir data/by-source/soi_states/raw/
# (country outline is a small repo file)
curl -L -o data/by-source/soi_country/india-composite.geojson \
  https://github.com/yashveeeeeeer/india-geodata/raw/main/data/administrative/country/india-composite.geojson
```
Load `soi_states` and `india-composite` into a non-exclusion schema table (e.g. `wce.admin_state`, `wce.admin_country`) for clipping. **Acceptance:** state polygons load; `ST_Union(country)` covers mainland + islands.

---

## PHASE B — Directly-downloadable legal / near-legal polygons

### B1. CRZ (coastal) — tier 1–2, legal
```bash
gh release download environment/coastal --repo yashveeeeeeer/india-geodata \
  --pattern "NCSCM_CRZ_Regulation_Zones.geojsonl.7z" --dir data/by-source/crz/raw/
7z x data/by-source/crz/raw/NCSCM_CRZ_Regulation_Zones.geojsonl.7z -odata/by-source/crz/raw/
# also: Bharatmaps_Parivesh_CRZ2019_Regulatory_Zones.geojsonl.7z (CRZ-2019 official)
```
Normalise (stream the `.geojsonl` with your `split2`/`JSONStream`): inspect the zone-type attribute, then map **CRZ-I / CRZ-IA / mangrove → `crz_1` red**, everything else → `crz_other` amber. `is_legal_boundary=true`, `legal_tier=2`, `license=GovOpenData/NCSCM`, `attrs.czmp="2019"`. Use the **Regulatory Zones** (polygons), not the Regulatory Lines (HTL/LTL).

### B2. Wetlands (Ramsar + notified) — tier 2, legal
```bash
WET_TAG=$(gh release list --repo yashveeeeeeer/india-geodata | grep -i wetland | awk '{print $1}' | head -1)
gh release download "$WET_TAG" --repo yashveeeeeeer/india-geodata --dir data/by-source/wetlands/raw/
```
Split the source into `ramsar` (Ramsar-designated) and `wetland_notified` (PARIVESH-surveyed notified set) using its source/type attribute. Drop SOI salt-pan/swamp polygons unless flagged notified (those are inventory, not legal → `is_legal_boundary=false` if kept as screening). `class=red`, `legal_tier=2`.

### B3. Forest — RF/PF legal (red) + FSI cover (screening)
```bash
gh release download environment/forests --repo yashveeeeeeer/india-geodata --dir data/by-source/forest/raw/
```
Split by source: **GatiShakti / SOI reserve/protected forest boundaries → `forest_legal` red, `is_legal_boundary=true`, tier 2–3.** **FSI cover polygons/raster → `forest_cover`, screening only, `is_legal_boundary=false`, tier 7** (keep for ecological context; never gate clearance on cover alone). Sample the FSI raster with `geotiff` (reuse your GWA pattern) if you want a coverage attribute rather than polygons.

### B4. Protected areas (NP / WLS / reserves) — tier 5, indicative→verify
States don't publish these, so use OSM relations (ODbL):
```bash
# Overpass — PA relations only (small enough for live query)
cat > /tmp/pa.overpassql <<'EOF'
[out:json][timeout:300];
area["ISO3166-1"="IN"][admin_level=2]->.in;
(
  relation["boundary"="protected_area"](area.in);
  relation["boundary"="national_park"](area.in);
  relation["leisure"="nature_reserve"](area.in);
);
out geom;
EOF
curl -s -X POST -d @/tmp/pa.overpassql https://overpass-api.de/api/interpreter \
  > data/by-source/osm_pa/raw/pa.json
```
Convert with `osmtogeojson` (already in `node_modules`). Map by tag: `national_park`→`national_park`; `protect_class`/`protection_title` containing "Wildlife Sanctuary"→`wildlife_sanctuary`, "Conservation Reserve"/"Community Reserve"→respective; "Tiger Reserve" core→`tiger_reserve_core`. `class=red`, `legal_tier=5`, `is_legal_boundary=false`, `attrs.osm_id`, `attrs.protect_class`. Flag every PA for gazette verification before clearance use. **Offline only:** download WDPA India once to QA OSM coverage/geometry — never load it into `wce.*` (commercial restriction).

**Phase B acceptance:** `excl_polygon` non-empty for crz_1, ramsar/wetland_notified, forest_legal, and PA layers; `count(*) WHERE NOT ST_IsValid(geom)=0`; each source has a `source_registry` row with correct `is_legal_boundary`.

---

## PHASE C — Buffer-derived legal zones

These run in `src/services/exclusions/buffers.ts` (geography buffering → `excl_buffer`), after their inputs exist.

### C1. ASI monument zones — 100 m red / 300 m amber
Acquire monument locations (no clean boundary GIS exists): `data.gov.in` ASI "Centrally Protected Monuments" lists (geocode where only addresses) and/or OSM `historic=archaeological_site`/`heritage` with `operator~"Archaeological Survey"`. Load as `infra_feature(kind='institution', attrs.asi=true, attrs.name)`. Then:
```sql
INSERT INTO wce.excl_buffer (layer_code,class,rule,geom,attrs)
SELECT 'asi_prohibited_100m','red','asi_100m',
       ST_Multi(ST_Buffer(geog,100)::geometry), jsonb_build_object('name', attrs->>'name')
FROM wce.infra_feature WHERE kind='institution' AND attrs->>'asi'='true';
INSERT INTO wce.excl_buffer (layer_code,class,rule,geom,attrs)
SELECT 'asi_regulated_300m','amber','asi_300m',
       ST_Multi(ST_Buffer(geog,300)::geometry), jsonb_build_object('name', attrs->>'name')
FROM wce.infra_feature WHERE kind='institution' AND attrs->>'asi'='true';
```
`is_legal_boundary=true` only if the input is the monument's notified protected limit; with point locations set `false` and note "buffer off point, verify protected limit". Some sites (e.g. Taj Mahal) have extended prohibited areas — capture per-monument overrides in `attrs` where known.

### C2. ESZ default 10 km (amber) — where not notified
```sql
INSERT INTO wce.excl_buffer (layer_code,class,rule,geom,attrs)
SELECT 'esz_default_10km','amber','esz_10km',
       ST_Multi(ST_Difference(ST_Buffer(geog,10000)::geometry, geom)::geometry),  -- ring outside the PA
       jsonb_build_object('pa_name', attrs->>'name')
FROM wce.excl_polygon
WHERE layer_code IN ('national_park','wildlife_sanctuary')
  AND NOT EXISTS (SELECT 1 FROM wce.excl_polygon e WHERE e.layer_code='esz_notified'
                  AND ST_Intersects(e.geom, wce.excl_polygon.geom));  -- skip where notified ESZ exists
```
`is_legal_boundary=false`, tier 6. Notified ESZ (Phase D) supersedes the default for that PA.

### C3. Settlement 500 m (red) — 15+ inhabited buildings
Input: building footprints. Prefer **OSM buildings** (Geofabrik, Phase E) or india-geodata `ESRI_Sentinel2_10m_2023_Builtup_Area` / `SOI_HumanSettlements_HUTS`. Cluster + buffer:
```sql
WITH clustered AS (
  SELECT ST_ClusterDBSCAN(geom, eps:=0.0015, minpoints:=15) OVER () AS cid, geom
  FROM wce.infra_feature WHERE kind='building')
INSERT INTO wce.excl_buffer (layer_code,class,rule,geom)
SELECT 'settlement_500m','red','settlement_500m',
       ST_Multi(ST_Buffer(ST_ConvexHull(ST_Collect(geom))::geography,500)::geometry)
FROM clustered WHERE cid IS NOT NULL GROUP BY cid;
```
`eps≈150 m` — tune per region; `is_legal_boundary=false`, tier 6.

**Phase C acceptance:** `excl_buffer` populated for asi_100m/300m, esz_default_10km, settlement_500m; spot-check a known monument and a known PA.

---

## PHASE D — Notified-gazette digitisation queue (manual, highest legal value)

For genuinely notified boundaries not in any open GIS feed. Use the `connectors/manual-upload.ts` + auth-gated route from the engine runbook. Each upload demands `class`, `legal_tier`, `is_legal_boundary=true`, `notes` (gazette no. + date + URL).

Queue, in priority order:
1. **Notified ESZ** — from PARIVESH/Bharatmaps where published; otherwise e-Gazette (egazette.nic.in) + MoEFCC ESZ notification list → digitise the schedule maps. Replaces `esz_default_10km` for that PA.
2. **Gazette-verified PA boundaries** — upgrade high-priority OSM PAs (those near your wind belts) to notified geometry from state notifications; flip `is_legal_boundary=true`.
3. **Exact forest RF/PF** for target districts — from State Forest Dept working-plan maps where india-geodata coverage is coarse.
4. **Monument protected limits** for monuments near candidate sites — upgrade ASI point-buffers to notified-limit buffers.
5. **Defence/MoD indicative** — only if provided by CECL; always labelled "indicative — not a clearance boundary".

**Acceptance:** uploaded notified ESZ supersedes the default buffer for its PA; provenance shows gazette reference.

---

## PHASE E — Infrastructure inputs for dynamic setbacks

Not "legal boundaries" but required for the MNRE setback check. All-India OSM road/rail/power is too big for live Overpass → use the Geofabrik extract + osmium.

```bash
curl -L -o data/by-source/geofabrik/india-latest.osm.pbf \
  https://download.geofabrik.de/asia/india-latest.osm.pbf

# Roads (motorway..tertiary), Rail, Power lines -> filtered PBFs
osmium tags-filter india-latest.osm.pbf w/highway=motorway,trunk,primary,secondary,tertiary -o roads.osm.pbf
osmium tags-filter india-latest.osm.pbf w/railway=rail -o rail.osm.pbf
osmium tags-filter india-latest.osm.pbf w/power=line -o power.osm.pbf
osmium tags-filter india-latest.osm.pbf w/building -o buildings.osm.pbf   # for settlement clusters
```
Convert each with `osmtogeojson` (`node_modules`) → load to `infra_feature(kind in road|rail|ehv|building)`. **EHV:** prefer your **existing OpenInfraMap integration** (already serving voltage-coloured transmission tiles) as the authoritative EHV source; OSM `power=line` is the fallback. `legal_tier=5`, `is_legal_boundary=n/a`. National highways: optionally enrich with india-geodata `infrastructure/highways` (MoRTH GatiShakti) for NH-specific setbacks.

**Acceptance:** `infra_feature` populated for road/rail/ehv/building; counts logged; `ST_DWithin` setback test from Phase 2 of the engine runbook passes.

---

## PHASE F — Validation, classification, provenance, QA

1. **Clip + dedup:** clip every layer to `wce.admin_country`; drop offshore noise; `ST_MakeValid`; dedup by `ST_GeoHash`.
2. **Legal classification audit:** assert every `excl_polygon`/`excl_buffer` row resolves to a `source_registry` row, and that `is_legal_boundary=true` only for tiers 1–2 (and forest RF/PF, CRZ, notified wetlands/ESZ). Anything OSM/WDPA/FSI-cover/buffer-off-point must be `false`.
3. **Coverage report:** per `layer_code` — feature count, total area, % of India, source, tier, legal flag. Flag empty layers.
4. **Cross-check vs WDPA (offline):** load WDPA India locally, compare PA count/area to the OSM PA layer; list large discrepancies for the digitisation queue. WDPA stays out of `wce.*`.
5. **License manifest:** write `data/by-source/LICENSES.md` — per source: license, attribution string, URL, acquired date. Surface WDPA's non-commercial status explicitly so it's never promoted into the product.
6. **Refresh cadence (`node-cron`):** india-geodata releases — re-pull quarterly; OSM/Geofabrik — monthly; gazette/manual — event-driven. Re-run buffers + re-validate + bust tile cache after each.

**Acceptance:** classification audit green; coverage report generated; LICENSES.md complete; refresh job runs end-to-end.

---

## Execution order

`A → B → C → E → D → F`.
A builds the clip mask. B loads the downloadable legal polygons. C derives the legal buffers (ASI/ESZ-default/settlement). E loads infra (also feeds C3 settlement clusters — run E.buildings before C3 if you use OSM buildings). D is the ongoing gazette-digitisation queue that upgrades indicative → notified. F validates and locks provenance. Commit per source; gate on each phase's acceptance criteria.

---

## Caveats / gotchas (data-specific)

- **WDPA is non-commercial** — offline cross-check only; never loaded, served, or promoted into the platform.
- **PA boundaries are community data** until gazette-verified — `is_legal_boundary=false` for everything from OSM; verify the PAs near your wind belts first.
- **FSI forest *cover* ≠ legal forest** — cover is a screening proxy; only GatiShakti/SOI RF/PF boundaries are `is_legal_boundary=true`.
- **CRZ: use Regulatory Zones (polygons), not Regulatory Lines** — and classify CRZ-I/IA/mangrove as red, the rest amber.
- **ESZ is variable-width and mostly default-10km** — notified boundaries (gazette) supersede the buffer per-PA; don't treat the 10 km ring as legal.
- **ASI zones are buffers off the protected limit** — buffering off a point (when that's all you have) is indicative, not the legal boundary; some monuments have extended prohibited areas.
- **Airport height (NOCAS) is not a polygon** — it's a per-turbine tip-elevation check against AAI CCZM; handled out-of-engine, airport *locations* only are loaded.
- **Reproject everything to EPSG:4326** (`ogr2ogr -t_srs EPSG:4326`); india-geodata shapefiles may carry a projected CRS — check `.prj`. GeoJSON/GeoJSONL are WGS84 by spec.
- **india-geodata large assets are `.7z` GitHub Release assets** — `gh release download <tag>` + `7z x`, not `git clone` (they're not in the tree).
- **Geofabrik for all-India OSM, Overpass only for PA relations** — live Overpass will time out on national roads/power; PA relations are small enough.
- **Resolve release tags at runtime** — `gh release list` before scripting; tags are `category/subcategory` (confirmed: `admin/states`, `environment/coastal`, `environment/forests`).
