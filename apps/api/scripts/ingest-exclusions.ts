/**
 * Exclusion-zone ingest driver (exclusion-plan.md). One CLI over the whole
 * pipeline: seed the source registry, load downloadable legal polygons (Phase B),
 * derive buffers (Phase C), load OSM PAs / infra, accept manual gazette uploads
 * (Phase D), and run the Phase F validation/QA.
 *
 * Execution order from the runbook:  A → B → C → E → D → F
 *
 * Usage:
 *   bun run apps/api/scripts/ingest-exclusions.ts <command> [options]
 *
 * Commands:
 *   seed                       Upsert every source_registry row
 *   phase-a                    Load admin base (country [+ states if converted])
 *   crz       [file]           Phase B1 — CRZ regulatory zones (.geojsonl)
 *   wetlands  [file]           Phase B2 — Ramsar + notified wetlands (.geojsonl)
 *   forest    [file]           Phase B3 — RF/PF legal + FSI cover (.geojsonl)
 *   osm-pa    [--refresh]      Phase B4 — OSM protected areas (Overpass)
 *   buffers                    Phase C  — ASI 100/300 + ESZ-default 10km + settlement
 *   manual    <file> --layer=<lc> --class=red|amber --notes="gazette no+date+url"
 *                              Phase D  — notified gazette upload  [--gazette-no=, --gazette-date=, --gazette-url=, --state=]
 *   coverage                   Phase F  — per-layer coverage report
 *   audit                      Phase F  — classification audit + invalid-geom + orphans
 *   licenses                   Phase F  — write data/by-source/LICENSES.md
 *   status                     Summary of what's loaded
 *
 * Global options:  --no-truncate (append instead of replacing a source)
 */
import fs from "node:fs";
import path from "node:path";
import { pool, dbAvailable } from "../src/lib/db";
import { SOURCES, seedSource } from "../src/services/exclusions/registry";
import { ingestCountry, ingestStates, adminPath } from "../src/services/exclusions/connectors/admin";
import {
  ingestCrz, ingestWetlands, ingestForest, ingestRamsar, ingestGatiPa, ingestEsz,
  ingestRfa, ingestWetlandInventory, rawDir,
} from "../src/services/exclusions/connectors/india-geodata";
import { ingestOsmPa } from "../src/services/exclusions/connectors/osm-pa";
import { ingestInfra } from "../src/services/exclusions/connectors/infra";
import { ingestAsi } from "../src/services/exclusions/connectors/asi";
import { loadManualUpload } from "../src/services/exclusions/connectors/manual-upload";
import { buildAllBuffers } from "../src/services/exclusions/buffers";
import {
  coverageReport, classificationAudit, invalidGeomCount, orphanCheck, writeLicenses,
} from "../src/services/exclusions/validate";

// ── tiny arg parser (mirrors scripts/ingest-turbines.ts) ─────────────────────
function parseArgs(argv: string[]): { _: string[]; opts: Record<string, string | boolean> } {
  const _: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      opts[k!] = v === undefined ? true : v;
    } else _.push(a);
  }
  return { _, opts };
}

