/**
 * Source registry — the full data-source matrix from exclusion-plan.md §1,
 * encoded as code so every loaded feature resolves to a known provenance row.
 *
 * `seedSource()` upserts a `wce.source_registry` row before any feature for that
 * source is loaded (the excl_polygon/excl_buffer FKs require it). This is what
 * drives the Screening-vs-Clearance split and the click-to-inspect "why".
 */
import type { Pool } from "pg";
import type { ExclClass, LegalTier } from "./types";

export type SourceDef = {
  source_id: string;
  layer_code: string; // primary layer (a source may feed >1; class set per-feature)
  class: ExclClass | null;
  legal_tier: LegalTier;
  is_legal_boundary: boolean;
  license: string;
  authority?: string;
  url?: string;
  notes?: string;
};

/**
 * Keyed by source_id — these ids match the `data/by-source/<source_id>/` layout.
 * `is_legal_boundary` here is the source's *default*; connectors may still set a
 * stricter per-feature flag (e.g. a notified subset inside a mixed wetlands file).
 */
export const SOURCES: Record<string, SourceDef> = {
  // ── Admin base (Phase A) — clip/validate only, never an exclusion ──────────
  soi_country: {
    source_id: "soi_country",
    layer_code: "admin_country",
    class: null,
    legal_tier: 3,
    is_legal_boundary: false,
    license: "CC-BY (india-geodata)",
    authority: "Survey of India (composite)",
    url: "https://github.com/yashveeeeeeer/india-geodata",
    notes: "India composite outline — clip mask only",
  },
  soi_states: {
    source_id: "soi_states",
    layer_code: "admin_state",
    class: null,
    legal_tier: 3,
    is_legal_boundary: false,
    license: "CC-BY (india-geodata)",
    authority: "Survey of India / LGD",
    url: "https://github.com/yashveeeeeeer/india-geodata",
    notes: "State polygons — state tagging only",
  },

  // ── Phase B: directly-downloadable legal / near-legal polygons ─────────────
  crz: {
    source_id: "crz",
    layer_code: "crz_1",
    class: "red",
    legal_tier: 2,
    is_legal_boundary: true,
    license: "GovOpenData / NCSCM",
    authority: "NCSCM / MoEFCC",
    url: "https://github.com/yashveeeeeeer/india-geodata (environment/coastal)",
    notes:
      "CRZ Notification 2019; Regulatory Zones (polygons), not Lines. CRZ-I/IA/mangrove=red, rest=amber. czmp=2019",
  },
  wetlands: {
    source_id: "wetlands",
    layer_code: "wetland_notified",
    class: "red",
    legal_tier: 2,
    is_legal_boundary: true,
    license: "GovOpenData (PARIVESH / Ramsar)",
    authority: "State Wetland Authority / MoEFCC",
    url: "https://github.com/yashveeeeeeer/india-geodata (wetlands)",
    notes:
      "Wetlands (Conservation & Mgmt) Rules 2017. ramsar + notified subset legal; SOI inventory salt-pan/swamp = screening only",
  },
  forest_legal: {
    source_id: "forest_legal",
    layer_code: "forest_legal",
    class: "red",
    legal_tier: 2,
    is_legal_boundary: true,
    license: "GovOpenData (GatiShakti / SOI)",
    authority: "State Forest Dept",
    url: "https://github.com/yashveeeeeeer/india-geodata (environment/forests)",
    notes: "RF/PF reserve/protected forest boundaries (FCA 1980; IFA 1927)",
  },
  forest_cover: {
    source_id: "forest_cover",
    layer_code: "forest_cover",
    class: "amber",
    legal_tier: 7,
    is_legal_boundary: false,
    license: "GovOpenData (FSI)",
    authority: "Forest Survey of India",
    url: "https://github.com/yashveeeeeeer/india-geodata (environment/forests)",
    notes: "FSI forest *cover* — screening proxy only, NOT a legal boundary",
  },
  osm_pa: {
    source_id: "osm_pa",
    layer_code: "national_park",
    class: "red",
    legal_tier: 5,
    is_legal_boundary: false,
    license: "ODbL (OpenStreetMap)",
    authority: "OSM community (verify vs gazette)",
    url: "https://overpass-api.de",
    notes:
      "NP/WLS/conservation/community reserves & tiger-reserve cores. WLPA 1972. Indicative — verify before clearance",
  },

  // GatiShakti official PA boundaries (NP/WLS) — preferred over OSM (tier 5).
  gatishakti_pa: {
    source_id: "gatishakti_pa",
    layer_code: "wildlife_sanctuary",
    class: "red",
    legal_tier: 2,
    is_legal_boundary: true,
    license: "GovOpenData (PM GatiShakti / State Forest Dept)",
    authority: "State Forest Dept via PM GatiShakti NMP",
    url: "https://github.com/yashveeeeeeer/india-geodata (environment/forests)",
    notes:
      "Official GIS of notified NP/WLS (WLPA 1972). Verify exact gazette geometry before clearance",
  },
  // Notified Eco-Sensitive Zones — published GIS (supersedes the 10 km default).
  esz_notified: {
    source_id: "esz_notified",
    layer_code: "esz_notified",
    class: "amber",
    legal_tier: 2,
    is_legal_boundary: true,
    license: "GovOpenData (PM GatiShakti / MoEFCC)",
    authority: "MoEFCC ESZ notifications via PM GatiShakti",
    url: "https://github.com/yashveeeeeeer/india-geodata (environment/forests)",
    notes:
      "ESZ marked per MoEF notification maps (EP Act 1986 §3(2)(v)). Supersedes esz_default_10km per-PA",
  },

  // Bharatmaps Recorded Forest Area (RF/PF/unclassed) — legal, complements SOI.
  bharatmaps_rfa: {
    source_id: "bharatmaps_rfa",
    layer_code: "forest_legal",
    class: "red",
    legal_tier: 2,
    is_legal_boundary: true,
    license: "GovOpenData (Bharatmaps / FSI)",
    authority: "FSI / State Forest Dept",
    url: "https://github.com/yashveeeeeeer/india-geodata (environment/forests)",
    notes: "Recorded Forest Area (RFA) — legally recorded forest land (FCA 1980). Complements SOI forest_legal",
  },

  // National Wetland Atlas INVENTORY — screening only, NOT notified legal.
  wetland_inventory: {
    source_id: "wetland_inventory",
    layer_code: "wetland_inventory",
    class: "amber",
    legal_tier: 7,
    is_legal_boundary: false,
    license: "GovOpenData (Parivesh / National Wetland Atlas, SAC-ISRO)",
    authority: "SAC-ISRO / MoEFCC (inventory)",
    url: "https://github.com/yashveeeeeeer/india-geodata (water/wetlands)",
    notes:
      "National Wetland Atlas inventory (every river/pond) — screening proxy ONLY, NOT notified under Wetlands Rules 2017. is_legal_boundary=false",
  },

  // ASI monument point locations (OSM historic + ASI operator) — buffered in C1.
  asi: {
    source_id: "asi",
    layer_code: "asi_prohibited_100m",
    class: "red",
    legal_tier: 3,
    is_legal_boundary: false,
    license: "ODbL (OpenStreetMap) / data.gov.in",
    authority: "ASI / NMA",
    url: "https://overpass-api.de",
    notes:
      "Centrally Protected Monument point locations (AMASR Act 1958). Buffered 100m/300m in C1 — buffer off point, verify protected limit",
  },

  // ── Phase C: buffer-derived legal zones (derived sources) ──────────────────
  derived_asi: {
    source_id: "derived_asi",
    layer_code: "asi_prohibited_100m",
    class: "red",
    legal_tier: 6,
    is_legal_boundary: false,
    license: "Derived (data.gov.in / OSM monument locations)",
    authority: "ASI / NMA",
    notes:
      "AMASR Act 1958 §20A/§20B. 100 m red + 300 m amber buffers off monument locations. is_legal=false when buffered off a point",
  },
  derived_esz: {
    source_id: "derived_esz",
    layer_code: "esz_default_10km",
    class: "amber",
    legal_tier: 6,
    is_legal_boundary: false,
    license: "Derived (10 km buffer off PA layer)",
    authority: "—",
    notes:
      "Default 10 km ESZ until notified (Wildlife Action Plan 2002; SC 2022 min 1 km). Notified ESZ supersedes per-PA",
  },
  derived_settlement: {
    source_id: "derived_settlement",
    layer_code: "settlement_500m",
    class: "red",
    legal_tier: 6,
    is_legal_boundary: false,
    license: "Derived (DBSCAN + 500 m buffer off buildings)",
    authority: "—",
    notes: "MNRE siting practice (15+ inhabited buildings) — DBSCAN cluster + 500 m buffer",
  },

  // ── Phase E: infrastructure inputs for dynamic setbacks (not exclusions) ────
  geofabrik: {
    source_id: "geofabrik",
    layer_code: "infra",
    class: null,
    legal_tier: 5,
    is_legal_boundary: false,
    license: "ODbL (OpenStreetMap / Geofabrik)",
    authority: "OSM community",
    url: "https://download.geofabrik.de/asia/india-latest.osm.pbf",
    notes: "roads/rail/power-line/buildings for ST_DWithin setbacks + settlement clusters",
  },

  // ── Phase D: manual gazette uploads (highest legal value) ──────────────────
  manual_gazette: {
    source_id: "manual_gazette",
    layer_code: "esz_notified",
    class: "amber",
    legal_tier: 1,
    is_legal_boundary: true,
    license: "GovOpenData (e-Gazette / PARIVESH)",
    authority: "MoEFCC / State (per notification)",
    notes:
      "Notified ESZ / gazette-verified PA / exact RF-PF / monument protected limits. Each upload carries its own gazette ref in attrs",
  },
};

