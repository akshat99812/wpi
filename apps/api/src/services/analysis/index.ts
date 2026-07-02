/**
 * Pipeline orchestrator: ValidatedAoi → AnalysisResponse (plan §3 envelope).
 *
 * Concurrency shape (wall-clock-optimal under the 15 s budget):
 *   t0 ─┬─ grid     (independent: power tiles around the AOI)
 *       ├─ climate  (independent: flag-gated reanalysis at the centroid;
 *       │            skipped without a single log line when the flag is off)
 *       └─ resource (9 GWA patches ∥ Weibull COG means → mask → stats)
 *            └─ then, on the REMAINING budget:
 *                 ├─ validation (needs the AOI shear α for the mast delta)
 *                 └─ context    (reuses the elevation patch + AOI mask)
 *
 * Hard rules honored here (plan §2.8/§6): a section that throws or exceeds
 * the wall-clock budget degrades to { status: "unavailable", data: null } —
 * it NEVER fails the response; the route always answers 200 with whatever
 * completed. Validation confidence mirrors into score.confidence but never
 * touches the score arithmetic.
 */

import {
  ANALYSIS_BUDGET_MS,
  ANALYSIS_VERSION,
  CLIMATE_SECTION_ENABLED,
  GWA_LAYERS,
} from "./constants";
import { applyCalibration } from "./calibration";
import { computeClimate } from "./climate";
import { computeContext } from "./context";
import { computeGrid } from "./grid";
import { buildAoiMask } from "./mask";
import { computeResource, type ResourcePatches } from "./resource";
import { screenWind } from "./screenWind";
import { fetchLayerPatch, type TileFetchOptions } from "./tiles";
import { toAnalysisScore } from "./windScoring";
import type {
  AnalysisResponse,
  AoiMask,
  ClimateData,
  ContextData,
  GridData,
  LayerPatch,
  ResourceData,
  Section,
  ValidatedAoi,
  ValidationData,
} from "./types";
import { computeValidation } from "./validation";
import { aoiWeibullMeans } from "./weibull";

export interface AnalyzeOptions extends TileFetchOptions {
  /** Override the global wall-clock budget (tests only). */
  budgetMs?: number;
}

/** Fallback shear exponent (1/7 power law) when section A never produced an
 *  AOI-fitted α — only the mast delta uses it, and only in the rare case
 *  where the GWA point fetch succeeds while the patch fetch had failed. */
const SHEAR_ALPHA_FALLBACK = 1 / 7;

/** Floor for the post-resource leg so validation/context always get at
 *  least one chance to run (they are cheap: one SQL + pure math). */
const MIN_REMAINING_BUDGET_MS = 250;

class SectionTimeoutError extends Error {
  constructor(label: string, budgetMs: number) {
    super(`section "${label}" exceeded the ${budgetMs} ms budget`);
    this.name = "SectionTimeoutError";
  }
}

const unavailableSection = <T>(): Section<T> => ({ status: "unavailable", data: null });

/** Race `work` against the budget. The losing work promise gets a no-op
 *  rejection handler so a late failure can never become an unhandled
 *  rejection. */
async function withBudget<T>(
  work: Promise<T>,
  budgetMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SectionTimeoutError(label, budgetMs)), budgetMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    if (err instanceof SectionTimeoutError) work.catch(() => undefined);
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Run one section group under the budget; failure/timeout → "unavailable"
 *  (logged with full context), never a thrown error. */
async function runSection<T>(
  name: string,
  budgetMs: number,
  work: () => Promise<T>,
): Promise<Section<T>> {
  const startedAt = performance.now();
  try {
    const data = await withBudget(work(), budgetMs, name);
    console.log(`[analysis] section=${name} ms=${Math.round(performance.now() - startedAt)}`);
    return { status: "ok", data };
  } catch (err) {
    console.error(
      `[analysis] section=${name} ms=${Math.round(performance.now() - startedAt)} status=unavailable:`,
      err,
    );
    return unavailableSection<T>();
  }
}

