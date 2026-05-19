/**
 * MNRE — Physical Progress crawler.
 *
 * Source of truth for India's wind capacity. MNRE's physical-progress
 * landing page links two relevant PDFs:
 *   1. The MONTHLY "State wise RE Installed Capacity as on dd.mm.yyyy"
 *      report — current to within a month. This is what we want.
 *   2. The ANNUAL "RE-Statistics YYYY-YY" bulletin (Table 8.2) — only
 *      updated each November and ~12 months stale by the time we read it.
 *
 * We prefer the monthly link; if not present we fall back to the annual
 * RE-Statistics PDF (Table 8.2 has the same column structure). Both
 * PDFs lay rows out as:
 *   `State <ws> SmallHydro <ws> Wind <ws> Bio <ws> Solar <ws> LargeHydro <ws> Total`
 * so the wind column is always the 2nd number after the state name.
 *
 * Caching:
 *   MNRE refreshes the monthly PDF roughly once per month and the
 *   annual once per year, but we only need quarterly granularity here,
 *   so we hold the parsed result on disk for 90 days. On parse failure
 *   we return the last cached payload; if no cache exists we fall back
 *   to the verified MNRE FY25-close snapshot bundled in this file.
 */
import { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const CACHE_PATH      = path.resolve(__dirname, '../../../data/cache/mnre-stats.json');
const CACHE_TTL_MS    = 90 * 24 * 60 * 60 * 1000; // 90 days
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

// Pull the wind column out of the state-wise capacity table. Works on
// both the annual Table 8.2 block and the monthly "State wise RE
// Installed Capacity" PDF — in both, wind-state rows have the layout
// `State <ws> SmallHydro <ws> Wind <ws> Bio <ws> Solar <ws> LargeHydro <ws> Total`
// (state name followed by 6+ numeric columns). Wind is the 2nd number.
//
// For the annual PDF we scope to lines between "Table 8.2 RE cumulative
// installed capacity as on dd.mm.yyyy" and the next table/total marker
// to avoid catching nearby tables (e.g. 8.1 monthly addition). For the
// monthly PDF (no such header) we scan the full document — its layout
// is a single contiguous table.
function parseStateWindRows(text: string): Array<{ state: string; installed_mw: number }> {
  const lines = text.split('\n');

  // Try to bound by Table 8.2 anchor (annual PDF). Last occurrence wins —
  // the actual data table sits after the table-of-contents reference.
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/Table 8\.2 RE cumulative installed capacity as on \d{2}\.\d{2}\.\d{4}/i.test(lines[i] ?? '')) {
      start = i;
    }
  }
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (/^\s*Table 8\.3/i.test(line) || /^\s*Total\s+\d/i.test(line)) {
        end = i;
        break;
      }
    }
  } else {
    // No Table 8.2 anchor → monthly PDF. Scan the whole document.
    start = 0;
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

// Convert a "dd.mm.yyyy" stamp into a fiscal-year label like "2026-27".
// Indian FY runs Apr 1 → Mar 31, so an as-on of 30.04.2026 falls in
// FY 2026-27, but 31.03.2025 falls in FY 2024-25.
function fyFromAsOf(asOf: string): string {
  const m = asOf.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return 'unknown';
  const month = parseInt(m[2]!, 10);
  const year  = parseInt(m[3]!, 10);
  const startYear = month >= 4 ? year : year - 1;
  const endYY     = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}

// Parse the "Physical Achievements" HTML table on the landing page.
// The row of interest is:
//   <td>Wind Power</td>
//   <td>{monthAchievement}</td>
//   <td>{fyAchievement}</td>
//   <td>{cumulative}</td>          <-- this is what we want
// The cumulative-column header carries the as-on date:
//   <th …>Cumulative Achievements (as on DD.MM.YYYY)</th>
function parsePhysicalAchievementsTable(html: string): { installed_mw: number; asOf: string } | null {
  const asOfMatch = html.match(/Cumulative Achievements\s*\(as on\s*(\d{2}\.\d{2}\.\d{4})\)/i);
  const asOf      = asOfMatch && asOfMatch[1] ? asOfMatch[1] : null;

  // Wind Power row — tolerant of whitespace and minor markup variation.
  const rowMatch = html.match(
    /<td[^>]*>\s*Wind\s+Power\s*<\/td>\s*<td[^>]*>\s*([0-9.,]+)\s*<\/td>\s*<td[^>]*>\s*([0-9.,]+)\s*<\/td>\s*<td[^>]*>\s*([0-9.,]+)\s*<\/td>/i
  );
  if (!rowMatch || !rowMatch[3] || !asOf) return null;

  const cumulative = parseFloat(rowMatch[3].replace(/,/g, ''));
  if (!Number.isFinite(cumulative) || cumulative <= 0) return null;

  return { installed_mw: Math.round(cumulative), asOf };
}

async function fetchAndParse(): Promise<MnrePayload> {
  // 1. Pull the physical-progress landing page. It carries:
  //    - A "Physical Achievements" HTML table with the current Wind
  //      Power cumulative MW (PRIMARY — month-current national total).
  //    - A monthly "State wise RE Installed Capacity as on dd.mm.yyyy"
  //      PDF link (used for the state-wise breakdown).
  //    - An annual "RE-Statistics YYYY-YY" PDF (stale fallback).
  const progressRes = await politeFetch(PROGRESS_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  });
  if (!progressRes.ok) throw new Error(`physical-progress page HTTP ${progressRes.status}`);
  const html = await progressRes.text();

  // 2. PRIMARY: Physical Achievements table → national cumulative MW + as-on.
  const tableData = parsePhysicalAchievementsTable(html);
  if (!tableData) throw new Error('Physical Achievements table: Wind Power row or as-on date not found');
  const nationalInstalledMw = tableData.installed_mw;
  const asOf                = tableData.asOf;
  const fy                  = fyFromAsOf(asOf);

  // 3. Find the monthly PDF link for state-wise breakdown. The link's
  //    text is empty; the descriptive label sits in aria-label, e.g.
  //      <a href="…/202605111869474490.pdf"
  //         aria-label="State wise RE Installed Capacity as on 30.04.2026 …">
  //    Walk every <a …> opening tag, keep ones that point at a PDF
  //    AND carry the matching aria-label, regardless of attribute order.
  let pdfUrl: string | null = null;
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\.pdf/i.test(tag)) continue;
    const aria = tag.match(/aria-label="([^"]+)"/i);
    if (!aria || !aria[1]) continue;
    if (!/State[-\s]+wise\s+RE\s+Installed\s+Capacity\s+as\s+on/i.test(aria[1])) continue;
    const href = tag.match(/href="(https?:\/\/[^"]+\.pdf)"/i);
    if (!href || !href[1]) continue;
    pdfUrl = href[1];
    break;
  }
  // Fallback to annual RE-Statistics PDF if the monthly link is gone.
  if (!pdfUrl) {
    const annualMatch = html.match(
      /href="(https?:\/\/[^"]+\.pdf)"[^>]*>\s*RE[ -]Statistics\s*\d{4}-\d{2}/i
    );
    if (annualMatch && annualMatch[1]) pdfUrl = annualMatch[1];
  }

  // 4. Best-effort state-wise breakdown from PDF. We already have the
  //    national total from HTML, so a PDF failure isn't fatal.
  let stateCapacity: Array<{ state: string; installed_mw: number }> = [];
  let sourceUrl = PROGRESS_URL;
  if (pdfUrl) {
    sourceUrl = pdfUrl;
    try {
      const pdfRes = await politeFetch(pdfUrl);
      if (pdfRes.ok) {
        const pdfBuf = await pdfRes.arrayBuffer();
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: Buffer.from(pdfBuf) });
        const result = await parser.getText();
        const text   = typeof result === 'string'
          ? result
          : ((result as { text?: string }).text ?? '');
        stateCapacity = parseStateWindRows(text);
      }
    } catch {
      // Swallow — state-wise stays empty, national total still flows.
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    fy,
    sourceUrl,
    asOf,
    stateCapacity,
    capacity:  { installed_mw: nationalInstalledMw, target_fy_mw: TARGET_FY30_MW },
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
