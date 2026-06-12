/**
 * Phase 1 end-to-end smoke (throwaway probe, no HTTP/auth):
 *   bun scripts/probes/phase1_smoke.ts
 *
 * Runs validateAoi + analyzeAoi directly for
 *   (a) Muppandal 5×5 km point-mode square (8.26 N, 77.55 E)
 *   (b) Bhadla 5×5 km point-mode square (27.53 N, 71.92 E)
 *   (c) a ~40×40 km hand polygon over the Muppandal corridor
 * prints the full JSON for each, then verifies the VERIFIED.md golden bands
 * and reports cold vs warm wall-clock for the large polygon.
 *
 * Uses a FRESH TILE_CACHE_DIR so the "cold" numbers are honest network
 * fetches; the second run of each AOI exercises the warm disk-tile path.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeAoi } from "../../src/services/analysis";
import { validateAoi } from "../../src/services/analysis/geometry";
import { squareRingAround } from "../../src/services/analysis/mercator";
import {
  getCachedResult,
  putCachedResult,
  resultCacheKey,
} from "../../src/services/analysis/resultCache";
import type {
  AnalysisResponse,
  GeoJsonPolygon,
} from "../../src/services/analysis/types";
import { gammaFn } from "../../src/services/analysis/weibull";

const MUPPANDAL = { lon: 77.55, lat: 8.26 };
const BHADLA = { lon: 71.92, lat: 27.53 };
const POINT_SQUARE_KM = 5;

/** VERIFIED.md golden bands. */
const CF3_BAND = { min: 0.632, max: 0.712 };
/** Exact-pixel ws100 = 9.4894 (VERIFIED.md §1) ± the documented ~0.8 m/s
 *  AOI-mean delta in the sharp corridor gradient ("explainable, not a bug").
 *  The live Weibull COGs corroborate: area-mean A·Γ(1+1/k) ≈ 9.75. */
const MEAN_SPEED_BAND = { min: 8.7, max: 10.3 };
const SHEAR_BAND = { min: 0.2, max: 0.3 };
const WEIBULL_MEAN_REL_TOL = 0.05;
const BHADLA_SPEED_BAND = { min: 5.5, max: 6.5 };
const BUDGET_MS = 15_000;

function squarePolygon(lon: number, lat: number): GeoJsonPolygon {
  return {
    type: "Polygon",
    coordinates: [squareRingAround(lon, lat, POINT_SQUARE_KM).map((p) => [...p])],
  };
}

/** ~40×40 km irregular hand polygon over the Muppandal corridor. */
const CORRIDOR_POLYGON: GeoJsonPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [77.37, 8.08],
      [77.73, 8.1],
      [77.76, 8.3],
      [77.6, 8.44],
      [77.4, 8.42],
      [77.33, 8.25],
      [77.37, 8.08],
    ],
  ],
};

interface SmokeRun {
  label: string;
  response: AnalysisResponse;
  coldMs: number;
  warmMs: number;
}

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function runAoi(label: string, polygon: GeoJsonPolygon): Promise<SmokeRun> {
  const aoi = validateAoi(polygon);
  console.log(
    `\n=== ${label} === areaKm2=${aoi.areaKm2.toFixed(2)} pointMode=${aoi.isPointMode} centroid=[${aoi.centroid.map((c) => c.toFixed(4)).join(", ")}]`,
  );

  const coldStart = performance.now();
  const response = await analyzeAoi(aoi);
  const coldMs = Math.round(performance.now() - coldStart);

  const warmStart = performance.now();
  await analyzeAoi(aoi);
  const warmMs = Math.round(performance.now() - warmStart);

  // Exercise the result cache exactly the way the route does.
  const key = resultCacheKey(aoi);
  await putCachedResult(key, response);
  const cached = await getCachedResult(key);
  console.log(
    `[smoke] ${label}: cold=${coldMs}ms warm=${warmMs}ms resultCache=${cached !== null ? "round-trip OK" : "ROUND-TRIP FAILED"} key=${key}`,
  );
  console.log(JSON.stringify(response, null, 2));
  return { label, response, coldMs, warmMs };
}

