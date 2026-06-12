/**
 * concurrency.ts tests — the process-wide analysis gate. Every test releases
 * whatever it acquired (try/finally) because the counter is module state.
 */

import { expect, test } from "bun:test";
import {
  ANALYSIS_RETRY_AFTER_SECONDS,
  MAX_CONCURRENT_ANALYSES,
  inFlightAnalysisCount,
  tryAcquireAnalysisSlot,
  type AnalysisSlot,
} from "./concurrency";

function releaseAll(slots: readonly (AnalysisSlot | null)[]): void {
  for (const slot of slots) slot?.release();
}

test("grants slots up to MAX_CONCURRENT_ANALYSES and counts them", () => {
  // Arrange
  const slots: (AnalysisSlot | null)[] = [];

  try {
    // Act
    for (let i = 0; i < MAX_CONCURRENT_ANALYSES; i++) {
      slots.push(tryAcquireAnalysisSlot());
    }

    // Assert
    expect(slots.every((slot) => slot !== null)).toBe(true);
    expect(inFlightAnalysisCount()).toBe(MAX_CONCURRENT_ANALYSES);
  } finally {
    releaseAll(slots);
  }
});

test("returns null when the gate is full instead of queuing", () => {
  // Arrange
  const slots = Array.from({ length: MAX_CONCURRENT_ANALYSES }, () =>
    tryAcquireAnalysisSlot(),
  );

  try {
    // Act
    const overflow = tryAcquireAnalysisSlot();

    // Assert
    expect(overflow).toBeNull();
  } finally {
    releaseAll(slots);
  }
});

test("releasing a slot makes room for the next analysis", () => {
  // Arrange
  const slots = Array.from({ length: MAX_CONCURRENT_ANALYSES }, () =>
    tryAcquireAnalysisSlot(),
  );
  const reacquired: (AnalysisSlot | null)[] = [];

  try {
    // Act
    slots[0]?.release();
    reacquired.push(tryAcquireAnalysisSlot());

    // Assert
    expect(reacquired[0]).not.toBeNull();
    expect(inFlightAnalysisCount()).toBe(MAX_CONCURRENT_ANALYSES);
  } finally {
    releaseAll([...slots.slice(1), ...reacquired]);
  }
});

test("double release is idempotent and cannot free someone else's slot", () => {
  // Arrange
  const slot = tryAcquireAnalysisSlot();
  expect(slot).not.toBeNull();
  const baseline = inFlightAnalysisCount();

  // Act
  slot?.release();
  slot?.release();

  // Assert — exactly one decrement, never below the pre-acquire level
  expect(inFlightAnalysisCount()).toBe(baseline - 1);
});

test("gate is fully drained after all releases", () => {
  // Arrange
  const before = inFlightAnalysisCount();
  const slots = Array.from({ length: MAX_CONCURRENT_ANALYSES }, () =>
    tryAcquireAnalysisSlot(),
  );

  // Act
  releaseAll(slots);

  // Assert
  expect(inFlightAnalysisCount()).toBe(before);
});

test("retry-after constant is a positive number of seconds", () => {
  expect(ANALYSIS_RETRY_AFTER_SECONDS).toBeGreaterThan(0);
  expect(Number.isInteger(ANALYSIS_RETRY_AFTER_SECONDS)).toBe(true);
});