/** All patches must share one cover/grid or the single mask would misalign. */
function assertIdenticalCovers(patches: ResourcePatches): void {
  const reference: LayerPatch = patches.ws100;
  for (const [key, patch] of Object.entries(patches)) {
    const matchesReference =
      patch.zoom === reference.zoom &&
      patch.minTileX === reference.minTileX &&
      patch.minTileY === reference.minTileY &&
      patch.widthPx === reference.widthPx &&
      patch.heightPx === reference.heightPx;
    if (!matchesReference) {
      throw new Error(
        `analyzeAoi: layer patch "${key}" cover mismatch — ` +
          `${patch.widthPx}×${patch.heightPx}@(${patch.minTileX},${patch.minTileY},z${patch.zoom}) vs ` +
          `ws100 ${reference.widthPx}×${reference.heightPx}@(${reference.minTileX},${reference.minTileY},z${reference.zoom})`,
      );
    }
  }
}

/** Section A artifacts that downstream sections reuse. */
interface ResourceArtifacts {
  elevation: LayerPatch;
  mask: AoiMask;
}

/** Section A: concurrent 9-layer fetch ∥ Weibull COG means → mask → stats. */
async function computeResourceData(
  aoi: ValidatedAoi,
  options: TileFetchOptions,
  onArtifacts: (artifacts: ResourceArtifacts) => void,
): Promise<ResourceData> {
  const patchesPromise = (async (): Promise<ResourcePatches> => {
    const [cfIec3, cfIec2, ws50, ws100, ws150, pd50, pd100, pd150, elevation] =
      await Promise.all([
        fetchLayerPatch(GWA_LAYERS.cfIec3, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.cfIec2, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.ws50, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.ws100, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.ws150, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.pd50, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.pd100, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.pd150, aoi.bbox, options),
        fetchLayerPatch(GWA_LAYERS.elevation, aoi.bbox, options),
      ]);
    return { cfIec3, cfIec2, ws50, ws100, ws150, pd50, pd100, pd150, elevation };
  })();

  // Weibull runs against local COGs in parallel with the network fetches.
  // Both promises sit inside one Promise.all, so neither can strand an
  // unhandled rejection when the other fails first.
  const [patches, weibull] = await Promise.all([
    patchesPromise,
    aoiWeibullMeans(aoi.bbox, aoi.ring),
  ]);

  assertIdenticalCovers(patches);
  const mask = buildAoiMask(aoi.ring, patches.ws100);
  onArtifacts({ elevation: patches.elevation, mask });
  return computeResource(patches, mask, weibull);
}

/**
 * Run the full analysis for a validated AOI. Always resolves with a complete
 * plan §3 envelope — section failures degrade in place.
 */
