/**
 * Phase 5 shadow-path smoke: exercise the Express-side serviceClient +
 * shadowDiff against the RUNNING FastAPI service, using the frozen golden as the
 * "legacy" reference. Proves the proxy + comparator end-to-end WITHOUT needing
 * an authenticated Express session (which is user-driven).
 *
 * Run: SITE_ANALYSIS_SERVICE_URL=http://127.0.0.1:8011 bun MIGRATION/parity/shadow_smoke.ts
 */
import { readFileSync } from "fs";
import { analyzeViaService } from "../../apps/api/src/services/analysis/serviceClient";
import { diffResponses } from "../../apps/api/src/services/analysis/shadowDiff";

const GOLDEN = `${import.meta.dir}/../golden`;
const FIXTURES = [
  "excellent_muppandal_point",
  "large_aoi_tn",
  "marginal_bhadla_point",
  "moderate_interior_tn",
  "tiny_aoi",
  "ocean_nodata",
];

let failures = 0;
for (const name of FIXTURES) {
  const request = JSON.parse(readFileSync(`${GOLDEN}/${name}/request.json`, "utf8"));
  const legacy = JSON.parse(readFileSync(`${GOLDEN}/${name}/response.json`, "utf8"));
  try {
    const service = await analyzeViaService(request.geometry);
    const divergences = diffResponses(legacy, service);
    if (divergences.length === 0) {
      console.log(`  OK  ${name}`);
    } else {
      failures++;
      console.log(`  XX  ${name}  (${divergences.length} divergence(s))`);
      for (const d of divergences.slice(0, 10)) console.log(`       ${d.path}: legacy=${JSON.stringify(d.legacy)} service=${JSON.stringify(d.service)}`);
    }
  } catch (err) {
    failures++;
    console.log(`  XX  ${name}  (service error: ${(err as Error).message})`);
  }
}
console.log(`\n${FIXTURES.length - failures}/${FIXTURES.length} shadow comparisons clean`);
process.exit(failures === 0 ? 0 : 1);
