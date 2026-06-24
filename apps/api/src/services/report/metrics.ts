/**
 * Site-Analysis PDF Export — in-process render metrics (PR15, observability scope).
 *
 * The §6.4 scale-out decision (build an async job queue) hinges on three
 * production signals: p95 render latency, a nonzero browser queue-wait, and a
 * climbing 503 rate. Until now none were measurable — only per-render
 * `console.info` lines. This module is the cheap precondition: a bounded,
 * dependency-free, in-process recorder (no Redis, no infra) that the /report
 * path feeds and `GET /report/stats` reads, so we can tell whether the triggers
 * have actually fired before committing to the queue.
 *
 * Bounded by design: durations live in fixed-size ring buffers (the last
 * SAMPLE_WINDOW samples), so memory is O(1) and percentiles reflect a recent
 * window rather than all-time history. This module imports nothing from the rest
 * of the report subsystem so it can be fed from both browserPool and the
 * controller without an import cycle; live gauges (pool, in-flight) are passed
 * into snapshot() by the caller instead.
 */

/** How many recent duration samples each reservoir retains. */
const SAMPLE_WINDOW = 512;

/** A summary of a duration distribution; nulls when no samples seen yet. */
export interface DurationSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

/** Nearest-rank percentile over an ascending-sorted array (q in [0,1]). */
function percentile(sortedAsc: number[], q: number): number {
  const rank = Math.ceil(q * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index]!; // index is in-bounds (callers guard empty arrays)
}

/** Fixed-size ring buffer of recent millisecond samples. */
class Reservoir {
  private readonly samples: number[] = [];
  private cursor = 0;
  private filled = 0;

  add(ms: number): void {
    this.samples[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % SAMPLE_WINDOW;
    this.filled = Math.min(this.filled + 1, SAMPLE_WINDOW);
  }

  summary(): DurationSummary {
    if (this.filled === 0) return { count: 0, p50: null, p95: null, max: null };
    // Copy then sort — never mutate the live buffer's ordering.
    const sorted = this.samples.slice(0, this.filled).sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted[sorted.length - 1]!, // non-empty (filled > 0 guarded above)
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.cursor = 0;
    this.filled = 0;
  }
}

/** Terminal (and notable sub-) outcomes of an export attempt. */
export type OutcomeCode =
  | "succeeded"
  | "dedupeHit"
  | "rateLimited429"
  | "analysisBusy503"
  | "poolBusy503"
  | "badRequest400"
  | "failed500"
  | "aborted";

const OUTCOME_CODES: readonly OutcomeCode[] = [
  "succeeded",
  "dedupeHit",
  "rateLimited429",
  "analysisBusy503",
  "poolBusy503",
  "badRequest400",
  "failed500",
  "aborted",
];

function zeroOutcomes(): Record<OutcomeCode, number> {
  return Object.fromEntries(OUTCOME_CODES.map((c) => [c, 0])) as Record<
    OutcomeCode,
    number
  >;
}

/** Live gauges the caller reads from other modules and passes into snapshot(). */
export interface LiveGauges {
  pool: { free: number; waiting: number };
  inFlight: number;
}

export interface MetricsSnapshot {
  sinceIso: string;
  uptimeS: number;
  /**
   * Attempts that entered the handler body (post-flag, post-rate-limit). The
   * terminal outcomes (succeeded + analysisBusy503 + poolBusy503 +
   * badRequest400 + failed500 + aborted) sum to roughly this; `dedupeHit` and
   * `rateLimited429` are tracked separately and are not part of that sum.
   */
  requests: number;
  outcomes: Record<OutcomeCode, number>;
  renderMs: DurationSummary;
  queueWaitMs: DurationSummary;
  pool: { free: number; waiting: number };
  inFlight: number;
}

// ── Module-level accumulators ──────────────────────────────────────────────
let requests = 0;
let outcomes = zeroOutcomes();
const renderReservoir = new Reservoir();
const queueWaitReservoir = new Reservoir();
let startedAtMs = Date.now();

/** Count an attempt entering the handler body. */
export function recordRequest(): void {
  requests += 1;
}

/** Record a completed full-render duration (HTML build + Chromium pass), in ms. */
export function recordRender(ms: number): void {
  renderReservoir.add(ms);
}

/** Record how long a render waited for a free browser permit, in ms. */
export function recordQueueWait(ms: number): void {
  queueWaitReservoir.add(ms);
}

/** Tally a terminal (or notable sub-) outcome. */
export function recordOutcome(code: OutcomeCode): void {
  outcomes[code] += 1;
}

/** A consistent point-in-time view, merged with caller-supplied live gauges. */
export function snapshot(live: LiveGauges): MetricsSnapshot {
  return {
    sinceIso: new Date(startedAtMs).toISOString(),
    uptimeS: Math.floor((Date.now() - startedAtMs) / 1000),
    requests,
    outcomes: { ...outcomes },
    renderMs: renderReservoir.summary(),
    queueWaitMs: queueWaitReservoir.summary(),
    pool: live.pool,
    inFlight: live.inFlight,
  };
}

/** Clear all accumulators — test hook; not used in production paths. */
export function resetMetrics(): void {
  requests = 0;
  outcomes = zeroOutcomes();
  renderReservoir.reset();
  queueWaitReservoir.reset();
  startedAtMs = Date.now();
}
