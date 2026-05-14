/**
 * Additional Indian wind / renewable news crawlers.
 *
 * Each crawler hits a public RSS feed, filters to wind-relevant items
 * (turbine / offshore / repowering / OEM names / NIWE / FDRE / WTG),
 * normalises into the bundle `news` shape, and falls back to a small
 * fixture when the upstream feed is unreachable or returns no wind items.
 */
import type { SourceResult } from '../merge';
import { politeFetch, parseRssItems } from '../httpClient';

const WIND_RE = /wind|turbine|\bwtg\b|offshore|repower|niwe|fdre|suzlon|inox|gamesa|vestas|nordex|envision|gwec|senvion|jsw\s*energy|adani\s*green|renew\s*power|serentica|ayana/i;

type NewsItem = {
  headline: string;
  url: string;
  publishedAt: string;
  source: string;
  summary?: string;
};

function buildNewsItems(
  xml: string,
  sourceLabel: string,
  windFilter = true,
  limit = 12,
): NewsItem[] {
  const items = parseRssItems(xml);
  if (items.length === 0) return [];
  const filtered = windFilter
    ? items.filter(i => WIND_RE.test(`${i.title} ${i.description ?? ''}`))
    : items;
  const sorted = windFilter ? [...filtered] : filtered;
  return sorted.slice(0, limit).map(i => ({
    headline: i.title,
    url: i.link,
    publishedAt: new Date(i.pubDate).toISOString(),
    source: sourceLabel,
    summary: i.description,
  }));
}

// ── 1. Saur Energy India ──────────────────────────────────────────────────
const SAUR_FIXTURE: NewsItem[] = [
  { headline: 'India Adds 4.5 GW of Wind Capacity in FY25 — Highest Ever', url: 'https://www.saurenergy.com/wind-energy/india-wind-fy25-record', publishedAt: '2025-04-10T00:00:00Z', source: 'Saur Energy', summary: 'FY25 wind additions cross 4.5 GW, highest in a single fiscal' },
  { headline: 'Suzlon Q4 Order Book Crosses 5.5 GW with Fresh NTPC Contracts', url: 'https://www.saurenergy.com/wind-energy/suzlon-order-book-ntpc', publishedAt: '2025-03-28T00:00:00Z', source: 'Saur Energy', summary: 'Suzlon Energy adds 504 MW NTPC REL order to growing pipeline' },
  { headline: 'Inox Wind Bags 200 MW Repowering Order from Adani Green', url: 'https://www.saurenergy.com/wind-energy/inox-200mw-repowering-adani', publishedAt: '2025-03-15T00:00:00Z', source: 'Saur Energy', summary: 'Major repowering deal for Inox Wind under MNRE 2023 policy' },
  { headline: 'MNRE Notifies Revised Offshore Wind VGF Framework', url: 'https://www.saurenergy.com/wind-energy/mnre-offshore-vgf-framework', publishedAt: '2025-02-22T00:00:00Z', source: 'Saur Energy', summary: 'Revised VGF caps and bid timelines for Gulf of Kutch and TN zones' },
];

export const saurEnergyCrawler = {
  key: 'saur_energy',
  name: 'Saur Energy India',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://www.saurenergy.com/feed');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const news = buildNewsItems(xml, 'Saur Energy');
      if (news.length === 0) throw new Error('No wind items in feed');
      return { source: 'saur_energy', fetchedAt, ok: true, payload: { news } };
    } catch {
      return { source: 'saur_energy', fetchedAt, ok: true, fixturesUsed: true, payload: { news: SAUR_FIXTURE } };
    }
  },
};

// ── 2. ETEnergyWorld (Renewables) ─────────────────────────────────────────
const ET_FIXTURE: NewsItem[] = [
  { headline: 'Wind Power Tariffs Hit ₹3.18/kWh in SECI Tranche XIII', url: 'https://energy.economictimes.indiatimes.com/news/renewable/seci-tranche-xiii-wind-tariff', publishedAt: '2025-04-02T00:00:00Z', source: 'ETEnergyWorld', summary: 'SECI Tranche XIII closes at ₹3.18/kWh L1 for 1,200 MW ISTS wind' },
  { headline: 'NTPC REL to Float 900 MW Wind Bid for Anantapur Cluster', url: 'https://energy.economictimes.indiatimes.com/news/renewable/ntpc-rel-900mw-wind-anantapur', publishedAt: '2025-03-18T00:00:00Z', source: 'ETEnergyWorld', summary: 'NTPC Renewables targets Anantapur ISTS wind cluster, BoS bids invited' },
  { headline: 'GE Vernova Eyes India Wind Re-entry with 6 MW Onshore Platform', url: 'https://energy.economictimes.indiatimes.com/news/renewable/ge-vernova-india-wind-reentry', publishedAt: '2025-03-04T00:00:00Z', source: 'ETEnergyWorld', summary: 'Global OEM signals comeback to India wind market with high-rated turbine' },
  { headline: 'Gujarat to Hold 1 GW Offshore Wind Auction in Q1 FY26', url: 'https://energy.economictimes.indiatimes.com/news/renewable/gujarat-offshore-wind-auction', publishedAt: '2025-02-12T00:00:00Z', source: 'ETEnergyWorld', summary: 'Gulf of Kutch offshore wind zone goes to auction with VGF support' },
];

export const etEnergyWorldCrawler = {
  key: 'et_energyworld',
  name: 'ETEnergyWorld (Renewables)',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://energy.economictimes.indiatimes.com/rss/topstories', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const news = buildNewsItems(xml, 'ETEnergyWorld');
      if (news.length === 0) throw new Error('No wind items in feed');
      return { source: 'et_energyworld', fetchedAt, ok: true, payload: { news } };
    } catch {
      return { source: 'et_energyworld', fetchedAt, ok: true, fixturesUsed: true, payload: { news: ET_FIXTURE } };
    }
  },
};

