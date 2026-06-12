/**
 * Server-wide analysis concurrency gate.
 *
 * The per-user rate limit (20/min) counts REQUESTS, not in-flight work: a
 * burst of 20 simultaneous cache-miss analyses fans out to thousands of
 * upstream GWA tile fetches (7 layers × up to 64 tiles each), and every
 * additional Pro account multiplies that budget. This counting semaphore
 * caps simultaneous cache-miss analyses process-wide. Callers that fail to
 * acquire a slot must answer 429 + Retry-After — never queue — so the cap
 * also bounds memory and upstream socket pressure.
 *
 * Cache HITS are served without a slot (they do no upstream work).
 */

/** Max analyses (cache-miss pipeline runs) in flight at once, process-wide. */
export const MAX_CONCURRENT_ANALYSES = 4;

/** Suggested client back-off; one analysis typically completes well inside
 *  this (15 s wall budget, but warm-cache runs are sub-second). */
export const ANALYSIS_RETRY_AFTER_SECONDS = 5;

export interface AnalysisSlot {
  /** Idempotent: releasing twice can never free someone else's slot. */
  release(): void;
}

let inFlightCount = 0;

/** Current in-flight analyses (exposed for tests/observability). */
export function inFlightAnalysisCount(): number {
  return inFlightCount;
}

/**
 * Try to take one of the MAX_CONCURRENT_ANALYSES slots. Returns null when
 * the gate is full — the caller must reject with 429, not wait.
 */
export function tryAcquireAnalysisSlot(): AnalysisSlot | null {
  if (inFlightCount >= MAX_CONCURRENT_ANALYSES) return null;
  inFlightCount += 1;
  let isReleased = false;
  return {
    release(): void {
      if (isReleased) return;
      isReleased = true;
      inFlightCount -= 1;
    },
  };
}
