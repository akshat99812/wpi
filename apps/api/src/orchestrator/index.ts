import fs from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { merge, type SourceResult } from './merge';
import { mnreCrawler } from './crawlers/mnre';
import { seciCrawler } from './crawlers/seci';
import { mercomCrawler } from './crawlers/mercom';
import { renewableWatchCrawler } from './crawlers/renewable_watch';
import { pibCrawler } from './crawlers/pib';
import { globalWindAtlasCrawler } from './crawlers/global_wind_atlas';
import {
  ceaCrawler,
  niweCrawler,
  lendersCrawler,
  cercCrawler,
  stateSercCrawler,
  stateNodalCrawler,
  gridCrawler,
  oemReportsCrawler,
  analystNotesCrawler
} from './crawlers/others';

const crawlers = [
  mnreCrawler,
  ceaCrawler,
  niweCrawler,
  seciCrawler,
  lendersCrawler,
  cercCrawler,
  stateSercCrawler,
  stateNodalCrawler,
  mercomCrawler,
  renewableWatchCrawler,
  pibCrawler,
  gridCrawler,
  globalWindAtlasCrawler,
  oemReportsCrawler,
  analystNotesCrawler
];

const dataDir = path.resolve(__dirname, '../../data');

export const runOrchestrator = async (sourceKey?: string) => {
  console.log(`Starting orchestrator run. Target: ${sourceKey || 'all'}`);

  const results: SourceResult[] = [];
  const crawlersToRun = sourceKey
    ? crawlers.filter(c => c.key === sourceKey)
    : crawlers;

  // Run crawlers concurrently in small batches to be polite
  const BATCH_SIZE = 3;
  for (let i = 0; i < crawlersToRun.length; i += BATCH_SIZE) {
    const batch = crawlersToRun.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async crawler => {
        try {
          console.log(`Running crawler: ${crawler.key}`);
          return await crawler.run();
        } catch (error) {
          console.error(`Crawler ${crawler.key} threw unhandled error:`, error);
          return {
            source: crawler.key,
            fetchedAt: new Date(),
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            payload: {}
          } satisfies SourceResult;
        }
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }

  // Merge results into bundle
  const bundle = merge(results);

  // Ensure data directory structure
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'by-source'), { recursive: true });

  const dateStr = new Date().toISOString().split('T')[0] || 'unknown-date';
  const archiveDir = path.join(dataDir, 'archive', dateStr);
  await fs.mkdir(archiveDir, { recursive: true });

  // Write outputs
  const bundleJson = JSON.stringify(bundle, null, 2);
  await fs.writeFile(path.join(dataDir, 'latest.json'), bundleJson);
  await fs.writeFile(path.join(archiveDir, 'latest.json'), bundleJson);

  for (const result of results) {
    await fs.writeFile(
      path.join(dataDir, 'by-source', `${result.source}.json`),
      JSON.stringify(result, null, 2)
    );
  }

  const sourceStats = results.map(r => `${r.source}: ${r.ok ? '✓' : '✗'}${r.fixturesUsed ? ' (fixture)' : ''}`).join(', ');
  console.log(`Orchestrator complete. Results: ${sourceStats}`);
  console.log(`Bundle written to ${path.join(dataDir, 'latest.json')}`);
};
