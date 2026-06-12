import type { AnalysisResponse } from "./types";

/**
 * Flatten an analysis into copy-as-CSV `key,value` rows (plan §4 Phase 5):
 * every available stat plus the sizing assumptions; unavailable sections are
 * recorded as `<section>_status,unavailable` so a pasted sheet is explicit
 * about what was missing rather than silently shorter.
 */

function esc(v: string | number | boolean | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function analysisToCsv(a: AnalysisResponse): string {
  const rows: [string, string | number | boolean | null][] = [
    ["analysisVersion", a.analysisVersion],
    ["areaKm2", a.aoi.areaKm2],
    ["centroidLon", a.aoi.centroid[0]],
    ["centroidLat", a.aoi.centroid[1]],
    ["isPointMode", a.aoi.isPointMode],
    ["score", a.score.value],
    ["scoreConfidence", a.score.confidence],
  ];

  for (const c of a.score.components) {
    rows.push([`score_${c.key}_points`, c.points]);
    rows.push([`score_${c.key}_raw`, c.raw]);
  }

  const r = a.sections.resource;
  if (r.status === "ok" && r.data) {
    const d = r.data;
    rows.push(
      ["meanSpeedMs", d.meanSpeed],
      ["minSpeedMs", d.minSpeed],
      ["maxSpeedMs", d.maxSpeed],
      ["p25SpeedMs", d.p25Speed],
      ["p50SpeedMs", d.p50Speed],
      ["p75SpeedMs", d.p75Speed],
      ["areaExceedance90Ms", d.areaExceedance90],
      ["powerDensityWm2", d.powerDensity],
      ["powerDensityRawWm2", d.powerDensityRaw],
      ["airDensityKgM3", d.airDensity],
      ["cfIec3", d.cfIec3],
      ["cfIec2", d.cfIec2],
      ["shearAlpha", d.shearAlpha],
      ["weibullA", d.weibull?.A ?? null],
      ["weibullK", d.weibull?.k ?? null],
      ["indiaPercentile", d.indiaPercentile],
      ["siteClass", d.siteClass],
    );
  } else {
    rows.push(["resource_status", "unavailable"]);
  }

  const v = a.sections.validation;
  if (v.status === "ok" && v.data) {
    rows.push(
      ["mastCountInAoi", v.data.mastCountInAoi],
      ["nearestMastStation", v.data.nearestMast?.station ?? null],
      ["nearestMastDistanceKm", v.data.nearestMast?.distanceKm ?? null],
      ["nearestMastMawsMs", v.data.nearestMast?.maws ?? null],
      ["modelDeltaPct", v.data.modelDeltaPct],
      ["validationConfidence", v.data.confidence],
    );
  } else {
    rows.push(["validation_status", "unavailable"]);
  }

  const g = a.sections.grid;
  if (g.status === "ok" && g.data) {
    rows.push(
      ["nearestSubstationName", g.data.nearestSubstation?.name ?? null],
      ["nearestSubstationKv", g.data.nearestSubstation?.voltageKv ?? null],
      ["nearestSubstationKm", g.data.nearestSubstation?.distanceKm ?? null],
      ["nearestLineKv", g.data.nearestLine?.voltageKv ?? null],
      ["nearestLineKm", g.data.nearestLine?.distanceKm ?? null],
      ["ehvWithin25Km", g.data.ehvWithin25Km],
      ["gridDataNote", g.data.dataNote],
    );
  } else {
    rows.push(["grid_status", "unavailable"]);
  }

  const c = a.sections.context;
  if (c.status === "ok" && c.data) {
    rows.push(
      ["statesInAoi", c.data.states.map((s) => s.name).join("; ") || null],
      ["windfarmCount", c.data.windfarms.count],
      ["windfarmOverlapFraction", c.data.windfarms.overlapFraction],
      ["capacityMw", c.data.sizing.capacityMw],
      ["energyGwh", c.data.sizing.energyGwh],
    );
    if (c.data.terrain) {
      rows.push(
        ["elevMeanM", c.data.terrain.elevMean],
        ["slopeMeanDeg", c.data.terrain.slopeMeanDeg],
        ["slopeSteep10Deg", c.data.terrain.slopeSteep10Deg],
      );
    }
    c.data.sizing.assumptions.forEach((assumption, i) => {
      rows.push([`assumption_${i + 1}`, assumption]);
    });
  } else {
    rows.push(["context_status", "unavailable"]);
  }

  rows.push(["disclaimer", "Screening estimate - not bankable"]);

  return ["key,value", ...rows.map(([k, val]) => `${esc(k)},${esc(val)}`)].join("\n");
}
