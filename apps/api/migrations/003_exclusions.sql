-- WCE legal exclusion-zone geodatabase (the `wce.*` schema).
--
-- Mounted into the postgis container at /docker-entrypoint-initdb.d/, so it runs
-- once on first DB init (alphabetical after 002_wind_turbines.sql). The DB in
-- this project was already initialised before this file existed, so on existing
-- machines it must be applied by hand:
--
--   docker exec -i wce-postgis-1 psql -U wpi -d wpi < apps/api/migrations/003_exclusions.sql
--
-- Safe to re-run: CREATE ... IF NOT EXISTS, so re-applying never drops loaded
-- features. For a data-only reset use the ingest driver's --truncate.
--
-- This schema is the "engine" the exclusion-plan.md runbook assumes:
--   source_registry  one row per data source — drives the provenance / legal split
--   excl_polygon     downloaded + normalised legal/near-legal polygons (Phase B)
--   excl_buffer      buffer-derived legal zones: ASI / ESZ-default / settlement (Phase C)
--   infra_feature    point/line inputs for dynamic setbacks + buffer inputs (Phase E)
--   admin_country / admin_state   clip mask + state tagging (Phase A, NOT exclusions)
--
-- Every excl_polygon / excl_buffer row FKs to source_registry, so the Phase F
-- "every row resolves to a source" audit is enforced by the database, not a script.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS wce;

-- ── Provenance registry ─────────────────────────────────────────────────────
-- legal_tier: 1 gazette · 2 official govt GIS · 3 official aggregated open data
--           · 4 authoritative global third-party (reference only) · 5 community/OSM
--           · 6 derived/computed buffer · 7 indicative screening proxy.
CREATE TABLE IF NOT EXISTS wce.source_registry (
  source_id          TEXT PRIMARY KEY,
  layer_code         TEXT,                 -- primary layer this source feeds (informational)
  class              TEXT,                 -- 'red' | 'amber' | NULL (infra/admin)
  legal_tier         SMALLINT NOT NULL,
  is_legal_boundary  BOOLEAN  NOT NULL,
  license            TEXT     NOT NULL,
  authority          TEXT,                 -- authoritative body
  url                TEXT,                 -- where it came from
  acquired_at        TIMESTAMPTZ,
  notes              TEXT,                 -- gazette no. / citation / caveat
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT source_registry_class_chk CHECK (class IN ('red','amber') OR class IS NULL),
  CONSTRAINT source_registry_tier_chk  CHECK (legal_tier BETWEEN 1 AND 7)
);

-- ── Downloaded / normalised legal polygons (Phase B) ────────────────────────
CREATE TABLE IF NOT EXISTS wce.excl_polygon (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   TEXT NOT NULL REFERENCES wce.source_registry(source_id) ON DELETE CASCADE,
  layer_code  TEXT NOT NULL,
  class       TEXT NOT NULL,
  geom        GEOMETRY(MultiPolygon, 4326) NOT NULL,
  attrs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  geohash     TEXT,                         -- ST_GeoHash for Phase F dedup
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT excl_polygon_class_chk CHECK (class IN ('red','amber'))
);
CREATE INDEX IF NOT EXISTS idx_excl_polygon_geom   ON wce.excl_polygon USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_excl_polygon_layer  ON wce.excl_polygon (layer_code);
CREATE INDEX IF NOT EXISTS idx_excl_polygon_source ON wce.excl_polygon (source_id);

-- ── Buffer-derived legal zones: ASI / ESZ-default / settlement (Phase C) ─────
CREATE TABLE IF NOT EXISTS wce.excl_buffer (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   TEXT REFERENCES wce.source_registry(source_id) ON DELETE CASCADE,
  layer_code  TEXT NOT NULL,
  class       TEXT NOT NULL,
  rule        TEXT NOT NULL,                -- 'asi_100m' | 'asi_300m' | 'esz_10km' | 'settlement_500m'
  geom        GEOMETRY(MultiPolygon, 4326) NOT NULL,
  attrs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT excl_buffer_class_chk CHECK (class IN ('red','amber'))
);
CREATE INDEX IF NOT EXISTS idx_excl_buffer_geom  ON wce.excl_buffer USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_excl_buffer_layer ON wce.excl_buffer (layer_code);

-- ── Infrastructure inputs for dynamic setbacks + buffer inputs (Phase E) ─────
-- Mixed geometry: points (institution/airport), lines (road/rail/ehv), polys (building).
CREATE TABLE IF NOT EXISTS wce.infra_feature (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   TEXT REFERENCES wce.source_registry(source_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                -- 'road'|'rail'|'ehv'|'building'|'institution'|'airport'
  geom        GEOMETRY(Geometry, 4326) NOT NULL,
  attrs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_infra_feature_geom ON wce.infra_feature USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_infra_feature_kind ON wce.infra_feature (kind);

-- ── Admin base — clip mask + state tagging (Phase A; NOT exclusions) ─────────
CREATE TABLE IF NOT EXISTS wce.admin_country (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT,
  geom  GEOMETRY(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_country_geom ON wce.admin_country USING GIST (geom);

CREATE TABLE IF NOT EXISTS wce.admin_state (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state  TEXT,
  attrs  JSONB NOT NULL DEFAULT '{}'::jsonb,
  geom   GEOMETRY(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_state_geom ON wce.admin_state USING GIST (geom);
