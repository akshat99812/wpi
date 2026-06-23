/**
 * Unit tests for the nearby better-site search (nearbySite.ts, PR4).
 *
 * The ranking core is exercised through STUB samplers (no network): the
 * found path, the "none beats the selected site" path, null-ws skipping, the
 * hard-timeout degrade, and the candidate cap. candidatePoints is tested pure.
 */

import { describe, expect, test } from "bun:test";

import {
  candidatePoints,
  findNearbyBetterSite,
  type CandidateSamplers,
  type SelectedSite,
} from "./nearbySite";
import { screenWind } from "./screenWind";

const CENTROID: [number, number] = [78.0, 10.0];

// A strong candidate: high wind, grid right next door → high composite score.
const GOOD: CandidateSamplers = {
  sampleWs: async () => 9,
  sampleGrid: async () => ({ lineKm: 0.5, subKm: 0.5 }),
};
const GOOD_SCORE = screenWind(9, 0.5, 0.5).score!.score;

function selectedWithScore(score: number): SelectedSite {
  return {
    ws: 6,
    score,
    cuf: 0.3,
    lineKm: 5,
    subKm: 5,
    equityIrr: 0.1,
    npvCr: 1,
    paybackYr: 8,
  };
}

describe("candidatePoints (pure)", () => {
  test("produces rings × perRing points, capped distances within radius", () => {
    const pts = candidatePoints(CENTROID, 12, 3, 8);
    expect(pts).toHaveLength(24);
    const ringDists = new Set(pts.map((p) => Math.round(p.distanceKm)));
    expect(ringDists).toEqual(new Set([4, 8, 12]));
    for (const p of pts) expect(p.distanceKm).toBeLessThanOrEqual(12 + 1e-9);
  });

  test("is deterministic", () => {
    expect(candidatePoints(CENTROID, 10, 3, 8)).toEqual(
      candidatePoints(CENTROID, 10, 3, 8),
    );
  });
});

describe("findNearbyBetterSite", () => {
  test("found: returns the strictly-better candidate + deltas", async () => {
    const selected = selectedWithScore(GOOD_SCORE - 20);
    const r = await findNearbyBetterSite({
      centroid: CENTROID,
      areaKm2: 25,
      selected,
      samplers: GOOD,
    });
    expect(r.found).toBe(true);
    expect(r.candidate!.score).toBeCloseTo(GOOD_SCORE, 6);
    expect(r.candidate!.ws).toBe(9);
    expect(r.deltas!.score!).toBeGreaterThan(0);
    expect(r.deltas!.ws!).toBeCloseTo(3, 6); // 9 − 6
  });

  test("none: when the selected site already wins, found=false with a reason", async () => {
    const selected = selectedWithScore(GOOD_SCORE + 20);
    const r = await findNearbyBetterSite({
      centroid: CENTROID,
      areaKm2: 25,
      selected,
      samplers: GOOD,
    });
    expect(r.found).toBe(false);
    expect(r.reason).toMatch(/no higher-scoring/);
    expect(r.candidate).toBeUndefined();
  });

  test("null-ws candidates are skipped (no resource → no candidate)", async () => {
    const nullWs: CandidateSamplers = {
      sampleWs: async () => null,
      sampleGrid: async () => ({ lineKm: 1, subKm: 1 }),
    };
    const r = await findNearbyBetterSite({
      centroid: CENTROID,
      areaKm2: 25,
      selected: selectedWithScore(GOOD_SCORE - 20),
      samplers: nullWs,
    });
    expect(r.found).toBe(false);
  });

  test("hard timeout degrades to found=false (never throws)", async () => {
    const slow: CandidateSamplers = {
      sampleWs: () => new Promise((res) => setTimeout(() => res(9), 200)),
      sampleGrid: async () => ({ lineKm: 0.5, subKm: 0.5 }),
    };
    const r = await findNearbyBetterSite({
      centroid: CENTROID,
      areaKm2: 25,
      selected: selectedWithScore(GOOD_SCORE - 20),
      samplers: slow,
      timeoutMs: 25,
    });
    expect(r.found).toBe(false);
    expect(r.reason).toMatch(/timed out/);
  });

  test("the candidate set is bounded (≤ 24 samples)", async () => {
    let calls = 0;
    const counting: CandidateSamplers = {
      sampleWs: async () => {
        calls += 1;
        return 5;
      },
      sampleGrid: async () => ({ lineKm: 10, subKm: 10 }),
    };
    await findNearbyBetterSite({
      centroid: CENTROID,
      areaKm2: 25,
      selected: selectedWithScore(GOOD_SCORE - 20),
      samplers: counting,
    });
    expect(calls).toBeLessThanOrEqual(24);
  });
});
