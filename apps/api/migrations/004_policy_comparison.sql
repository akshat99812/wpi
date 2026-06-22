-- WCE wind-policy comparison tables (in the existing `wce.*` schema).
--
-- Mounted into the postgis container at /docker-entrypoint-initdb.d/, so it runs
-- once on first DB init (alphabetical after 003_exclusions.sql). The DB in this
-- project was already initialised before this file existed, so on existing
-- machines it must be applied by hand:
--
--   docker exec -i wce-postgis-1 psql -U wpi -d wpi < apps/api/migrations/004_policy_comparison.sql
--
-- Safe to re-run: CREATE ... IF NOT EXISTS, so re-applying never drops loaded
-- rows. For a data-only reset, re-run the seed loader (db/seed/policy_seed.ts).
--
-- Model (feature spec §3): Indian wind policy is two-layered — a national
-- framework that applies everywhere, and state-level variance. "National" is a
-- jurisdiction ROW (kind='national'), not a flag, so national-vs-state diffing
-- is just one jurisdiction's value diffed against another's.
--
--   jurisdiction      National + the wind-relevant states; carries state geom
--   policy_dimension  the canonical taxonomy = the ROWS of every comparison
--   policy_value      one row per (jurisdiction, dimension, policy_year) = the CELLS
--
-- Every policy_value is sourced: raw_excerpt + source_url are mandatory in the
-- loader (a comparison tool with no citations is not trustworthy for policy).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS wce;

-- ── Jurisdictions ───────────────────────────────────────────────────────────
-- National is a row (kind='national', state_code NULL, geom NULL). States reuse
-- the India state-boundary polygons (loaded from data/cache/india_states.geojson).
CREATE TABLE IF NOT EXISTS wce.jurisdiction (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('national','state')),
  name        TEXT NOT NULL,                       -- 'India (National)', 'Tamil Nadu'
  state_code  TEXT UNIQUE,                         -- 'TN','GJ',... ; NULL for national
  geom        GEOMETRY(MultiPolygon, 4326)         -- NULL ok for national
);
CREATE INDEX IF NOT EXISTS idx_jurisdiction_geom ON wce.jurisdiction USING GIST (geom);

-- ── Dimension taxonomy (the comparison rows) ────────────────────────────────
-- value_type drives which value_* column a cell populates and how it renders.
CREATE TABLE IF NOT EXISTS wce.policy_dimension (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,                -- stable machine key (API contract)
  label       TEXT NOT NULL,                       -- table header
  category    TEXT NOT NULL,                       -- row section grouping
  value_type  TEXT NOT NULL CHECK (value_type IN ('numeric','boolean','enum','text')),
  unit        TEXT,                                -- '%','₹/kWh','kW', NULL
  enum_values TEXT[],                              -- allowed values when value_type='enum'
  description TEXT,                                -- tooltip explaining the dimension
  sort_order  INT NOT NULL DEFAULT 0
);

-- ── Policy values (the comparison cells) ────────────────────────────────────
-- Exactly one of value_numeric / value_bool / value_enum / value_text is set,
-- matching the dimension's value_type. Enforced in the loader (db/seed/policy_seed.ts),
-- NOT a DB constraint (spec §3) — keeps the loader the single source of truth.
--
-- DEVIATION (approved): for a NUMERIC dimension whose policy is expressed as a
-- RULE rather than a fixed number (e.g. TN wheeling = "50% of the conventional
-- charge"), the cell carries value_text instead of value_numeric. The API marks
-- such a cell basis='rule' (inferred: numeric dimension + value_text present),
-- renders it verbatim and EXCLUDES it from the choropleth. A genuinely-absent
-- (jurisdiction, dimension) pair = "silent" → renders grey, never 0.
CREATE TABLE IF NOT EXISTS wce.policy_value (
  id              SERIAL PRIMARY KEY,
  jurisdiction_id INT NOT NULL REFERENCES wce.jurisdiction(id) ON DELETE CASCADE,
  dimension_id    INT NOT NULL REFERENCES wce.policy_dimension(id) ON DELETE CASCADE,
  value_numeric   NUMERIC,
  value_bool      BOOLEAN,
  value_enum      TEXT,
  value_text      TEXT,
  raw_excerpt     TEXT,                            -- verbatim policy sentence (hover)
  source_name     TEXT,                            -- 'GERC Wind Policy 2016', etc.
  source_url      TEXT,
  policy_year     INT,                             -- year the value applies to
  as_of_date      DATE,                            -- when last verified
  confidence      TEXT CHECK (confidence IN ('verified','extracted','estimated')) DEFAULT 'extracted',
  UNIQUE (jurisdiction_id, dimension_id, policy_year)
);
CREATE INDEX IF NOT EXISTS idx_policy_value_jur ON wce.policy_value(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_policy_value_dim ON wce.policy_value(dimension_id);