export async function analyzeAoi(
  aoi: ValidatedAoi,
  options: AnalyzeOptions = {},
): Promise<AnalysisResponse> {
  const budgetMs = options.budgetMs ?? ANALYSIS_BUDGET_MS;
  const fetchOptions: TileFetchOptions =
    options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl };
  const startedAt = performance.now();

  // Independent sections start immediately, racing the full budget.
  const gridPromise = runSection("grid", budgetMs, () => computeGrid(aoi, fetchOptions));
  // Flag off → skip silently (no per-request error noise); when the flag is
  // on, computeClimate still throws ClimateDisabledError without a key —
  // runSection maps it to "unavailable" with a server-side log.
  const climatePromise: Promise<Section<ClimateData>> = CLIMATE_SECTION_ENABLED
    ? runSection("climate", budgetMs, () => computeClimate(aoi.centroid))
    : Promise.resolve(unavailableSection<ClimateData>());

  // Ref object rather than a bare `let`: TS keeps the union type on property
  // access, where closure assignment would otherwise pin the narrowing.
  const artifactsRef: { current: ResourceArtifacts | null } = { current: null };
  const resource = await runSection("resource", budgetMs, () =>
    computeResourceData(aoi, fetchOptions, (a) => {
      artifactsRef.current = a;
    }),
  );
  const resourceData = resource.data;

  // Dependent sections get whatever budget is left (floored so they always
  // make an attempt — both are cheap relative to the tile fetches).
  const remainingMs = Math.max(
    MIN_REMAINING_BUDGET_MS,
    budgetMs - Math.round(performance.now() - startedAt),
  );

  const validationPromise = runSection("validation", remainingMs, () =>
    computeValidation(aoi, resourceData?.shearAlpha ?? SHEAR_ALPHA_FALLBACK, fetchOptions),
  );
  // Context reuses section A's elevation patch + mask; without them (GWA
  // down) it cannot compute farms/terrain on the shared grid → unavailable.
  const resourceArtifacts = artifactsRef.current;
  const contextPromise: Promise<Section<ContextData & { slope90thDeg: number | null }>> =
    resourceArtifacts !== null
      ? runSection("context", remainingMs, () =>
          computeContext(aoi, {
            elevation: resourceArtifacts.elevation,
            aoiMask: resourceArtifacts.mask,
            cfIec3: resourceData?.cfIec3 ?? null,
          }),
        )
      : Promise.resolve(
          unavailableSection<ContextData & { slope90thDeg: number | null }>(),
        );

  const [gridSection, climateSection, validationSection, contextSection] =
    await Promise.all([gridPromise, climatePromise, validationPromise, contextPromise]);

  // Strip the score-only extras so the response carries the exact contract.
  const grid: Section<GridData> =
    gridSection.status === "ok" && gridSection.data
      ? {
          status: "ok",
          data: {
            nearestSubstation: gridSection.data.nearestSubstation,
            nearestLine: gridSection.data.nearestLine,
            ehvWithin25Km: gridSection.data.ehvWithin25Km,
            dataNote: gridSection.data.dataNote,
          },
        }
      : unavailableSection<GridData>();
  const context: Section<ContextData> =
    contextSection.status === "ok" && contextSection.data
      ? {
          status: "ok",
          data: {
            states: contextSection.data.states,
            windfarms: contextSection.data.windfarms,
            turbines: contextSection.data.turbines,
            exclusions: contextSection.data.exclusions,
            terrain: contextSection.data.terrain,
            sizing: contextSection.data.sizing,
          },
        }
      : unavailableSection<ContextData>();
  const validation: Section<ValidationData> = validationSection;

  // Methodology §A/§B: the headline score AND the financials come from the
  // per-point screen, fed by our samplers — ws = AOI mean speed @100 m,
  // line/sub = the grid section's nearest-feature distances. A missing wind
  // speed makes every output null (handled inside screenWind/toAnalysisScore);
  // the financial half adds no new inputs.
  const ws = resourceData?.meanSpeed ?? null;
  const lineKm = grid.data?.nearestLine?.distanceKm ?? null;
  const subKm = grid.data?.nearestSubstation?.distanceKm ?? null;
  const screening = screenWind(ws, lineKm, subKm);
  // Confidence mirrors the mast badge ONLY — never part of the arithmetic (§5).
  const score = toAnalysisScore(screening.score, validation.data?.confidence ?? "low");

  // CF-engine Phase E (shadow): per-state calibration of the net CF vs actuals.
  // No-op (identity) until the CEA/SLDC table is ingested — logged for now.
  const netCfForCal = resourceData?.cfNet?.netCf ?? null;
  if (netCfForCal !== null) {
    const calStates = (contextSection.data?.states ?? []).map((s) => s.name);
    const cal = applyCalibration(netCfForCal, calStates);
    console.log(
      `[analysis] CF calibration (shadow) — states=[${calStates.join(", ")}] ` +
        `factor=${cal.factor.toFixed(3)} net=${netCfForCal.toFixed(4)} ` +
        `calibrated=${cal.calibratedCf.toFixed(4)} (${cal.basis})`,
    );
  }

  return {
    analysisVersion: ANALYSIS_VERSION,
    aoi: {
      areaKm2: aoi.areaKm2,
      centroid: aoi.centroid,
      isPointMode: aoi.isPointMode,
    },
    score,
    financials: screening.financials,
    irrBand: screening.irrBand,
    sections: {
      resource,
      climate: climateSection,
      validation,
      grid,
      context,
    },
  };
}