function verifyMuppandal(run: SmokeRun): void {
  const data = run.response.sections.resource.data;
  if (data === null) {
    check("Muppandal resource section", false, "status=unavailable");
    return;
  }
  check(
    "Muppandal cfIec3 in golden band",
    data.cfIec3 !== null && data.cfIec3 >= CF3_BAND.min && data.cfIec3 <= CF3_BAND.max,
    `cfIec3=${data.cfIec3} band=[${CF3_BAND.min}, ${CF3_BAND.max}]`,
  );
  check(
    "Muppandal meanSpeed plausible",
    data.meanSpeed >= MEAN_SPEED_BAND.min && data.meanSpeed <= MEAN_SPEED_BAND.max,
    `meanSpeed=${data.meanSpeed} band=[${MEAN_SPEED_BAND.min}, ${MEAN_SPEED_BAND.max}]`,
  );
  check(
    "Muppandal shearAlpha in 0.2–0.3",
    data.shearAlpha >= SHEAR_BAND.min && data.shearAlpha <= SHEAR_BAND.max,
    `shearAlpha=${data.shearAlpha}`,
  );
  if (data.weibull === null) {
    check("Muppandal weibull present", false, "weibull=null (COGs missing?)");
  } else {
    const implied = data.weibull.A * gammaFn(1 + 1 / data.weibull.k);
    const relErr = Math.abs(implied - data.meanSpeed) / data.meanSpeed;
    check(
      "Muppandal A·Γ(1+1/k) ≈ meanSpeed (±5%)",
      relErr < WEIBULL_MEAN_REL_TOL,
      `A=${data.weibull.A.toFixed(4)} k=${data.weibull.k.toFixed(4)} implied=${implied.toFixed(4)} vs meanSpeed=${data.meanSpeed} (relErr=${(relErr * 100).toFixed(2)}%)`,
    );
  }
  const isOrdered =
    data.areaExceedance90 < data.p25Speed &&
    data.p25Speed < data.p50Speed &&
    data.p50Speed < data.p75Speed &&
    data.p75Speed < data.maxSpeed;
  check(
    "Muppandal areaExceedance90 < p25 < p50 < p75 < max",
    isOrdered,
    `areaExceedance90=${data.areaExceedance90} p25=${data.p25Speed} p50=${data.p50Speed} p75=${data.p75Speed} max=${data.maxSpeed}`,
  );
}

function verifyBhadla(bhadla: SmokeRun, muppandal: SmokeRun): void {
  const data = bhadla.response.sections.resource.data;
  if (data === null) {
    check("Bhadla resource section", false, "status=unavailable");
    return;
  }
  check(
    "Bhadla meanSpeed ~5.5–6.5",
    data.meanSpeed >= BHADLA_SPEED_BAND.min && data.meanSpeed <= BHADLA_SPEED_BAND.max,
    `meanSpeed=${data.meanSpeed}`,
  );
  check(
    "Bhadla score < Muppandal score",
    bhadla.response.score.value < muppandal.response.score.value,
    `Bhadla=${bhadla.response.score.value} vs Muppandal=${muppandal.response.score.value}`,
  );
}

async function main(): Promise<void> {
  const smokeCacheDir = await mkdtemp(path.join(tmpdir(), "phase1-smoke-cache-"));
  process.env.TILE_CACHE_DIR = smokeCacheDir;
  console.log(`[smoke] fresh TILE_CACHE_DIR=${smokeCacheDir} (honest cold runs)`);

  try {
    const muppandal = await runAoi(
      "Muppandal 5×5 km point square",
      squarePolygon(MUPPANDAL.lon, MUPPANDAL.lat),
    );
    const bhadla = await runAoi(
      "Bhadla 5×5 km point square",
      squarePolygon(BHADLA.lon, BHADLA.lat),
    );
    const corridor = await runAoi("Muppandal corridor ~40×40 km polygon", CORRIDOR_POLYGON);

    console.log("\n=== Verification vs VERIFIED.md ===");
    verifyMuppandal(muppandal);
    verifyBhadla(bhadla, muppandal);
    check(
      "Large polygon inside 15 s budget (cold)",
      corridor.coldMs < BUDGET_MS && corridor.response.sections.resource.status === "ok",
      `cold=${corridor.coldMs}ms warm=${corridor.warmMs}ms budget=${BUDGET_MS}ms status=${corridor.response.sections.resource.status}`,
    );

    const failures = checks.filter((c) => !c.pass);
    console.log(
      `\n[smoke] ${checks.length - failures.length}/${checks.length} checks passed`,
    );
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await rm(smokeCacheDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[smoke] crashed:", err);
  process.exit(1);
});
