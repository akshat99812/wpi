import { beforeEach, describe, expect, test } from "bun:test";

import {
  recordOutcome,
  recordQueueWait,
  recordRender,
  recordRequest,
  resetMetrics,
  snapshot,
} from "./metrics";

const LIVE = { pool: { free: 4, waiting: 0 }, inFlight: 0 };

describe("report metrics", () => {
  beforeEach(() => resetMetrics());

  test("summarises an empty reservoir as nulls", () => {
    // Arrange — nothing recorded.
    // Act
    const snap = snapshot(LIVE);
    // Assert
    expect(snap.renderMs).toEqual({ count: 0, p50: null, p95: null, max: null });
    expect(snap.queueWaitMs).toEqual({
      count: 0,
      p50: null,
      p95: null,
      max: null,
    });
    expect(snap.requests).toBe(0);
  });

  test("computes nearest-rank percentiles over recorded durations", () => {
    // Arrange — 100 samples: 10, 20, ... 1000.
    for (let i = 1; i <= 100; i++) recordRender(i * 10);
    // Act
    const { renderMs } = snapshot(LIVE);
    // Assert — nearest-rank: p50 → index 49 (500), p95 → index 94 (950).
    expect(renderMs.count).toBe(100);
    expect(renderMs.p50).toBe(500);
    expect(renderMs.p95).toBe(950);
    expect(renderMs.max).toBe(1000);
  });

  test("a single sample is its own p50/p95/max", () => {
    recordQueueWait(42);
    const { queueWaitMs } = snapshot(LIVE);
    expect(queueWaitMs).toEqual({ count: 1, p50: 42, p95: 42, max: 42 });
  });

  test("ring buffer retains only the most recent 512 samples", () => {
    // Arrange — 600 samples; the first 88 must be evicted.
    for (let i = 1; i <= 600; i++) recordRender(i);
    // Act
    const { renderMs } = snapshot(LIVE);
    // Assert — count caps at the window; max is the latest, not all-time count.
    expect(renderMs.count).toBe(512);
    expect(renderMs.max).toBe(600);
  });

  test("tallies outcomes and request count independently", () => {
    // Arrange
    recordRequest();
    recordRequest();
    recordOutcome("succeeded");
    recordOutcome("poolBusy503");
    recordOutcome("poolBusy503");
    recordOutcome("dedupeHit");
    recordOutcome("rateLimited429");
    // Act
    const snap = snapshot(LIVE);
    // Assert
    expect(snap.requests).toBe(2);
    expect(snap.outcomes.succeeded).toBe(1);
    expect(snap.outcomes.poolBusy503).toBe(2);
    expect(snap.outcomes.dedupeHit).toBe(1);
    expect(snap.outcomes.rateLimited429).toBe(1);
    expect(snap.outcomes.failed500).toBe(0);
  });

  test("merges caller-supplied live gauges into the snapshot", () => {
    // Arrange
    const live = { pool: { free: 1, waiting: 3 }, inFlight: 2 };
    // Act
    const snap = snapshot(live);
    // Assert
    expect(snap.pool).toEqual({ free: 1, waiting: 3 });
    expect(snap.inFlight).toBe(2);
    expect(typeof snap.sinceIso).toBe("string");
    expect(snap.uptimeS).toBeGreaterThanOrEqual(0);
  });

  test("resetMetrics clears counters and reservoirs", () => {
    // Arrange
    recordRequest();
    recordRender(123);
    recordOutcome("succeeded");
    // Act
    resetMetrics();
    const snap = snapshot(LIVE);
    // Assert
    expect(snap.requests).toBe(0);
    expect(snap.outcomes.succeeded).toBe(0);
    expect(snap.renderMs.count).toBe(0);
  });
});
