// Per-OEM turbine model catalogue (LOGISTICS_TOOL_PLAN.md §4.2) and the
// component → transport-envelope assembly (§4.3).
//
// All six covered OEMs use geared DFIG drivetrains, so the gearbox + generator
// ship INSIDE the nacelle — there is no separate drivetrain ODC load. Weights
// and most dimensions are engineering estimates `(E)`; rotor diameter and the
// headline blade length are mostly official. Every model is flagged
// `estimated: true` so the UI can show a disclaimer.
//
// Tower section length defaults to 30 m — the practical road-transport maximum
// for a tubular can — for every model (none are noted otherwise in §4.2).

import type {
  ComponentCategory,
  OEM,
  Shipment,
  TrailerType,
  TurbineModel,
} from "./types";

// Blade transport width (max chord): 3.5 m for large rotors, else 3.0 m (§4.3).
const WIDE_CHORD_ROTOR_M = 128;
function chordFor(rotorDiameterM: number): number {
  return rotorDiameterM >= WIDE_CHORD_ROTOR_M ? 3.5 : 3.0;
}

const DEFAULT_TOWER_SECTION_LENGTH_M = 30;

// Compact row → TurbineModel. `bladeMaxChordM` and `towerSectionLengthM` are
// derived so the data tables stay terse and consistent with §4.3.
interface Row {
  model: string;
  ratedMW: number;
  rotorDiameterM: number;
  bladeLengthM: number;
  bladeWeightT: number;
  nacelleWeightT: number;
  hubWeightT: number;
  towerSections: number;
  towerSectionWeightT: number;
  towerBaseDiameterM: number;
  hubHeightsM: number[];
  era?: TurbineModel["era"];
  note?: string;
}

function model(oem: OEM, r: Row): TurbineModel {
  return {
    model: r.model,
    oem,
    ratedMW: r.ratedMW,
    rotorDiameterM: r.rotorDiameterM,
    bladeLengthM: r.bladeLengthM,
    bladeWeightT: r.bladeWeightT,
    bladeMaxChordM: chordFor(r.rotorDiameterM),
    nacelleWeightT: r.nacelleWeightT,
    hubWeightT: r.hubWeightT,
    towerSections: r.towerSections,
    towerSectionLengthM: DEFAULT_TOWER_SECTION_LENGTH_M,
    towerSectionWeightT: r.towerSectionWeightT,
    towerBaseDiameterM: r.towerBaseDiameterM,
    hubHeightsM: r.hubHeightsM,
    era: r.era,
    estimated: true,
    note: r.note,
  };
}

