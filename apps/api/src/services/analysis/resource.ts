/**
 * Section A — resource statistics. Pure functions over stitched GWA layer
 * patches + the AOI pixel mask. No I/O except indiaCdf's one-time artifact
 * read (degrades to null) and console.warn on sanity-clamp events.
 *
 * Sources of truth: plan.md §2/§3 (domain decisions, response contract) and
 * VERIFIED.md §1 (layer units, CF negative-artifact clamp, the pinned
 * barometric formula, shear ln-ratio least-squares method).
 */

import { SITE_CLASS_BANDS, SIZING_MW_PER_KM2 } from "./constants";
import { computePowerCurveCfs } from "./energy";
import { computeNetCf } from "./losses";
import { computeExceedance } from "./uncertainty";
import { indiaPercentileOf } from "./indiaCdf";
import type { AoiMask, LayerPatch, ResourceData, SiteClass } from "./types";

export type ResourceLayerKey =
  | "cfIec3"
  | "cfIec2"
  | "ws50"
  | "ws100"
  | "ws150"
  | "pd100"
  | "elevation";

export type ResourcePatches = Record<ResourceLayerKey, LayerPatch>;

// ── Pinned formula constants (plan §2.4 / VERIFIED.md §1) ──────────────────

const SEA_LEVEL_AIR_DENSITY_KG_M3 = 1.225;
const BAROMETRIC_LAPSE_PER_M = 2.2558e-5;
const BAROMETRIC_EXPONENT = 5.256;

/** Heights of the three GWA mean-speed layers used for the shear fit. */
const SHEAR_FIT_HEIGHTS_M = [50, 100, 150] as const;
/** Physical sanity band for the power-law shear exponent (exported so the
 *  per-point report clamps identically to the AOI path). */
export const SHEAR_ALPHA_MIN = 0;
export const SHEAR_ALPHA_MAX = 0.6;
/** 1/7 power law — used only if the 50/150 m layers are empty in-mask. */
const SHEAR_ALPHA_FALLBACK = 1 / 7;

/** 10th percentile of pixel speeds ⇒ "90% of site area exceeds X m/s". */
const AREA_EXCEEDANCE_QUANTILE = 0.1;
const QUARTILE_LOWER = 0.25;
const QUARTILE_MEDIAN = 0.5;
const QUARTILE_UPPER = 0.75;

// ── Rounding policy (presentation-grade; airDensity 3 dp per plan) ─────────

const SPEED_DECIMALS = 2;
const POWER_DENSITY_DECIMALS = 0;
const AIR_DENSITY_DECIMALS = 3;
const CF_DECIMALS = 4;
const SHEAR_DECIMALS = 4;

// ── Small pure helpers (exported for tests and sibling modules) ────────────

/** Round to `decimals` places; passes non-finite values through unchanged. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Arithmetic mean; NaN for an empty input (caller decides the policy). */
export function meanOf(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Linear-interpolated percentile of an ASCENDING-sorted array.
 * q is a fraction in [0, 1]; position = q·(n−1), interpolated between the
 * two bracketing elements (the standard "linear" / R-7 method).
 */
export function percentileOfSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    throw new Error("percentileOfSorted: empty input");
  }
  if (!Number.isFinite(q) || q < 0 || q > 1) {
    throw new Error(`percentileOfSorted: q must be in [0, 1], got ${q}`);
  }
  const position = q * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, sorted.length - 1);
  const fraction = position - lowerIndex;
  const lower = sorted[lowerIndex] ?? Number.NaN;
  const upper = sorted[upperIndex] ?? Number.NaN;
  return lower + fraction * (upper - lower);
}

/** All finite pixel values whose mask cell is 1. Inputs are not mutated. */
export function collectInsideFinite(patch: LayerPatch, mask: AoiMask): number[] {
  const values: number[] = [];
  const totalPixels = mask.widthPx * mask.heightPx;
  for (let i = 0; i < totalPixels; i++) {
    if (mask.inside[i] !== 1) continue;
    const value = patch.data[i];
    if (value !== undefined && Number.isFinite(value)) values.push(value);
  }
  return values;
}

