# Exclusion-zone data — license & provenance manifest

Generated from `wce.source_registry`. Every layer ingested into `wce.*` is
CC0 / CC-BY / ODbL (OSM) / Indian Government open data — commercially usable
with attribution.

> **WDPA (Protected Planet) is NOT in this database.** It prohibits commercial
> use and derivatives without UNEP-WCMC permission and disclaims boundary legal
> status. It is used only as an offline cross-check and must never be loaded,
> served, or promoted into the platform.

| source_id | tier | legal? | license | authority | acquired | notes |
|---|---|---|---|---|---|---|
| `manual_gazette` | 1 | ✅ | GovOpenData (e-Gazette / PARIVESH) | MoEFCC / State (per notification) | 2026-06-20 | Notified ESZ / gazette-verified PA / exact RF-PF / monument protected limits. Each upload carries its own gazette ref in attrs |
| `bharatmaps_rfa` | 2 | ✅ | GovOpenData (Bharatmaps / FSI) | FSI / State Forest Dept | 2026-06-20 | Recorded Forest Area (RFA) — legally recorded forest land (FCA 1980). Complements SOI forest_legal |
| `crz` | 2 | ✅ | GovOpenData / NCSCM | NCSCM / MoEFCC | 2026-06-20 | CRZ Notification 2019; Regulatory Zones (polygons), not Lines. CRZ-I/IA/mangrove=red, rest=amber. czmp=2019 |
| `esz_notified` | 2 | ✅ | GovOpenData (PM GatiShakti / MoEFCC) | MoEFCC ESZ notifications via PM GatiShakti | 2026-06-20 | ESZ marked per MoEF notification maps (EP Act 1986 §3(2)(v)). Supersedes esz_default_10km per-PA |
| `forest_legal` | 2 | ✅ | GovOpenData (GatiShakti / SOI) | State Forest Dept | 2026-06-20 | RF/PF reserve/protected forest boundaries (FCA 1980; IFA 1927) |
| `gatishakti_pa` | 2 | ✅ | GovOpenData (PM GatiShakti / State Forest Dept) | State Forest Dept via PM GatiShakti NMP | 2026-06-20 | Official GIS of notified NP/WLS (WLPA 1972). Verify exact gazette geometry before clearance |
| `wetlands` | 2 | ✅ | GovOpenData (PARIVESH / Ramsar) | State Wetland Authority / MoEFCC | 2026-06-20 | Wetlands (Conservation & Mgmt) Rules 2017. ramsar + notified subset legal; SOI inventory salt-pan/swamp = screening only |
| `asi` | 3 | — | ODbL (OpenStreetMap) / data.gov.in | ASI / NMA | 2026-06-20 | Centrally Protected Monument point locations (AMASR Act 1958). Buffered 100m/300m in C1 — buffer off point, verify protected limit |
| `soi_country` | 3 | — | CC-BY (india-geodata) | Survey of India (composite) | 2026-06-20 | India composite outline — clip mask only |
| `soi_states` | 3 | — | CC-BY (india-geodata) | Survey of India / LGD | 2026-06-20 | State polygons — state tagging only |
| `geofabrik` | 5 | — | ODbL (OpenStreetMap / Geofabrik) | OSM community | 2026-06-20 | roads/rail/power-line/buildings for ST_DWithin setbacks + settlement clusters |
| `osm_pa` | 5 | — | ODbL (OpenStreetMap) | OSM community (verify vs gazette) | 2026-06-20 | NP/WLS/conservation/community reserves & tiger-reserve cores. WLPA 1972. Indicative — verify before clearance |
| `derived_asi` | 6 | — | Derived (data.gov.in / OSM monument locations) | ASI / NMA | 2026-06-20 | AMASR Act 1958 §20A/§20B. 100 m red + 300 m amber buffers off monument locations. is_legal=false when buffered off a point |
| `derived_esz` | 6 | — | Derived (10 km buffer off PA layer) | — | 2026-06-20 | Default 10 km ESZ until notified (Wildlife Action Plan 2002; SC 2022 min 1 km). Notified ESZ supersedes per-PA |
| `derived_settlement` | 6 | — | Derived (DBSCAN + 500 m buffer off buildings) | — | 2026-06-20 | MNRE siting practice (15+ inhabited buildings) — DBSCAN cluster + 500 m buffer |
| `forest_cover` | 7 | — | GovOpenData (FSI) | Forest Survey of India | 2026-06-20 | FSI forest *cover* — screening proxy only, NOT a legal boundary |
| `wetland_inventory` | 7 | — | GovOpenData (Parivesh / National Wetland Atlas, SAC-ISRO) | SAC-ISRO / MoEFCC (inventory) | 2026-06-20 | National Wetland Atlas inventory (every river/pond) — screening proxy ONLY, NOT notified under Wetlands Rules 2017. is_legal_boundary=false |
