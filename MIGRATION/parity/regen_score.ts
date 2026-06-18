/**
 * Re-align the stale score block of the v1-captured golden fixtures to the
 * CURRENT legacy score.ts (v2). The golden was captured 2026-06-18 from a stale
 * :3005 process still running v1 breakpoints (resource 5.0/9.0, cf 0.15/0.45),
 * two days after the v2 recalibration (ca42333). Everything else in each fixture
 * is correct and byte-stable; only score.{value,normalized,points} for the
 * resource+cf components is stale.
 *
 * Authoritative source = the REAL legacy computeScore (NOT the FastAPI port).
 * The 4 score inputs are recovered from the fixture's own components[*].raw
 * (resource->meanSpeed, cf->cfIec3, grid->nearestEhvKm, terrain->slope90thDeg)
 * and score.confidence — all already byte-for-byte correct in the golden.
 *
 * Safety: parse->stringify must be byte-idempotent or the sha drifts. We PROVE
 * that on two fixtures we DON'T touch (excellent_muppandal_point, ocean_nodata)
 * before rewriting anything; a mismatch aborts.
 *
 * Run: bun MIGRATION/parity/regen_score.ts
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { computeScore } from "../../apps/api/src/services/analysis/score";

const GOLDEN = `${import.meta.dir}/../golden`;
const STALE = ["large_aoi_tn", "marginal_bhadla_point", "moderate_interior_tn", "tiny_aoi"];
const ROUND_TRIP_CHECK = ["excellent_muppandal_point", "ocean_nodata"];
const RESPONSE_FILES = ["response.json", "response.hit.json", "response.miss.json"];

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// 1. Prove byte-idempotent round-trip on fixtures we will NOT modify.
for (const name of ROUND_TRIP_CHECK) {
  const raw = readFileSync(`${GOLDEN}/${name}/response.json`, "utf8");
  const restringified = JSON.stringify(JSON.parse(raw));
  const expected = readFileSync(`${GOLDEN}/${name}/response.sha256`, "utf8").trim();
  if (sha256(restringified) !== expected || sha256(raw) !== expected) {
    console.error(`ABORT: ${name} is not parse->stringify byte-idempotent; serialization would drift.`);
    process.exit(1);
  }
  console.log(`round-trip OK: ${name}`);
}

// 2. Regenerate the stale score block from the authoritative legacy computeScore.
for (const name of STALE) {
  const path = `${GOLDEN}/${name}/response.json`;
  const resp = JSON.parse(readFileSync(path, "utf8"));
  const rawOf = Object.fromEntries(resp.score.components.map((c: any) => [c.key, c.raw]));
  const oldValue = resp.score.value;

  resp.score = computeScore(
    {
      meanSpeed: rawOf.resource,
      cfIec3: rawOf.cf,
      nearestEhvKm: rawOf.grid,
      slope90thDeg: rawOf.terrain,
    },
    resp.score.confidence,
  );

  const body = JSON.stringify(resp);
  for (const f of RESPONSE_FILES) writeFileSync(`${GOLDEN}/${name}/${f}`, body);
  writeFileSync(`${GOLDEN}/${name}/response.sha256`, sha256(body) + "\n");
  console.log(`${name}: score.value ${oldValue} -> ${resp.score.value}  (sha ${sha256(body).slice(0, 12)})`);
}
console.log("Done. Re-run the parity harness to confirm 10/10.");
