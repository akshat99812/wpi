-- Mounted into the postgis container at /docker-entrypoint-initdb.d/, so it
-- runs once on first DB init (alphabetical after 001_windmills.sql). The DB in
-- this project was already initialised before this file existed, so on existing
-- machines it must be applied by hand:
--
--   docker exec -i wce-postgis-1 psql -U wpi -d wpi < apps/api/migrations/002_wind_turbines.sql
--
-- Safe to re-run: CREATE ... IF NOT EXISTS, so re-applying never drops ingested
-- turbines. For a data-only reset use the ingest script's --truncate; for a
-- schema change, DROP the table by hand first (then re-apply + re-ingest).
--
-- Data is INDIVIDUAL physical wind turbines from OpenStreetMap / OpenInfraMap
-- (power=generator + generator:source=wind), ingested via Overpass by
-- scripts/ingest-turbines.ts. One row per turbine. Distinct from `windmills`,
-- which holds NIWE/WRA wind-monitoring MAST points, not turbines.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS wind_turbines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- OSM identity. A turbine is unique per (type, id); ways are turbines mapped
  -- as small areas (we store the centroid). The pair drives idempotent upsert.
  osm_type          TEXT NOT NULL,                 -- 'node' | 'way'
  osm_id            BIGINT NOT NULL,
  geom              GEOMETRY(Point, 4326) NOT NULL,
  name              TEXT,
  operator          TEXT,
  manufacturer      TEXT,
  model             TEXT,                          -- generator:type / model / manufacturer:type
  rated_power_kw    NUMERIC,                        -- parsed from generator:output:electricity
  rated_power_raw   TEXT,                           -- original tag value (e.g. "2.1 MW")
  hub_height_m      NUMERIC,                        -- height:hub, else height
  rotor_diameter_m  NUMERIC,                        -- rotor:diameter
  start_date        TEXT,                           -- OSM start_date (messy formats → keep raw)
  ele_m             NUMERIC,                        -- ground elevation tag, if present
  ref               TEXT,                           -- turbine ref/number
  tags              JSONB,                          -- full OSM tag bag (completeness)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (osm_type, osm_id)
);

-- Spatial index drives the MVT tile bbox query (geom && tile envelope).
CREATE INDEX IF NOT EXISTS idx_wind_turbines_geom ON wind_turbines USING GIST (geom);