/**
 * Shear exponent α: least-squares slope of ln(v) vs ln(h) across the AOI
 * mean speeds at 50/100/150 m. Returns NaN if any mean is missing or ≤ 0
 * (ln undefined). Raw value — sanity clamping happens in computeResource.
 */
export function fitShearAlpha(
  meanSpeeds: readonly [number, number, number],
): number {
  const logHeights: number[] = [];
  const logSpeeds: number[] = [];
  for (let i = 0; i < SHEAR_FIT_HEIGHTS_M.length; i++) {
    const speed = meanSpeeds[i];
    if (speed === undefined || !Number.isFinite(speed) || speed <= 0) {
      return Number.NaN;
    }
    logHeights.push(Math.log(SHEAR_FIT_HEIGHTS_M[i] ?? Number.NaN));
    logSpeeds.push(Math.log(speed));
  }
  const xMean = meanOf(logHeights);
  const yMean = meanOf(logSpeeds);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < logHeights.length; i++) {
    const dx = (logHeights[i] ?? Number.NaN) - xMean;
    const dy = (logSpeeds[i] ?? Number.NaN) - yMean;
    numerator += dx * dy;
    denominator += dx * dx;
  }
  return numerator / denominator;
}

/** Pinned barometric formula: ρ = 1.225·(1 − 2.2558e-5·h)^5.256 (plan §2.4). */
export function airDensityAtElevation(elevationM: number): number {
  const base = 1 - BAROMETRIC_LAPSE_PER_M * elevationM;
  return SEA_LEVEL_AIR_DENSITY_KG_M3 * base ** BAROMETRIC_EXPONENT;
}

/** Site-class banding on AOI mean speed @100 m (plan §3 contract). */
export function classifySite(meanSpeed: number): SiteClass {
  if (meanSpeed >= SITE_CLASS_BANDS.excellent) return "excellent";
  if (meanSpeed >= SITE_CLASS_BANDS.good) return "good";
  if (meanSpeed >= SITE_CLASS_BANDS.moderate) return "moderate";
  return "marginal";
}

// ── Internal stages ─────────────────────────────────────────────────────────

function assertPatchesMatchMask(patches: ResourcePatches, mask: AoiMask): void {
  for (const [key, patch] of Object.entries(patches)) {
    if (patch.widthPx !== mask.widthPx || patch.heightPx !== mask.heightPx) {
      throw new Error(
        `computeResource: patch "${key}" is ${patch.widthPx}×${patch.heightPx}px ` +
          `but mask is ${mask.widthPx}×${mask.heightPx}px`,
      );
    }
  }
}

/** Clamps a raw shear fit into the sanity band, warning with the raw value. */
function resolveShearAlpha(rawAlpha: number): number {
  if (!Number.isFinite(rawAlpha)) {
    console.warn(
      `[resource] shear fit not computable (raw=${rawAlpha}); ` +
        `falling back to 1/7 power law (${SHEAR_ALPHA_FALLBACK.toFixed(4)})`,
    );
    return SHEAR_ALPHA_FALLBACK;
  }
  if (rawAlpha < SHEAR_ALPHA_MIN || rawAlpha > SHEAR_ALPHA_MAX) {
    console.warn(
      `[resource] shear alpha ${rawAlpha} outside sanity band ` +
        `[${SHEAR_ALPHA_MIN}, ${SHEAR_ALPHA_MAX}]; clamping`,
    );
    return Math.min(SHEAR_ALPHA_MAX, Math.max(SHEAR_ALPHA_MIN, rawAlpha));
  }
  return rawAlpha;
}

/**
 * Mean in-mask capacity factor, clamped ≥ 0 (VERIFIED.md: GWA resampling
 * produces tiny negatives). null when the patch is entirely NaN in-mask.
 */
function meanCapacityFactor(patch: LayerPatch, mask: AoiMask): number | null {
  const values = collectInsideFinite(patch, mask);
  if (values.length === 0) return null;
  return Math.max(0, meanOf(values));
}

