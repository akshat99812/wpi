/**
 * MNRE — Physical Progress crawler.
 *
 * Source of truth for India's wind capacity. Fetches the latest
 * RE-Statistics PDF linked from MNRE's physical-progress landing page,
 * parses it with pdf-parse, and extracts:
 *   - Table 8.2 state-wise wind installed capacity (cumulative)
 *   - National wind installed total
 *
 * Caching:
 *   The PDF is updated by MNRE roughly once a year (annual statistics
 *   bulletin) plus the occasional monthly physical-progress note. We
 *   cache the parsed result on disk for 24 hours so the orchestrator
 *   doesn't re-fetch the ~3.5 MB PDF on every run. On parse failure we
 *   return the last cached payload; if no cache exists we fall back to
 *   the verified MNRE FY25-close snapshot bundled in this file.
 */
import { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const CACHE_PATH      = path.resolve(__dirname, '../../../data/cache/mnre-stats.json');
const CACHE_TTL_MS    = 24 * 60 * 60 * 1000; // 24 h
const PROGRESS_URL    = 'https://mnre.gov.in/en/physical-progress/';
const TARGET_FY30_MW  = 100_000;

// States with non-zero wind capacity in MNRE Table 8.2 (FY25 close).
const WIND_STATES = [
  'Andhra Pradesh', 'Gujarat', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Rajasthan', 'Tamil Nadu', 'Telangana',
];

// Hardcoded fallback — MNRE RE-Statistics 2024-25 Table 8.2 (31.03.2025).
// Used only when we can't fetch the PDF AND no cache exists yet.
const HARDCODED_FALLBACK: MnrePayload = {
  fetchedAt:  new Date('2025-04-01T00:00:00Z').toISOString(),
  fy:         '2024-25',
  sourceUrl:  'https://cdnbbsr.s3waas.gov.in/s3716e1b8c6cd17b771da77391355749f3/uploads/2025/11/202511061627678782.pdf',
  asOf:       '31 March 2025',
  stateCapacity: [
    { state: 'Andhra Pradesh', installed_mw:  4_377 },
    { state: 'Gujarat',        installed_mw: 12_677 },
    { state: 'Karnataka',      installed_mw:  7_351 },
    { state: 'Kerala',         installed_mw:     71 },
    { state: 'Madhya Pradesh', installed_mw:  3_195 },
    { state: 'Maharashtra',    installed_mw:  5_285 },
    { state: 'Rajasthan',      installed_mw:  5_209 },
    { state: 'Tamil Nadu',     installed_mw: 11_740 },
    { state: 'Telangana',      installed_mw:    128 },
  ],
  capacity: { installed_mw: 50_038, target_fy_mw: TARGET_FY30_MW },
};

interface MnrePayload {
  fetchedAt:     string;
  fy:            string;
  sourceUrl:     string;
  asOf:          string;
  stateCapacity: Array<{ state: string; installed_mw: number }>;
  capacity:      { installed_mw: number; target_fy_mw: number };
}

async function loadCache(): Promise<MnrePayload | null> {
  try {
    const buf = await readFile(CACHE_PATH, 'utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

async function saveCache(data: MnrePayload): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(data, null, 2));
}

// Pull the wind column out of Table 8.2 text. We scope to the data block
// that follows the header "Table 8.2 RE cumulative installed capacity as
// on dd.mm.yyyy" and stops at the next table marker ("Table 8.3 …") or
// the row total. Within that block, wind-state rows have the layout
// `State <ws> SmallHydro <ws> Wind <ws> Bio <ws> Solar <ws> LargeHydro <ws> Total`
// (7 fields, 6 numeric). pdf-parse emits tab-separated values; for each
// state we read the 2nd numeric column.
function parseTable82(text: string): Array<{ state: string; installed_mw: number }> {
  const lines = text.split('\n');
  // Locate the data block (skip the table-of-contents reference at the top
  // of the PDF; the actual table appears later with the same header).
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/Table 8\.2 RE cumulative installed capacity as on \d{2}\.\d{2}\.\d{4}/i.test(line)) {
      // Prefer the LAST occurrence (the data block sits after the TOC).
      start = i;
    }
  }
  if (start < 0) return [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*Table 8\.3/i.test(line) || /^\s*Total\s+\d/i.test(line)) {
      end = i;
      break;
    }
  }

  const out: Array<{ state: string; installed_mw: number }> = [];
  for (let i = start; i < end; i++) {
    const raw = lines[i] ?? '';
    for (const s of WIND_STATES) {
      const re = new RegExp(`^\\s*${s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s+([0-9].*)$`);
      const m = raw.match(re);
      if (!m || !m[1]) continue;
      const nums = m[1].split(/[\s\t]+/).map(parseFloat).filter(n => Number.isFinite(n));
      // 6 numbers expected for wind states (SH, Wind, Bio, Solar, LH, Total).
      // Wind is column 2 → nums[1].
      if (nums.length >= 6 && typeof nums[1] === 'number') {
        out.push({ state: s, installed_mw: Math.round(nums[1]) });
      }
      break;
    }
  }
  return out;
}

