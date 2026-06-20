import { describe, expect, test } from "bun:test";
import { DEFAULT_LOSS_BUCKETS, computeNetCf, wakeLossFraction } from "./losses";

describe("wakeLossFraction", () => {
  test("≈10% at the 5 MW/km² layout density", () => {
    expect(wakeLossFraction(5)).toBeCloseTo(0.1, 5);
  });

  test("rises with density and clamps to [3%, 25%]", () => {
    expect(wakeLossFraction(3)).toBeGreaterThan(0.03);
    expect(wakeLossFraction(10)).toBeGreaterThan(wakeLossFraction(5));
    expect(wakeLossFraction(0)).toBe(0.03); // floor
    expect(wakeLossFraction(100)).toBe(0.25); // ceiling
  });
});

describe("computeNetCf", () => {
  test("net = gross·(1−wake)·Π(1−lossᵢ), below gross", () => {
    const r = computeNetCf(0.4, 5);
    const wake = wakeLossFraction(5);
    const otherKept =
      (1 - DEFAULT_LOSS_BUCKETS.availability) *
      (1 - DEFAULT_LOSS_BUCKETS.electrical) *
      (1 - DEFAULT_LOSS_BUCKETS.soiling) *
      (1 - DEFAULT_LOSS_BUCKETS.curtailment);
    expect(r.netCf).toBeCloseTo(0.4 * (1 - wake) * otherKept, 6);
    expect(r.netCf).toBeLessThan(0.4);
    expect(r.grossCf).toBe(0.4);
  });

  test("total loss is ~19% at defaults (10% wake + ~10% other)", () => {
    const r = computeNetCf(1, 5);
    expect(1 - r.netCf).toBeGreaterThan(0.15);
    expect(1 - r.netCf).toBeLessThan(0.25);
  });

  test("otherLossFraction matches the bucket product", () => {
    const r = computeNetCf(0.5, 5);
    expect(r.otherLossFraction).toBeCloseTo(
      1 -
        (1 - DEFAULT_LOSS_BUCKETS.availability) *
          (1 - DEFAULT_LOSS_BUCKETS.electrical) *
          (1 - DEFAULT_LOSS_BUCKETS.soiling) *
          (1 - DEFAULT_LOSS_BUCKETS.curtailment),
      6,
    );
  });

  test("clamps to [0,1] and handles zero gross", () => {
    expect(computeNetCf(0, 5).netCf).toBe(0);
    expect(computeNetCf(1, 5).netCf).toBeLessThanOrEqual(1);
  });
});
