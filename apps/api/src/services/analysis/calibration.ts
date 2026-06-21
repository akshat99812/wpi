/**
 * calibration.ts — CF-engine Phase E (request-path): per-state calibration of
 * the modelled net CF against generation actuals.
 *
 * The intended pipeline (wind-cf-engine-plan.md §5.6, locked decision #3): an
 * offline ingest derives per-state factors = actual_PLF / modelled_CF from
 * CEA / SLDC / Grid-India wind generation + installed capacity, written to a
 * table this module reads; the request path multiplies the net CF by the
 * factor for the AOI's state(s) and surfaces the residual bias.
 *
 * IMPORTANT — STATE_CALIBRATION is intentionally EMPTY. No real CEA/SLDC series
 * has been ingested yet, and seeding guessed factors would be worse than none
 * (it would launder unsourced numbers into a bankable figure). Until the table
 * is filled, every factor resolves to 1.0 (identity) and `isCalibrated` is
 * false — a safe no-op that the orchestrator shadow-logs. Fill this map (or
 * load it from the ingested JSON) to activate calibration.
 */

const IDENTITY_FACTOR = 1;

/**
 * Per-state multiplicative calibration factors (modelled net CF → actual PLF).
 * Keyed by the ST_NM state name used elsewhere in the engine (context.ts).
 * EMPTY until the CEA/SLDC ingest lands — see the file header.
 */
export const STATE_CALIBRATION: Readonly<Record<string, number>> = {};

export interface CalibrationResult {
  /** Net CF after applying the state calibration factor (= net CF when none). */
  calibratedCf: number;
  /** Factor applied (1.0 when no state factor is known). */
  factor: number;
  /** True only when at least one of the AOI's states had a real factor. */
  isCalibrated: boolean;
  /** Human-readable basis for the factor (which states contributed). */
  basis: string;
}

/**
 * Mean calibration factor across the AOI's states. States without a factor
 * contribute the identity (1.0); when no state has one, the result is identity
 * and isCalibrated is false.
 */
export function calibrationFactorForStates(states: readonly string[]): {
  factor: number;
  isCalibrated: boolean;
  basis: string;
} {
  const known = states.filter((s) => s in STATE_CALIBRATION);
  if (known.length === 0) {
    return { factor: IDENTITY_FACTOR, isCalibrated: false, basis: "uncalibrated" };
  }
  const sum = known.reduce((acc, s) => acc + (STATE_CALIBRATION[s] ?? IDENTITY_FACTOR), 0);
  return {
    factor: sum / known.length,
    isCalibrated: true,
    basis: `calibrated vs actuals: ${known.join(", ")}`,
  };
}

/** Apply the state calibration to a modelled net CF (clamped to [0, 1]). */
export function applyCalibration(
  netCf: number,
  states: readonly string[],
): CalibrationResult {
  const { factor, isCalibrated, basis } = calibrationFactorForStates(states);
  const calibratedCf = Math.min(1, Math.max(0, netCf * factor));
  return { calibratedCf, factor, isCalibrated, basis };
}