/** First file in a raw dir matching one of the extensions. */
function findRaw(sourceId: string, exts: string[]): string | null {
  const dir = rawDir(sourceId);
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
  return hit ? path.join(dir, hit) : null;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!dbAvailable()) fail("DATABASE_URL not set — start PostGIS and set DATABASE_URL.");

  const { _, opts } = parseArgs(process.argv.slice(2));
  const cmd = _[0];
  const truncate = opts["no-truncate"] ? false : true;

  switch (cmd) {
    case "seed": {
      for (const def of Object.values(SOURCES)) await seedSource(pool, def);
      console.log(`✓ seeded ${Object.keys(SOURCES).length} source_registry rows`);
      break;
    }

    case "phase-a": {
      const country = adminPath("soi_country", "india-composite.geojson");
      const n = await ingestCountry(pool, country, { truncate });
      console.log(`✓ admin_country: ${n} feature(s)`);
      const statesGeo = findRaw("soi_states", [".geojsonl", ".geojson"]);
      if (statesGeo) {
        const s = await ingestStates(pool, statesGeo, { truncate });
        console.log(`✓ admin_state: ${s} feature(s)`);
      } else {
        console.log("• admin_state skipped — download india-geodata admin/states (SOI_States.geojsonl.7z) into data/by-source/soi_states/raw/.");
      }
      break;
    }

    case "crz": {
      const file = (_[1] as string) ?? findRaw("crz", [".geojsonl", ".geojson"]);
      if (!file) fail("no CRZ file — pass a path or download into data/by-source/crz/raw/");
      const r = await ingestCrz(pool, file as string, { truncate });
      console.log(`✓ crz: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "wetlands": {
      const file = (_[1] as string) ?? findRaw("wetlands", [".geojsonl", ".geojson"]);
      if (!file) fail("no wetlands file — pass a path or download into data/by-source/wetlands/raw/");
      const r = await ingestWetlands(pool, file as string, { truncate });
      console.log(`✓ wetlands: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "forest": {
      const file = (_[1] as string) ?? findRaw("forest", [".geojsonl", ".geojson"]);
      if (!file) fail("no forest file — pass a path or download into data/by-source/forest/raw/");
      const r = await ingestForest(pool, file as string, { truncate });
      console.log(`✓ forest: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "ramsar": {
      const file = (_[1] as string) ?? findRaw("wetlands", [".geojsonl", ".geojson"]);
      if (!file) fail("no Ramsar file — download into data/by-source/wetlands/raw/");
      const r = await ingestRamsar(pool, file as string, { truncate });
      console.log(`✓ ramsar: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "pa": {
      const file = (_[1] as string) ?? findRaw("gatishakti_pa", [".geojsonl", ".geojson"]);
      if (!file) fail("no GatiShakti PA file — download into data/by-source/gatishakti_pa/raw/");
      const r = await ingestGatiPa(pool, file as string, { truncate });
      console.log(`✓ gatishakti_pa: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "esz": {
      const file = (_[1] as string) ?? findRaw("esz_notified", [".geojsonl", ".geojson"]);
      if (!file) fail("no ESZ file — download into data/by-source/esz_notified/raw/");
      const r = await ingestEsz(pool, file as string, { truncate });
      console.log(`✓ esz_notified: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "rfa": {
      const file = (_[1] as string) ?? findRaw("bharatmaps_rfa", [".geojsonl", ".geojson"]);
      if (!file) fail("no RFA file — download into data/by-source/bharatmaps_rfa/raw/");
      const r = await ingestRfa(pool, file as string, { truncate });
      console.log(`✓ bharatmaps_rfa: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "wetland-inventory": {
      const file = (_[1] as string) ?? findRaw("wetland_inventory", [".geojsonl", ".geojson"]);
      if (!file) fail("no wetland-inventory file — download into data/by-source/wetland_inventory/raw/");
      const r = await ingestWetlandInventory(pool, file as string, { truncate });
      console.log(`✓ wetland_inventory: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "osm-pa": {
      const r = await ingestOsmPa(pool, { refresh: Boolean(opts.refresh), truncate });
      console.log(`✓ osm_pa: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "asi": {
      const r = await ingestAsi(pool, { refresh: Boolean(opts.refresh), truncate });
      console.log(`✓ asi monuments: ${r.inserted} inserted, ${r.skipped} skipped`);
      break;
    }

    case "infra": {
      const results = await ingestInfra(pool, { truncate });
      for (const [kind, r] of Object.entries(results)) console.log(`✓ infra ${kind}: ${r.inserted} inserted`);
      break;
    }

    case "buffers": {
      const results = await buildAllBuffers(pool);
      for (const b of results) console.log(`✓ ${b.rule}: ${b.inserted} buffer(s)`);
      break;
    }

    case "manual": {
      const file = _[1] as string;
      if (!file) fail('usage: manual <file.geojson> --layer=<lc> --class=red|amber --notes="gazette …"');
      const r = await loadManualUpload(pool, file, {
        layer_code: String(opts.layer ?? ""),
        class: (opts.class as "red" | "amber") ?? "red",
        notes: String(opts.notes ?? ""),
        gazette_no: opts["gazette-no"] ? String(opts["gazette-no"]) : undefined,
        gazette_date: opts["gazette-date"] ? String(opts["gazette-date"]) : undefined,
        gazette_url: opts["gazette-url"] ? String(opts["gazette-url"]) : undefined,
        state: opts.state ? String(opts.state) : undefined,
      });
      console.log(`✓ manual upload: ${r.inserted} inserted`);
      break;
    }

    case "coverage": {
      const rows = await coverageReport(pool);
      if (rows.length === 0) console.log("(no features loaded yet)");
      console.table(
        rows.map((r) => ({
          table: r.table, layer: r.layer_code, source: r.source_id, tier: r.legal_tier,
          legal: r.is_legal_boundary, features: r.features, area_km2: r.area_km2, "%india": r.pct_india,
        })),
      );
      break;
    }

    case "audit": {
      const [violations, invalid, orphans] = await Promise.all([
        classificationAudit(pool), invalidGeomCount(pool), orphanCheck(pool),
      ]);
      console.log(`invalid geometries : ${invalid}`);
      console.log(`orphan rows        : ${orphans}`);
      console.log(`legal-tier violations: ${violations.length}`);
      for (const v of violations.slice(0, 20)) console.log(`  ✗ ${v.layer_code} (${v.source_id}) — ${v.reason}`);
      if (violations.length || invalid || orphans) {
        console.error("✗ audit FAILED");
        process.exitCode = 2;
      } else {
        console.log("✓ audit green");
      }
      break;
    }

    case "licenses": {
      const out = await writeLicenses(pool);
      console.log(`✓ wrote ${out}`);
      break;
    }

    case "status": {
      const q = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
      const sources = await q("SELECT COUNT(*) n FROM wce.source_registry");
      const polys = await q("SELECT COUNT(*) n FROM wce.excl_polygon");
      const buffers = await q("SELECT COUNT(*) n FROM wce.excl_buffer");
      const infra = await q("SELECT COUNT(*) n FROM wce.infra_feature");
      const country = await q("SELECT COUNT(*) n FROM wce.admin_country");
      const states = await q("SELECT COUNT(*) n FROM wce.admin_state");
      console.log(`sources=${sources} excl_polygon=${polys} excl_buffer=${buffers} infra=${infra} admin_country=${country} admin_state=${states}`);
      break;
    }

    default:
      console.log("commands: seed | phase-a | crz | ramsar | wetlands | wetland-inventory | pa | esz | forest | rfa | osm-pa | asi | infra | buffers | manual | coverage | audit | licenses | status");
      if (cmd) fail(`unknown command "${cmd}"`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
