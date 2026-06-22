/**
 * Golden tests (plan §4 Phase 6) — run against LIVE dependencies (GWA tiler
 * via the disk cache, local Weibull COGs, PostGIS masts, OpenInfraMap tiles).
 * Bands come from VERIFIED.md's addendum; loosen them ONLY with a matching
 * VERIFIED.md update. Entirely skipped under SKIP_LIVE=1.
 */

import { describe, expect, test } from "bun:test";
import { pool } from "../../lib/db";
import { analyzeAoi } from "./index";
import { validateAoi } from "./geometry";
import { squareRingAround } from "./mercator";
import type { AnalysisResponse } from "./types";

const LIVE = process.env.SKIP_LIVE !== "1";
const LIVE_TIMEOUT_MS = 30_000;

function pointAoi(lon: number, lat: number) {
  return validateAoi({
    type: "Polygon",
    coordinates: [squareRingAround(lon, lat, 5)],
  });
}

/** One live run per site, shared across the assertions below. */
let muppandalPromise: Promise<AnalysisResponse> | null = null;
function muppandal(): Promise<AnalysisResponse> {
  muppandalPromise ??= analyzeAoi(pointAoi(77.55, 8.26));
  return muppandalPromise;
}

let bhadlaPromise: Promise<AnalysisResponse> | null = null;
function bhadla(): Promise<AnalysisResponse> {
  bhadlaPromise ??= analyzeAoi(pointAoi(71.92, 27.53));
  return bhadlaPromise;
}

