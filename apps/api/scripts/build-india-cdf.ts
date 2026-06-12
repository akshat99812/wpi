/**
 * Build data/analysis/india-ws100-cdf.json — 101 quantiles (q0..q100) of all
 * valid India ws@100m cells from the baked wind-atlas cursor grid. Consumed
 * by src/services/analysis/indiaCdf.ts for the "windier than X% of India"
 * stat. Re-run only after a wind-atlas grid re-bake:
 *
 *     cd apps/api && bun scripts/build-india-cdf.ts
 *
 * Source grid payload (see apps/web/scripts/build_wind_atlas.py bake_grid):
 * { scale, data: int[], ... } — value = data[i]/scale m/s, 0 = nodata.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GRID_PATH = path.resolve(
  HERE,
  "../../web/public/wind-atlas/grids/100m.json",
);
const OUT_DIR = path.resolve(HERE, "../data/analysis");
const OUT_PATH = path.join(OUT_DIR, "india-ws100-cdf.json");
const QUANTILE_COUNT = 101;

interface GridPayload {
  scale: number;
  data: number[];
  source?: string;
}

/** Linear-interpolated quantile of a sorted array, q in [0, 1]. */
function quantileOf(sorted: number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loV = sorted[lo];
  const hiV = sorted[hi];
  if (loV === undefined || hiV === undefined) {
    throw new Error(`quantile index out of range: q=${q}`);
  }
  return loV + (hiV - loV) * (pos - lo);
}

async function main(): Promise<void> {
  const payload = (await Bun.file(GRID_PATH).json()) as GridPayload;
  if (!Array.isArray(payload.data) || typeof payload.scale !== "number") {
    throw new Error(`unexpected grid payload shape at ${GRID_PATH}`);
  }

  const values = payload.data
    .filter((v) => v > 0)
    .map((v) => v / payload.scale)
    .sort((a, b) => a - b);
  if (values.length < 1000) {
    throw new Error(
      `implausibly few valid cells (${values.length}) — wrong grid file?`,
    );
  }

  const quantiles = Array.from({ length: QUANTILE_COUNT }, (_, i) =>
    Number(quantileOf(values, i / (QUANTILE_COUNT - 1)).toFixed(3)),
  );

  await mkdir(OUT_DIR, { recursive: true });
  await Bun.write(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source:
          payload.source ??
          "apps/web/public/wind-atlas/grids/100m.json (GWA v4 @100 m, India land)",
        validCells: values.length,
        quantiles,
      },
      null,
      1,
    ),
  );

  console.log(
    `wrote ${OUT_PATH}: ${values.length} cells · ` +
      `q0=${quantiles[0]} q50=${quantiles[50]} q100=${quantiles[100]}`,
  );
}

await main();