export const TURBINES: TurbineModel[] = [
  // ── Suzlon ────────────────────────────────────────────────────────────
  model("suzlon", { model: "S52", ratedMW: 0.6, rotorDiameterM: 52, bladeLengthM: 25, bladeWeightT: 3, nacelleWeightT: 25, hubWeightT: 5, towerSections: 3, towerSectionWeightT: 25, towerBaseDiameterM: 3.0, hubHeightsM: [50, 75], era: "classic" }),
  model("suzlon", { model: "S64", ratedMW: 1.25, rotorDiameterM: 64, bladeLengthM: 31, bladeWeightT: 5, nacelleWeightT: 35, hubWeightT: 8, towerSections: 3, towerSectionWeightT: 30, towerBaseDiameterM: 3.3, hubHeightsM: [65, 75], era: "classic" }),
  model("suzlon", { model: "S97", ratedMW: 2.1, rotorDiameterM: 97, bladeLengthM: 47.5, bladeWeightT: 7.5, nacelleWeightT: 70, hubWeightT: 20, towerSections: 4, towerSectionWeightT: 35, towerBaseDiameterM: 4.04, hubHeightsM: [80, 90, 100], era: "current" }),
  model("suzlon", { model: "S111", ratedMW: 2.1, rotorDiameterM: 111.8, bladeLengthM: 54, bladeWeightT: 9.5, nacelleWeightT: 72, hubWeightT: 22, towerSections: 4, towerSectionWeightT: 40, towerBaseDiameterM: 4.2, hubHeightsM: [90, 120], era: "current" }),
  model("suzlon", { model: "S120", ratedMW: 2.1, rotorDiameterM: 120, bladeLengthM: 59, bladeWeightT: 11, nacelleWeightT: 75, hubWeightT: 23, towerSections: 4, towerSectionWeightT: 45, towerBaseDiameterM: 4.2, hubHeightsM: [90, 120, 140], era: "current" }),
  model("suzlon", { model: "S128", ratedMW: 2.8, rotorDiameterM: 128, bladeLengthM: 63, bladeWeightT: 12.5, nacelleWeightT: 80, hubWeightT: 25, towerSections: 4, towerSectionWeightT: 50, towerBaseDiameterM: 4.5, hubHeightsM: [120, 140], era: "current" }),
  model("suzlon", { model: "S133", ratedMW: 3.0, rotorDiameterM: 133, bladeLengthM: 65.5, bladeWeightT: 13.5, nacelleWeightT: 85, hubWeightT: 27, towerSections: 4, towerSectionWeightT: 55, towerBaseDiameterM: 4.6, hubHeightsM: [120, 140, 160], era: "current" }),
  model("suzlon", { model: "S144", ratedMW: 3.15, rotorDiameterM: 144, bladeLengthM: 70.5, bladeWeightT: 15, nacelleWeightT: 92, hubWeightT: 28, towerSections: 4, towerSectionWeightT: 60, towerBaseDiameterM: 4.8, hubHeightsM: [140, 160], era: "next" }),

  // ── Inox Wind (AMSC-licensed DFIG) ────────────────────────────────────
  model("inox", { model: "DF 100", ratedMW: 2.0, rotorDiameterM: 100, bladeLengthM: 48.7, bladeWeightT: 8, nacelleWeightT: 65, hubWeightT: 20, towerSections: 3, towerSectionWeightT: 60, towerBaseDiameterM: 4.0, hubHeightsM: [80, 92], era: "current" }),
  model("inox", { model: "DF 113", ratedMW: 2.0, rotorDiameterM: 113, bladeLengthM: 54.9, bladeWeightT: 10, nacelleWeightT: 70, hubWeightT: 22, towerSections: 4, towerSectionWeightT: 70, towerBaseDiameterM: 4.1, hubHeightsM: [92, 120], era: "current" }),
  model("inox", { model: "DF 3.3-145", ratedMW: 3.3, rotorDiameterM: 145, bladeLengthM: 70.5, bladeWeightT: 25, nacelleWeightT: 95, hubWeightT: 40, towerSections: 4, towerSectionWeightT: 80, towerBaseDiameterM: 4.5, hubHeightsM: [100, 122.5, 140], era: "next", note: "DF/3000/145 — TUV SUD type-certified 3 MW class." }),

  // ── Vestas (towers sourced locally) ───────────────────────────────────
  model("vestas", { model: "V120-2.2", ratedMW: 2.2, rotorDiameterM: 120, bladeLengthM: 59, bladeWeightT: 10, nacelleWeightT: 70, hubWeightT: 20, towerSections: 3, towerSectionWeightT: 65, towerBaseDiameterM: 4.2, hubHeightsM: [80, 95, 120, 140], era: "current" }),
  model("vestas", { model: "V150-4.2", ratedMW: 4.2, rotorDiameterM: 150, bladeLengthM: 73.65, bladeWeightT: 22, nacelleWeightT: 75, hubWeightT: 24, towerSections: 4, towerSectionWeightT: 85, towerBaseDiameterM: 4.3, hubHeightsM: [105, 125], era: "next" }),
  model("vestas", { model: "V155-3.3", ratedMW: 3.3, rotorDiameterM: 155, bladeLengthM: 76.2, bladeWeightT: 24, nacelleWeightT: 72, hubWeightT: 24, towerSections: 4, towerSectionWeightT: 85, towerBaseDiameterM: 4.3, hubHeightsM: [140], era: "next", note: "India low-wind variant." }),
  model("vestas", { model: "V162-6.2", ratedMW: 6.2, rotorDiameterM: 162, bladeLengthM: 79.35, bladeWeightT: 32, nacelleWeightT: 105, hubWeightT: 40, towerSections: 5, towerSectionWeightT: 110, towerBaseDiameterM: 4.5, hubHeightsM: [166], era: "next", note: "EnVentus platform." }),

  // ── Siemens Gamesa / Vayona ───────────────────────────────────────────
  model("siemensgamesa", { model: "G114-2.0", ratedMW: 2.0, rotorDiameterM: 114, bladeLengthM: 55.5, bladeWeightT: 8, nacelleWeightT: 80, hubWeightT: 20, towerSections: 4, towerSectionWeightT: 50, towerBaseDiameterM: 4.1, hubHeightsM: [93, 120, 140], era: "current" }),
  model("siemensgamesa", { model: "SG 2.6-114", ratedMW: 2.6, rotorDiameterM: 114, bladeLengthM: 56, bladeWeightT: 9, nacelleWeightT: 80, hubWeightT: 20, towerSections: 4, towerSectionWeightT: 55, towerBaseDiameterM: 4.1, hubHeightsM: [93, 125], era: "current" }),
  model("siemensgamesa", { model: "G132-3.3", ratedMW: 3.3, rotorDiameterM: 132, bladeLengthM: 64.5, bladeWeightT: 15, nacelleWeightT: 90, hubWeightT: 25, towerSections: 4, towerSectionWeightT: 65, towerBaseDiameterM: 4.3, hubHeightsM: [84, 97, 114, 134], era: "current" }),
  model("siemensgamesa", { model: "SG 3.4-145", ratedMW: 3.465, rotorDiameterM: 145, bladeLengthM: 71, bladeWeightT: 21, nacelleWeightT: 100, hubWeightT: 30, towerSections: 5, towerSectionWeightT: 85, towerBaseDiameterM: 4.5, hubHeightsM: [127.5, 133.5, 146], era: "next", note: "Blade = LM 71.0." }),

  // ── Envision (towers sourced locally) ─────────────────────────────────
  model("envision", { model: "EN-156/3.3", ratedMW: 3.3, rotorDiameterM: 156, bladeLengthM: 76.5, bladeWeightT: 15, nacelleWeightT: 65, hubWeightT: 28, towerSections: 4, towerSectionWeightT: 85, towerBaseDiameterM: 4.5, hubHeightsM: [120, 140], era: "next" }),
  model("envision", { model: "EN-182/5.0", ratedMW: 5.0, rotorDiameterM: 181, bladeLengthM: 89, bladeWeightT: 24, nacelleWeightT: 100, hubWeightT: 50, towerSections: 5, towerSectionWeightT: 110, towerBaseDiameterM: 4.8, hubHeightsM: [130, 140], era: "next", note: "RLMM-approved 5 MW." }),

  // ── Adani Wind (integrated Mundra; towers sourced locally) ────────────
  model("adani", { model: "Adani 3.3-164", ratedMW: 3.3, rotorDiameterM: 164, bladeLengthM: 80.5, bladeWeightT: 22, nacelleWeightT: 95, hubWeightT: 25, towerSections: 5, towerSectionWeightT: 85, towerBaseDiameterM: 4.5, hubHeightsM: [140], era: "next" }),
  model("adani", { model: "Adani 5.2-160", ratedMW: 5.2, rotorDiameterM: 160, bladeLengthM: 78.5, bladeWeightT: 20, nacelleWeightT: 115, hubWeightT: 30, towerSections: 5, towerSectionWeightT: 90, towerBaseDiameterM: 4.6, hubHeightsM: [120, 140], era: "next", note: "MNRE RLMM-listed." }),
  model("adani", { model: "Adani 5.0-185", ratedMW: 5.0, rotorDiameterM: 185, bladeLengthM: 91.2, bladeWeightT: 32, nacelleWeightT: 110, hubWeightT: 50, towerSections: 5, towerSectionWeightT: 110, towerBaseDiameterM: 4.8, hubHeightsM: [140, 160], era: "next", note: "NextGen prototype; India's longest blade (91.2 m)." }),
];