// ── 3. PV Magazine India ──────────────────────────────────────────────────
// PV Magazine India is primarily solar but regularly covers hybrid &
// wind+storage auctions, FDRE bids, and OEM moves relevant to wind.
const PVMAG_FIXTURE: NewsItem[] = [
  { headline: 'SECI 1,200 MW Wind-Solar Hybrid Auction Closes at ₹3.39/kWh', url: 'https://www.pv-magazine-india.com/2025/03/seci-wind-solar-hybrid-auction', publishedAt: '2025-03-22T00:00:00Z', source: 'PV Magazine India', summary: 'Wind-solar hybrid round attracts JSW, ReNew, Adani at competitive L1' },
  { headline: 'India FDRE Pipeline Crosses 7 GW with Wind-BESS Awards', url: 'https://www.pv-magazine-india.com/2025/02/india-fdre-pipeline-7gw', publishedAt: '2025-02-25T00:00:00Z', source: 'PV Magazine India', summary: 'FDRE auctions cumulatively cross 7 GW of contracted capacity' },
  { headline: 'Tamil Nadu Plans Dhanushkodi 500 MW Offshore Wind Auction', url: 'https://www.pv-magazine-india.com/2025/02/tn-dhanushkodi-offshore-wind', publishedAt: '2025-02-08T00:00:00Z', source: 'PV Magazine India', summary: 'Tamil Nadu coast offshore wind zone activated for SECI VGF bid' },
];

export const pvMagazineCrawler = {
  key: 'pv_magazine',
  name: 'PV Magazine India',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://www.pv-magazine-india.com/feed/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const news = buildNewsItems(xml, 'PV Magazine India');
      if (news.length === 0) throw new Error('No wind items in feed');
      return { source: 'pv_magazine', fetchedAt, ok: true, payload: { news } };
    } catch {
      return { source: 'pv_magazine', fetchedAt, ok: true, fixturesUsed: true, payload: { news: PVMAG_FIXTURE } };
    }
  },
};

// ── 4. EQ International (eqmagpro) ────────────────────────────────────────
const EQ_FIXTURE: NewsItem[] = [
  { headline: 'India Wind Installed Capacity Touches 49.5 GW at FY25 Close', url: 'https://www.eqmagpro.com/india-wind-49gw-fy25', publishedAt: '2025-04-05T00:00:00Z', source: 'EQ Magazine', summary: 'India wind fleet reaches new high; Gujarat, TN, Karnataka lead additions' },
  { headline: 'Vestas Reopens Chennai Nacelle Plant after 2-Year Pause', url: 'https://www.eqmagpro.com/vestas-chennai-restart', publishedAt: '2025-03-12T00:00:00Z', source: 'EQ Magazine', summary: 'Vestas resumes Indian wind nacelle manufacturing at Chennai facility' },
  { headline: 'GWEC: India Tops APAC Wind Additions for Second Year', url: 'https://www.eqmagpro.com/gwec-india-apac-wind-additions', publishedAt: '2025-02-28T00:00:00Z', source: 'EQ Magazine', summary: 'Global Wind Energy Council report ranks India #1 in APAC additions' },
];

export const eqMagazineCrawler = {
  key: 'eq_magazine',
  name: 'EQ International Magazine',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://www.eqmagpro.com/feed/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const news = buildNewsItems(xml, 'EQ Magazine');
      if (news.length === 0) throw new Error('No wind items in feed');
      return { source: 'eq_magazine', fetchedAt, ok: true, payload: { news } };
    } catch {
      return { source: 'eq_magazine', fetchedAt, ok: true, fixturesUsed: true, payload: { news: EQ_FIXTURE } };
    }
  },
};

// ── 5. Business Standard (Energy / Renewables vertical) ───────────────────
const BS_FIXTURE: NewsItem[] = [
  { headline: 'Wind Power: India Targets 100 GW Installed by FY32', url: 'https://www.business-standard.com/industry/news/india-wind-100gw-fy32', publishedAt: '2025-04-08T00:00:00Z', source: 'Business Standard', summary: 'MNRE roadmap pegs wind contribution at 100 GW under 500 GW RE goal' },
  { headline: 'JSW Energy to Invest ₹15,000 Cr in Wind-BESS Hybrid Build-out', url: 'https://www.business-standard.com/companies/news/jsw-energy-wind-bess-investment', publishedAt: '2025-03-20T00:00:00Z', source: 'Business Standard', summary: 'JSW Energy capex plan focuses on wind-storage hybrid projects' },
  { headline: 'PGCIL to Bid Out ₹13,000 Cr Offshore Wind Transmission Line', url: 'https://www.business-standard.com/industry/news/pgcil-offshore-wind-transmission', publishedAt: '2025-03-01T00:00:00Z', source: 'Business Standard', summary: 'PGCIL undersea cable tender for Gulf of Kutch offshore wind zone' },
];

export const businessStandardCrawler = {
  key: 'business_standard',
  name: 'Business Standard (Energy)',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://www.business-standard.com/rss/industry-216.rss', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const news = buildNewsItems(xml, 'Business Standard');
      if (news.length === 0) throw new Error('No wind items in feed');
      return { source: 'business_standard', fetchedAt, ok: true, payload: { news } };
    } catch {
      return { source: 'business_standard', fetchedAt, ok: true, fixturesUsed: true, payload: { news: BS_FIXTURE } };
    }
  },
};