/** Upsert a registry row. Returns the source_id. Sets acquired_at to now() unless given. */
export async function seedSource(
  pool: Pool,
  def: SourceDef,
  acquiredAt: string = new Date().toISOString(),
): Promise<string> {
  await pool.query(
    `INSERT INTO wce.source_registry
       (source_id, layer_code, class, legal_tier, is_legal_boundary,
        license, authority, url, acquired_at, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (source_id) DO UPDATE SET
       layer_code        = EXCLUDED.layer_code,
       class             = EXCLUDED.class,
       legal_tier        = EXCLUDED.legal_tier,
       is_legal_boundary = EXCLUDED.is_legal_boundary,
       license           = EXCLUDED.license,
       authority         = EXCLUDED.authority,
       url               = EXCLUDED.url,
       acquired_at       = EXCLUDED.acquired_at,
       notes             = EXCLUDED.notes,
       updated_at        = now()`,
    [
      def.source_id,
      def.layer_code,
      def.class,
      def.legal_tier,
      def.is_legal_boundary,
      def.license,
      def.authority ?? null,
      def.url ?? null,
      acquiredAt,
      def.notes ?? null,
    ],
  );
  return def.source_id;
}

export function requireSource(id: string): SourceDef {
  const def = SOURCES[id];
  if (!def) throw new Error(`Unknown source_id "${id}" — add it to registry.ts SOURCES`);
  return def;
}
