-- Mounted into the postgis container at /docker-entrypoint-initdb.d/, so it
-- runs once on first DB init. Safe to re-run by hand against an existing DB.
--
-- Data is wind-mast measurement-site points sourced from NIWE / WRA mast
-- inventory CSV (wra_masts.csv). Each row = one mast.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- DROP allows re-running the SQL by hand to pick up schema changes. The
-- ingest script also supports --truncate for data-only resets.
DROP TABLE IF EXISTS windmills CASCADE;

CREATE TABLE windmills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom            GEOMETRY(Point, 4326) NOT NULL,
  cum_no          INTEGER,
  sl_no           INTEGER,
  state           TEXT,
  station         TEXT,
  district        TEXT,
  date_commence   DATE,
  date_close      DATE,
  mast_height_m   NUMERIC,
  elevation_masl  NUMERIC,
  maws_ms         NUMERIC,    -- mean annual wind speed (m/s)
  mawpd_wm2       NUMERIC,    -- mean annual wind power density (W/m²)
  coord_complete  BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_windmills_geom  ON windmills USING GIST (geom);
CREATE INDEX idx_windmills_state ON windmills (state);