export function turbinesForOem(oem: OEM): TurbineModel[] {
  return TURBINES.filter((t) => t.oem === oem);
}

// Look up by model name within an OEM (model names are unique per OEM).
export function getTurbine(oem: OEM, modelName: string): TurbineModel | undefined {
  return TURBINES.find((t) => t.oem === oem && t.model === modelName);
}

// ── Shipment-spec assembly (§4.3) ───────────────────────────────────────

// Super-ODC: any one of these thresholds triggers police escort + a "special
// permit" badge. Every blade qualifies by length; nacelles by weight; tower
// base cans by width. Hubs typically do not.
const SUPER_ODC = { weightT: 55, widthM: 4.25, heightM: 4.5, lengthM: 30 } as const;
export function isSuperOdc(s: {
  weightT: number;
  widthM: number;
  heightM: number;
  lengthM: number;
}): boolean {
  return (
    s.weightT > SUPER_ODC.weightT ||
    s.widthM > SUPER_ODC.widthM ||
    s.heightM > SUPER_ODC.heightM ||
    s.lengthM > SUPER_ODC.lengthM
  );
}

// Tower trailer choice: heavy base cans need SPMT/hydraulic axles (§4.3).
const HEAVY_TOWER_SECTION_T = 45;
function towerTrailer(weightT: number): TrailerType {
  return weightT > HEAVY_TOWER_SECTION_T ? "hydraulicModular" : "standardMultiAxle";
}

