// Jurisdictions seeded for the comparison (feature spec §8.3). National is a row,
// not a flag. State geom comes from data/cache/india_states.geojson, joined on
// the `geom_name` (= the file's ST_NM property, verified exact). National geom NULL.

import type { JurisdictionDef } from "./types";

export const JURISDICTIONS: JurisdictionDef[] = [
  { kind: "national", name: "India (National)", state_code: null, geom_name: null },
  { kind: "state", name: "Tamil Nadu", state_code: "TN", geom_name: "Tamil Nadu" },
  { kind: "state", name: "Gujarat", state_code: "GJ", geom_name: "Gujarat" },
  { kind: "state", name: "Karnataka", state_code: "KA", geom_name: "Karnataka" },
  { kind: "state", name: "Rajasthan", state_code: "RJ", geom_name: "Rajasthan" },
  { kind: "state", name: "Maharashtra", state_code: "MH", geom_name: "Maharashtra" },
  { kind: "state", name: "Kerala", state_code: "KL", geom_name: "Kerala" },
  { kind: "state", name: "Andhra Pradesh", state_code: "AP", geom_name: "Andhra Pradesh" },
  { kind: "state", name: "Madhya Pradesh", state_code: "MP", geom_name: "Madhya Pradesh" },
];

// The API code for the national row (state_code is NULL in the DB).
export const NATIONAL_CODE = "national";
