-- WT-MARUT (NIWE/MNRE) wind-farm district clusters.
--
-- Each row is a GADM district BOUNDARY tagged with that district's summed
-- installed capacity (MW) and turbine count (WEG) from the WT-MARUT registry.
-- It lets the Pro map attribute an individual OSM turbine to the wind-farm
-- cluster it physically sits inside (point-in-polygon), so /api/turbine/:id can
-- answer "which wind farm, how big, how many turbines" alongside raw coords.
--
-- Built by   scripts/build-wind-farms.py  → data/wind-farm-districts.geojson
-- Loaded by  scripts/ingest-wind-farm-districts.ts
--
-- Mounted into the postgis container at /docker-entrypoint-initdb.d/, so it runs
-- once on first DB init (alphabetical after 004_policy_comparison.sql). The DB in
-- this project was already initialised before this file existed, so on existing
-- machines it must be applied by hand:
--
--   docker exec -i wce-postgis-1 psql -U wpi -d wpi < apps/api/migrations/005_wind_farm_districts.sql
--
-- Safe to re-run: CREATE ... IF NOT EXISTS. For a data reset the ingest driver
-- TRUNCATEs + reloads.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS wind_farm_districts (
  district      TEXT PRIMARY KEY,               -- normalised GADM key (dedup key)
  name          TEXT NOT NULL,                  -- display name  (GADM NAME_2)
  state         TEXT NOT NULL,                  -- display state (GADM NAME_1)
  capacity_mw   NUMERIC(10,3) NOT NULL,         -- summed installed capacity (WT-MARUT)
  weg           INTEGER       NOT NULL,         -- summed no. of WEGs (turbine units)
  variants      TEXT[]        NOT NULL DEFAULT '{}', -- source spellings merged in
  geom          GEOMETRY(MultiPolygon, 4326) NOT NULL
);

-- Drives the per-click point-in-polygon lookup: ST_Contains(geom, turbine_point).
CREATE INDEX IF NOT EXISTS idx_wind_farm_districts_geom
  ON wind_farm_districts USING GIST (geom);