// One distinct ODC load before origin/routing are attached.
export type ShipmentSpec = Omit<
  Shipment,
  "origin" | "towerSourcedLocally" | "distanceKm" | "durationHr" | "routingMode"
>;

function spec(
  component: ComponentCategory,
  label: string,
  countPerTurbine: number,
  trailerType: TrailerType,
  weightT: number,
  lengthM: number,
  widthM: number,
  heightM: number,
): ShipmentSpec {
  return {
    component,
    label,
    countPerTurbine,
    trailerType,
    weightT,
    lengthM,
    widthM,
    heightM,
    superOdc: isSuperOdc({ weightT, widthM, heightM, lengthM }),
  };
}

// Nacelle/hub transport boxes are roughly model-independent for our purposes;
// blade and tower scale with the model (§4.3 envelope table).
function bladeSpec(t: TurbineModel): ShipmentSpec {
  return spec("blade", `Rotor blade (${t.bladeLengthM} m)`, 3, "extendableBlade", t.bladeWeightT, t.bladeLengthM, t.bladeMaxChordM, 4.0);
}
function nacelleSpec(t: TurbineModel): ShipmentSpec {
  return spec("nacelle", `Nacelle (${t.nacelleWeightT} t)`, 1, "hydraulicModular", t.nacelleWeightT, 12, 4.2, 4.0);
}
function hubSpec(t: TurbineModel): ShipmentSpec {
  return spec("hub", "Hub", 1, "standardMultiAxle", t.hubWeightT, 4.5, 4.2, 4.2);
}
function towerSpec(t: TurbineModel): ShipmentSpec {
  return spec(
    "tower",
    `Tower section ×${t.towerSections}`,
    t.towerSections,
    towerTrailer(t.towerSectionWeightT),
    t.towerSectionWeightT,
    t.towerSectionLengthM,
    t.towerBaseDiameterM,
    t.towerBaseDiameterM,
  );
}

const SPEC_BUILDERS: Record<ComponentCategory, (t: TurbineModel) => ShipmentSpec> = {
  blade: bladeSpec,
  nacelle: nacelleSpec,
  hub: hubSpec,
  tower: towerSpec,
};

const COMPONENT_ORDER: ComponentCategory[] = ["blade", "nacelle", "hub", "tower"];

// Build the shipment specs for a model. `component` narrows to a single load
// type (used by scope==="component"); omit it for the whole turbine.
export function assembleSpecs(
  turbine: TurbineModel,
  component?: ComponentCategory,
): ShipmentSpec[] {
  const components = component ? [component] : COMPONENT_ORDER;
  return components.map((c) => SPEC_BUILDERS[c](turbine));
}