describe.skipIf(!LIVE)("golden: Muppandal 5×5 km", () => {
  test("resource lands in the VERIFIED.md bands", async () => {
    const { sections } = await muppandal();
    expect(sections.resource.status).toBe("ok");
    const r = sections.resource.data!;

    expect(r.meanSpeed).toBeGreaterThanOrEqual(8.7);
    expect(r.meanSpeed).toBeLessThanOrEqual(10.3);
    expect(r.cfIec3).toBeGreaterThanOrEqual(0.632);
    expect(r.cfIec3).toBeLessThanOrEqual(0.712);
    expect(r.shearAlpha).toBeGreaterThanOrEqual(0.18);
    expect(r.shearAlpha).toBeLessThanOrEqual(0.3);
    expect(r.siteClass).toBe("excellent");
    expect(r.indiaPercentile).toBeGreaterThanOrEqual(95);
    // Stat ordering: low-tail exceedance below the quartile ladder.
    expect(r.areaExceedance90).toBeLessThan(r.p25Speed);
    expect(r.p25Speed).toBeLessThan(r.p50Speed);
    expect(r.p50Speed).toBeLessThan(r.p75Speed);
    expect(r.p75Speed).toBeLessThan(r.maxSpeed);
  }, LIVE_TIMEOUT_MS);

  test("Weibull consistency: A·Γ(1+1/k) within 5% of mean speed", async () => {
    const { sections } = await muppandal();
    const r = sections.resource.data!;
    expect(r.weibull).not.toBeNull();
    const { A, k } = r.weibull!;
    const impliedMean = A * gamma(1 + 1 / k);
    expect(Math.abs(impliedMean - r.meanSpeed) / r.meanSpeed).toBeLessThan(0.05);
  }, LIVE_TIMEOUT_MS);

  test("mast count equals direct SQL; delta within the recorded band", async () => {
    const { sections } = await muppandal();
    expect(sections.validation.status).toBe("ok");
    const v = sections.validation.data!;

    const aoi = pointAoi(77.55, 8.26);
    const ringGeoJson = JSON.stringify({
      type: "Polygon",
      coordinates: [aoi.ring],
    });
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM windmills
       WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))`,
      [ringGeoJson],
    );
    expect(v.mastCountInAoi).toBe(Number(rows[0]?.count));

    expect(v.nearestMast).not.toBeNull();
    expect(v.nearestMast!.distanceKm).toBeLessThan(25);
    expect(v.confidence).toBe("high");
    if (v.modelDeltaPct !== null) {
      expect(Math.abs(v.modelDeltaPct)).toBeLessThanOrEqual(20);
    }
  }, LIVE_TIMEOUT_MS);

  test("grid matches the Overpass-verified neighborhood", async () => {
    const { sections } = await muppandal();
    expect(sections.grid.status).toBe("ok");
    const g = sections.grid.data!;
    expect(g.nearestSubstation).not.toBeNull();
    expect(g.nearestSubstation!.distanceKm).toBeLessThan(5);
    expect(g.nearestLine).not.toBeNull();
    expect(g.nearestLine!.distanceKm).toBeLessThan(5);
    expect(g.ehvWithin25Km).toBe(true);
  }, LIVE_TIMEOUT_MS);

  test("score is reproducible from its own components and reads excellent", async () => {
    // Bands recalibrated for the §A CUF-anchored score (was 80–95 under the old
    // raw-speed 4-component score). Re-VERIFY against a fresh live run before
    // tightening — see VERIFIED.md.
    const { score, financials } = await muppandal();
    const sum = score.components.reduce((acc, c) => acc + c.points, 0);
    expect(Math.abs(score.value - sum)).toBeLessThanOrEqual(0.5);
    // Top-class resource (~9+ m/s, cuf ~0.46) with grid on-site → near maximum.
    expect(score.value).toBeGreaterThanOrEqual(88);
    expect(score.value).toBeLessThanOrEqual(100);
    expect(score.rating).toBe("Excellent");
    expect(score.confidence).toBe("high");
    // Part B is present and bankable-looking for a strong site.
    expect(financials).not.toBeNull();
    expect(financials!.irr).not.toBeNull();
    expect(financials!.irr!).toBeGreaterThan(0.12);
  }, LIVE_TIMEOUT_MS);

  test("AOI ~94% inside an existing farm → sizing collapses (§2.5)", async () => {
    const { sections, aoi } = await muppandal();
    expect(sections.context.status).toBe("ok");
    const c = sections.context.data!;
    expect(c.windfarms.count).toBeGreaterThanOrEqual(1);
    expect(c.windfarms.overlapFraction).toBeGreaterThan(0.8);
    // capacity ≪ the no-overlap figure (25 km² · 0.7 · 5 = 87.5 MW).
    expect(c.sizing.capacityMw).toBeLessThan(20);
    expect(c.states.map((s) => s.name)).toContain("Tamil Nadu");
    expect(aoi.isPointMode).toBe(true);
  }, LIVE_TIMEOUT_MS);
});

describe.skipIf(!LIVE)("golden: Bhadla 5×5 km (solar country)", () => {
  test("wind resource reads moderate, never offshore-flattered", async () => {
    const { sections, score } = await bhadla();
    expect(sections.resource.status).toBe("ok");
    const r = sections.resource.data!;
    expect(r.meanSpeed).toBeGreaterThanOrEqual(5.5);
    expect(r.meanSpeed).toBeLessThanOrEqual(6.5);
    expect(r.siteClass).toBe("marginal");
    // CUF-anchored: a ~6 m/s site (cuf ~0.40) is "moderate commercial", not
    // maxed — its resource component stays below full credit (weight 72).
    const resourcePts = score.components.find((c) => c.key === "resource")!.points;
    expect(resourcePts).toBeGreaterThan(0);
    expect(resourcePts).toBeLessThan(72);
  }, LIVE_TIMEOUT_MS);

  test("scores below Muppandal", async () => {
    const [b, m] = await Promise.all([bhadla(), muppandal()]);
    // The CUF curve rewards a decent ~6 m/s site, so the gap narrows vs the old
    // raw-speed score, but Muppandal still leads clearly.
    expect(b.score.value).toBeLessThan(m.score.value);
    expect(m.score.value - b.score.value).toBeGreaterThanOrEqual(8);
  }, LIVE_TIMEOUT_MS);
});

/** Lanczos gamma (g=7, n=9) — test-local helper for the consistency check. */
function gamma(z: number): number {
  const g = 7;
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const shifted = z - 1;
  let x = coefficients[0] as number;
  for (let i = 1; i < g + 2; i++) {
    x += (coefficients[i] as number) / (shifted + i);
  }
  const t = shifted + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (shifted + 0.5) * Math.exp(-t) * x;
}