async function fetchAndParse(): Promise<MnrePayload> {
  // 1. Pull the physical-progress landing page to find the latest
  //    RE-Statistics PDF link. The hyperlink text always starts with
  //    "RE-Statistics YYYY-YY".
  const progressRes = await politeFetch(PROGRESS_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  });
  if (!progressRes.ok) throw new Error(`physical-progress page HTTP ${progressRes.status}`);
  const html = await progressRes.text();

  const linkMatch = html.match(/href="(https?:\/\/[^"]+\.pdf)"[^>]*tabindex="-1"[^>]*>\s*RE[ -]Statistics\s*(\d{4})-(\d{2})/i);
  if (!linkMatch || !linkMatch[1]) throw new Error('RE-Statistics PDF link not found on physical-progress page');
  const pdfUrl = linkMatch[1];
  const fy     = `${linkMatch[2]}-${linkMatch[3]}`;

  // 2. Download the PDF.
  const pdfRes = await politeFetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`PDF HTTP ${pdfRes.status} at ${pdfUrl}`);
  const pdfBuf = await pdfRes.arrayBuffer();

  // 3. Parse text with pdf-parse.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: Buffer.from(pdfBuf) });
  const result = await parser.getText();
  const text   = typeof result === 'string'
    ? result
    : ((result as { text?: string }).text ?? '');

  // 4. Extract Table 8.2 wind values.
  const stateCapacity = parseTable82(text);
  if (stateCapacity.length === 0) throw new Error('Table 8.2 parse returned zero wind states');

  const installed_mw = stateCapacity.reduce((s, x) => s + x.installed_mw, 0);

  // 5. Surface the "as on dd.mm.yyyy" stamp from the section header so the
  //    UI can show the freshness date.
  const asOfMatch = text.match(/Table 8\.2 RE cumulative installed capacity as on (\d{2}\.\d{2}\.\d{4})/i);
  const asOf = asOfMatch && asOfMatch[1] ? asOfMatch[1] : `FY${fy.split('-')[0]}-${fy.split('-')[1]}`;

  return {
    fetchedAt: new Date().toISOString(),
    fy, sourceUrl: pdfUrl, asOf,
    stateCapacity,
    capacity: { installed_mw, target_fy_mw: TARGET_FY30_MW },
  };
}

export const mnreCrawler = {
  key: 'mnre',
  name: 'Ministry of New & Renewable Energy',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    const cache = await loadCache();

    // Serve from cache if it's still fresh (24h TTL).
    if (cache) {
      const age = Date.now() - new Date(cache.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return {
          source: 'mnre', fetchedAt, ok: true,
          payload: { ...cache, _cache: { hit: true, ageMs: age } },
        };
      }
    }

    // Refresh from MNRE.
    try {
      const fresh = await fetchAndParse();
      await saveCache(fresh);
      return {
        source: 'mnre', fetchedAt, ok: true,
        payload: { ...fresh, _cache: { hit: false } },
      };
    } catch (err) {
      // Cache is stale but still useful when MNRE is unreachable.
      if (cache) {
        return {
          source: 'mnre', fetchedAt, ok: true,
          payload: { ...cache, _cache: { hit: true, stale: true, error: (err as Error).message } },
        };
      }
      // Cold start with no cache and no upstream — fall back to the
      // hardcoded FY25-close snapshot so the UI never renders blank.
      return {
        source: 'mnre', fetchedAt, ok: true, fixturesUsed: true,
        error: (err as Error).message,
        payload: { ...HARDCODED_FALLBACK, _cache: { hit: false, fallback: true } },
      };
    }
  },
};