interface DensityCorrectedPower {
  powerDensity: number | null;
  powerDensityRaw: number | null;
  airDensity: number;
}

/**
 * Air-density correction (plan §2.4): ρ from the AOI mean elevation, applied
 * multiplicatively to the GWA power density (which assumes sea-level ρ).
 * Missing elevation degrades to sea level (correction becomes identity);
 * missing pd100 degrades both power fields to null — only ws100 is fatal.
 */
function computeDensityCorrectedPower(
  patches: ResourcePatches,
  mask: AoiMask,
): DensityCorrectedPower {
  const elevations = collectInsideFinite(patches.elevation, mask);
  if (elevations.length === 0) {
    console.warn(
      "[resource] elevation layer empty in-mask; assuming sea level for the density correction",
    );
  }
  const meanElevation = elevations.length === 0 ? 0 : meanOf(elevations);
  const airDensity = airDensityAtElevation(meanElevation);

  const rawValues = collectInsideFinite(patches.pd100, mask);
  if (rawValues.length === 0) {
    console.warn("[resource] pd_mean_hgt100m layer empty in-mask; power density unavailable");
    return {
      powerDensity: null,
      powerDensityRaw: null,
      airDensity: roundTo(airDensity, AIR_DENSITY_DECIMALS),
    };
  }
  const powerDensityRaw = meanOf(rawValues);
  const powerDensity = powerDensityRaw * (airDensity / SEA_LEVEL_AIR_DENSITY_KG_M3);

  return {
    powerDensity: roundTo(powerDensity, POWER_DENSITY_DECIMALS),
    powerDensityRaw: roundTo(powerDensityRaw, POWER_DENSITY_DECIMALS),
    airDensity: roundTo(airDensity, AIR_DENSITY_DECIMALS),
  };
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Section A statistics for one AOI. Throws when ws100 has zero valid in-mask
 * pixels (the section becomes `unavailable` upstream); every other gap
 * degrades per-field. Inputs are never mutated.
 */
export function computeResource(
  patches: ResourcePatches,
  mask: AoiMask,
  weibull: { A: number; k: number } | null,
): ResourceData {
  assertPatchesMatchMask(patches, mask);

  const ws100Values = collectInsideFinite(patches.ws100, mask);
  if (ws100Values.length === 0) {
    throw new Error(
      "computeResource: zero valid ws_mean_hgt100m pixels inside the AOI mask",
    );
  }
  const sortedWs100 = [...ws100Values].sort((a, b) => a - b);
  const meanSpeed = roundTo(meanOf(ws100Values), SPEED_DECIMALS);

  const rawAlpha = fitShearAlpha([
    meanOf(collectInsideFinite(patches.ws50, mask)),
    meanOf(ws100Values),
    meanOf(collectInsideFinite(patches.ws150, mask)),
  ]);
  const shearAlpha = resolveShearAlpha(rawAlpha);

  const power = computeDensityCorrectedPower(patches, mask);

  const cfIec3 = meanCapacityFactor(patches.cfIec3, mask);
  if (cfIec3 === null) {
    console.warn("[resource] cf_iec3 layer empty in-mask; value will serialize as null");
  }
  const cfIec2 = meanCapacityFactor(patches.cfIec2, mask);

  // CF-engine Phase B (shadow): power-curve CF from the AOI Weibull + air
  // density, computed alongside the GWA cf_iec3 headline for comparison.
  const cfPowerCurve = computePowerCurveCfs(weibull, power.airDensity);
  if (cfPowerCurve && cfIec3 !== null) {
    console.log(
      `[resource] CF shadow — gwa_cf_iec3=${cfIec3.toFixed(4)} ` +
        `powercurve_iec3=${cfPowerCurve.iec3.toFixed(4)} ` +
        `(Δ=${((cfPowerCurve.iec3 - cfIec3) * 100).toFixed(1)}pp)`,
    );
  }

  // CF-engine Phase C (shadow): net CF = gross · (1 − wake) · Π(1 − lossᵢ),
  // wake from the layout density. Built off the comparable IEC-III gross.
  const cfNetRaw =
    cfPowerCurve === null ? null : computeNetCf(cfPowerCurve.iec3, SIZING_MW_PER_KM2);
  if (cfNetRaw) {
    console.log(
      `[resource] CF net (shadow) — gross_iec3=${cfNetRaw.grossCf.toFixed(4)} ` +
        `wake=${(cfNetRaw.wakeLossFraction * 100).toFixed(1)}% ` +
        `other=${(cfNetRaw.otherLossFraction * 100).toFixed(1)}% ` +
        `net=${cfNetRaw.netCf.toFixed(4)}`,
    );
  }

  // CF-engine Phase D (shadow): P50/P75/P90 exceedance of the net CF.
  const cfExceedance = cfNetRaw === null ? null : computeExceedance(cfNetRaw.netCf);
  if (cfExceedance) {
    console.log(
      `[resource] CF exceedance (shadow) — P50=${cfExceedance.p50.toFixed(4)} ` +
        `P75=${cfExceedance.p75.toFixed(4)} P90=${cfExceedance.p90.toFixed(4)} ` +
        `σ=${cfExceedance.sigmaTotal.toFixed(3)}`,
    );
  }

  const indiaPercentile = indiaPercentileOf(meanSpeed);

  return {
    meanSpeed,
    minSpeed: roundTo(sortedWs100[0] ?? Number.NaN, SPEED_DECIMALS),
    maxSpeed: roundTo(sortedWs100[sortedWs100.length - 1] ?? Number.NaN, SPEED_DECIMALS),
    p25Speed: roundTo(percentileOfSorted(sortedWs100, QUARTILE_LOWER), SPEED_DECIMALS),
    p50Speed: roundTo(percentileOfSorted(sortedWs100, QUARTILE_MEDIAN), SPEED_DECIMALS),
    p75Speed: roundTo(percentileOfSorted(sortedWs100, QUARTILE_UPPER), SPEED_DECIMALS),
    areaExceedance90: roundTo(
      percentileOfSorted(sortedWs100, AREA_EXCEEDANCE_QUANTILE),
      SPEED_DECIMALS,
    ),
    powerDensity: power.powerDensity,
    powerDensityRaw: power.powerDensityRaw,
    airDensity: power.airDensity,
    cfIec3: cfIec3 === null ? null : roundTo(cfIec3, CF_DECIMALS),
    cfIec2: cfIec2 === null ? null : roundTo(cfIec2, CF_DECIMALS),
    cfPowerCurve:
      cfPowerCurve === null
        ? null
        : {
            iec1: roundTo(cfPowerCurve.iec1, CF_DECIMALS),
            iec2: roundTo(cfPowerCurve.iec2, CF_DECIMALS),
            iec3: roundTo(cfPowerCurve.iec3, CF_DECIMALS),
          },
    cfNet:
      cfNetRaw === null
        ? null
        : {
            grossCf: roundTo(cfNetRaw.grossCf, CF_DECIMALS),
            wakeLossFraction: roundTo(cfNetRaw.wakeLossFraction, CF_DECIMALS),
            otherLossFraction: roundTo(cfNetRaw.otherLossFraction, CF_DECIMALS),
            lossBuckets: cfNetRaw.lossBuckets,
            netCf: roundTo(cfNetRaw.netCf, CF_DECIMALS),
          },
    cfExceedance:
      cfExceedance === null
        ? null
        : {
            p50: roundTo(cfExceedance.p50, CF_DECIMALS),
            p75: roundTo(cfExceedance.p75, CF_DECIMALS),
            p90: roundTo(cfExceedance.p90, CF_DECIMALS),
            sigmaTotal: roundTo(cfExceedance.sigmaTotal, CF_DECIMALS),
          },
    shearAlpha: roundTo(shearAlpha, SHEAR_DECIMALS),
    weibull: weibull === null ? null : { A: weibull.A, k: weibull.k },
    indiaPercentile: indiaPercentile === null ? null : Math.round(indiaPercentile),
    siteClass: classifySite(meanSpeed),
  };
}
