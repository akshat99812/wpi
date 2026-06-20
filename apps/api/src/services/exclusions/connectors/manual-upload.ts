/**
 * Manual gazette-upload connector (exclusion-plan.md Phase D) — the highest
 * legal-value path: genuinely notified boundaries (notified ESZ, gazette-verified
 * PA, exact RF/PF, monument protected limits) that aren't in any open GIS feed.
 *
 * Every upload MUST carry provenance: layer_code, class, and a gazette reference
 * (number + date + URL) in `notes`. is_legal_boundary defaults true (these are
 * notified limits). Idempotent per `gazette_no`: re-uploading the same
 * notification replaces its prior rows rather than duplicating them.
 *
 * This is also the function an auth-gated upload route would call.
 */
import fs from "node:fs";
import type { Pool } from "pg";
import { loadPolygons, type LoadResult } from "../loader";
import { seedSource, SOURCES } from "../registry";
import { isPolygonal, type ExclClass, type Feature, type NormalisedFeature } from "../types";

export type ManualUploadMeta = {
  layer_code: string; // e.g. 'esz_notified', 'national_park', 'forest_legal'
  class: ExclClass;
  notes: string; // gazette no. + date + URL — REQUIRED
  gazette_no?: string;
  gazette_date?: string; // free-text gazette date string, stored verbatim
  gazette_url?: string;
  is_legal_boundary?: boolean; // default true (notified)
  state?: string;
};

function validateMeta(meta: ManualUploadMeta): void {
  if (!meta.layer_code) throw new Error("manual upload: layer_code is required");
  if (meta.class !== "red" && meta.class !== "amber")
    throw new Error("manual upload: class must be 'red' or 'amber'");
  if (!meta.notes || meta.notes.trim().length < 8)
    throw new Error("manual upload: notes must cite the gazette (number + date + URL)");
}

/** Load a validated GeoJSON FeatureCollection of notified boundaries. */
export async function loadManualUpload(
  pool: Pool,
  filePath: string,
  meta: ManualUploadMeta,
): Promise<LoadResult> {
  validateMeta(meta);
  if (!fs.existsSync(filePath)) throw new Error(`Upload file not found: ${filePath}`);

  const fc = JSON.parse(fs.readFileSync(filePath, "utf8")) as { features?: Feature[] };
  const features = fc.features ?? [];
  const isLegal = meta.is_legal_boundary ?? true;

  const normalised: NormalisedFeature[] = features
    .filter((f) => isPolygonal(f.geometry))
    .map((f) => ({
      geometry: f.geometry!,
      layer_code: meta.layer_code,
      class: meta.class,
      source_id: "manual_gazette",
      is_legal_boundary: isLegal,
      attrs: {
        ...(f.properties ?? {}),
        notes: meta.notes,
        gazette_no: meta.gazette_no ?? null,
        gazette_date: meta.gazette_date ?? null,
        gazette_url: meta.gazette_url ?? null,
        state: meta.state ?? null,
      },
    }));

  if (normalised.length === 0) throw new Error(`No polygonal features found in ${filePath}`);

  await seedSource(pool, SOURCES.manual_gazette!);

  // Idempotent per gazette_no: clear this notification's prior rows, then append.
  if (meta.gazette_no) {
    await pool.query(
      `DELETE FROM wce.excl_polygon WHERE source_id='manual_gazette' AND attrs->>'gazette_no' = $1`,
      [meta.gazette_no],
    );
  }
  // Append (never truncate the whole manual source — it holds many notifications).
  return loadPolygons(pool, SOURCES.manual_gazette!, normalised, { truncate: false });
}
