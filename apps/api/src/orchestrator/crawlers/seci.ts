/**
 * SECI crawler — scrapes the live `/tenders/results` listing page and
 * derives both `auctions` and `tariffOrders` from the same HTML.
 *
 * The SECI listing does NOT publish awarded L1 tariffs (those land later
 * in PDFs / press releases), so tariffOrders entries for open tenders
 * show `Tariff TBD (bid due <date>)` — matching the same UI shape used
 * by upcoming-tender rows elsewhere in the Tariffs tab.
 *
 * Nothing in this module is hardcoded auction data. If the listing fetch
 * fails or yields zero wind-relevant rows, the crawler returns an empty
 * payload and is flagged `fixturesUsed: true` so the source-status panel
 * can surface the failure.
 */
import { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';

const SECI_LISTING = 'https://www.seci.co.in/tenders/results';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const KNOWN_STATES = [
  'Andhra Pradesh', 'Gujarat', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana',
  'Uttar Pradesh', 'West Bengal', 'Himachal Pradesh', 'Haryana',
];

type SeciRow = {
  tenderId:   string;
  refNo:      string;
  title:      string;
  capacityMw: number;
  pubDate:    string | null; // ISO yyyy-mm-dd
  bidDate:    string | null;
  url:        string;
};

type Auction = {
  issuer:       string;
  tranche:      string;
  capacityMw:   number;
  tariffL1Inr:  number | null;
  resultDate:   string;
};

type TariffOrder = {
  state?:         string;
  regulator:      string;
  dateLabel:      string;
  effectiveDate:  string;
  title:          string;
  tariffLabel:    string;
  meta:           string;
  category:       string;
  url:            string;
};

// ── Wind / hybrid / FDRE / RTC tenders are in scope; pure solar / BESS /
// ── corporate-admin tenders (PR agencies, insurance) are excluded.
function isWindRelevantTender(title: string): boolean {
  const t = title.toLowerCase();
  if (/\bwind\b/.test(t)) return true;
  if (/\b(hybrid|fdre|rtc|round[- ]the[- ]clock)\b/.test(t)) return true;
  return false;
}

function detectState(title: string): string | undefined {
  for (const s of KNOWN_STATES) {
    const re = new RegExp(`\\bin\\s+${s.replace(' ', '\\s+')}\\b`, 'i');
    if (re.test(title)) return s;
  }
  // Common naming patterns for offshore wind tenders.
  if (/gulf\s+of\s+kutch/i.test(title))   return 'Gujarat';
  if (/dhanushkodi|gulf\s+of\s+mannar/i.test(title)) return 'Tamil Nadu';
  return undefined;
}

function categorise(title: string): string {
  const t = title.toLowerCase();
  if (/offshore/.test(t))               return 'Offshore Wind';
  if (/repower/.test(t))                return 'Repowering';
  if (/fdre/.test(t))                   return 'FDRE';
  if (/rtc|round[- ]the[- ]clock/.test(t)) return 'RTC';
  if (/hybrid/.test(t))                 return 'Wind-Solar Hybrid';
  return 'Wind Auction';
}

function parseSeciRow(rowHtml: string): SeciRow | null {
  // Strip HTML comments first — SECI's markup has commented-out cells
  // (<!-- <td>...</td> -->) that otherwise inject phantom cell content.
  const clean = rowHtml.replace(/<!--[\s\S]*?-->/g, '');
  const cells = [...clean.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => (m[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  if (cells.length < 6) return null;

  // The title is the longest free-text cell. Refs are typically <40 chars,
  // dates are 10 chars, "View Details" is 12 — titles are 50+. Picking
  // longest sidesteps any column shuffle on the SECI side.
  const title = cells
    .filter(c => c.length > 30 && !/^\d{2}\/\d{2}\/\d{4}$/.test(c))
    .sort((a, b) => b.length - a.length)[0] ?? '';
  if (!title || !isWindRelevantTender(title)) return null;

  const mw = title.match(/(\d[\d,]*)\s*MW/i);
  const capacityMw = mw && mw[1] ? parseInt(mw[1].replace(/,/g, ''), 10) : 0;

  // SECI uses data-order="yyyy-mm-dd" on each date cell — two per row,
  // first is publication date, second is bid submission date.
  const dateOrders = [...rowHtml.matchAll(/data-order="(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]);
  const pubDate = dateOrders[0] ?? null;
  const bidDate = dateOrders[1] ?? null;

  const link = rowHtml.match(/href="(\/tender-details\/[^"]+)"/);
  const url = link && link[1]
    ? `https://www.seci.co.in${link[1]}`
    : SECI_LISTING;

  // Pull the SECI tender ID (SECIxxxxxx pattern) and ref no
  // (SECI/C&P/... pattern) from cells without assuming positions.
  const tenderId = cells.find(c => /^SECI\d{6,}$/.test(c)) ?? '';
  const refNo    = cells.find(c => /^SECI\/[A-Z&]+\//i.test(c)) ?? '';

  return { tenderId, refNo, title, capacityMw, pubDate, bidDate, url };
}

function formatMonthYear(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function toAuction(row: SeciRow): Auction {
  const resultDate = (row.bidDate ?? row.pubDate ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z';
  return {
    issuer:      'SECI',
    tranche:     row.title.slice(0, 200),
    capacityMw:  row.capacityMw,
    tariffL1Inr: null,
    resultDate,
  };
}

function toTariffOrder(row: SeciRow): TariffOrder {
  const dateRef = row.bidDate ?? row.pubDate;
  const dateLabel = formatMonthYear(dateRef);
  const effectiveDate = dateRef ?? new Date().toISOString().slice(0, 10);
  const state = detectState(row.title);

  return {
    state,
    regulator:     'SECI',
    dateLabel,
    effectiveDate,
    title:         row.title,
    tariffLabel:   `Tariff TBD (bid due ${dateLabel})`,
    meta:          row.capacityMw
      ? `Bid due ${dateLabel} · ${row.capacityMw.toLocaleString('en-IN')} MW`
      : `Bid due ${dateLabel}`,
    category:      categorise(row.title),
    url:           row.url,
  };
}

export const seciCrawler = {
  key: 'seci',
  name: 'Solar Energy Corporation of India',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch(SECI_LISTING, { headers: { 'User-Agent': BROWSER_UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // Scope to the #tender-list table body so we don't accidentally
      // pick up rows from header/navigation/footer tables.
      const tableMatch = html.match(/<table[^>]*id="tender-list"[\s\S]*?<\/table>/i);
      const scope = tableMatch ? tableMatch[0] : html;

      const rows = [...scope.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(r => parseSeciRow(r[0]))
        .filter((r): r is SeciRow => r !== null);

      if (rows.length === 0) throw new Error('No wind-relevant tenders in SECI listing');

      // Dedupe by tender ID, then by ref no., then by title — SECI sometimes
      // republishes a tender under a corrigendum and we don't want both.
      const seen = new Set<string>();
      const unique = rows.filter(r => {
        const k = r.tenderId || r.refNo || r.title.slice(0, 60);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const auctions     = unique.map(toAuction);
      const tariffOrders = unique.map(toTariffOrder);

      return {
        source: 'seci',
        fetchedAt,
        ok: true,
        payload: { auctions, tariffOrders },
      };
    } catch (err) {
      return {
        source: 'seci',
        fetchedAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        fixturesUsed: true,
        payload: { auctions: [], tariffOrders: [] },
      };
    }
  },
};
