/**
 * One-time (re-runnable, idempotent) fetch of the GWA combined-Weibull A/k
 * country COGs for India into WEIBULL_COG_DIR (VERIFIED.md §2).
 *
 *   bun scripts/fetch-weibull-cogs.ts
 *
 * Endpoints 302-redirect to CloudFront (~205 MB A + ~186 MB k, CC-BY 4.0).
 * Each file streams to `<dest>.part` and is renamed into place only when
 * complete; an existing file > 100 MB is treated as complete and skipped.
 * The analysis module degrades gracefully (aoiWeibullMeans → null) while
 * these files are absent.
 */

import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WEIBULL_A_FILE,
  WEIBULL_COG_DIR,
  WEIBULL_K_FILE,
} from "../src/services/analysis/constants";

const GWA_COUNTRY_GIS_BASE = "https://globalwindatlas.info/api/gis/country/IND";

/** Both COGs are ~200 MB; anything larger than this is a complete download. */
const COMPLETE_FILE_MIN_BYTES = 100 * 1024 * 1024;
const PROGRESS_EVERY_BYTES = 20 * 1024 * 1024;
const BYTES_PER_MB = 1024 * 1024;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = join(SCRIPT_DIR, "..", WEIBULL_COG_DIR);

interface CogDownload {
  layer: string;
  url: string;
  fileName: string;
}

const DOWNLOADS: readonly CogDownload[] = [
  {
    layer: "combined-Weibull-A @100m",
    url: `${GWA_COUNTRY_GIS_BASE}/combined-Weibull-A/100`,
    fileName: WEIBULL_A_FILE,
  },
  {
    layer: "combined-Weibull-k @100m",
    url: `${GWA_COUNTRY_GIS_BASE}/combined-Weibull-k/100`,
    fileName: WEIBULL_K_FILE,
  },
];

function toMb(bytes: number): string {
  return (bytes / BYTES_PER_MB).toFixed(1);
}

async function fileSizeBytes(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null; // missing file — not an error here
  }
}

async function streamToFile(
  body: ReadableStream<Uint8Array>,
  destPath: string,
  totalBytes: number,
): Promise<number> {
  const writer = Bun.file(destPath).writer();
  let writtenBytes = 0;
  let nextProgressAt = PROGRESS_EVERY_BYTES;
  try {
    for await (const chunk of body) {
      writer.write(chunk);
      writtenBytes += chunk.byteLength;
      if (writtenBytes >= nextProgressAt) {
        await writer.flush();
        const totalNote = totalBytes > 0 ? ` / ${toMb(totalBytes)} MB` : "";
        console.log(`  … ${toMb(writtenBytes)} MB${totalNote}`);
        nextProgressAt += PROGRESS_EVERY_BYTES;
      }
    }
    await writer.end();
    return writtenBytes;
  } catch (err) {
    try {
      await writer.end();
    } catch {
      // best-effort close of the partial file; the original error is rethrown
    }
    await rm(destPath, { force: true });
    throw err;
  }
}

async function downloadOne(download: CogDownload): Promise<void> {
  const destPath = join(TARGET_DIR, download.fileName);
  const existingBytes = await fileSizeBytes(destPath);
  if (existingBytes !== null && existingBytes > COMPLETE_FILE_MIN_BYTES) {
    console.log(
      `✓ ${download.fileName} already present (${toMb(existingBytes)} MB) — skipping`,
    );
    return;
  }

  console.log(`↓ ${download.layer}: ${download.url}`);
  const response = await fetch(download.url); // follows the 302 to CloudFront
  if (!response.ok || !response.body) {
    throw new Error(
      `${download.layer}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  const tempPath = `${destPath}.part`;
  const writtenBytes = await streamToFile(response.body, tempPath, totalBytes);
  await rename(tempPath, destPath);
  console.log(`✓ ${download.fileName} (${toMb(writtenBytes)} MB)`);
}

async function main(): Promise<void> {
  await mkdir(TARGET_DIR, { recursive: true });
  for (const download of DOWNLOADS) {
    await downloadOne(download); // sequential: clearer progress, kinder to CDN
  }
  console.log(`Done. COGs in ${TARGET_DIR}`);
}

main().catch((err) => {
  console.error("fetch-weibull-cogs failed:", err);
  console.error(
    "Weibull reads degrade gracefully (aoiWeibullMeans → null) until both COGs are present. Re-run this script to resume.",
  );
  process.exit(1);
});
