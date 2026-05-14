import type { SourceResult } from '../merge';
import { politeFetch, parseRssItems } from '../httpClient';

// SolarQuarter covers solar AND wind auctions in India. We pull the RSS
// feed for news, plus an explicit tariff fixture so the Tariffs tab has
// SolarQuarter-attributed entries even when the live feed is unreachable.
const SQ_NEWS_FIXTURE = [
  { headline: 'India Wind Auctions: A Pricing Tracker for FY26', url: 'https://solarquarter.com/india-wind-auctions-fy26', publishedAt: '2025-04-10T00:00:00Z', source: 'SolarQuarter', summary: 'Pricing tracker for FY26 wind auctions across SECI, GUVNL, MSEDCL.' },
  { headline: 'SECI XVII Wind: 500 MW awarded at ₹3.08/kWh',     url: 'https://solarquarter.com/seci-xvii-wind-3-08',     publishedAt: '2024-08-06T00:00:00Z', source: 'SolarQuarter', summary: 'SECI ISTS Wind Tranche XVII concludes at ₹3.08/kWh L1.' },
];

const SQ_TARIFFS = [
  {
    state: 'Tamil Nadu', regulator: 'SolarQuarter', dateLabel: 'Nov 2025', effectiveDate: '2025-11-01',
    title: 'TNGECL 34.75 MW Wind-Solar Hybrid (Kayathar, Muppandal, Puliyankulam)',
    tariffLabel: 'Tariff TBD',
    meta:  'Bid under evaluation · 34.75 MW',
    category: 'Hybrid', url: 'https://solarquarter.com/',
  },
];

export const solarQuarterCrawler = {
  key: 'solarquarter',
  name: 'SolarQuarter',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://solarquarter.com/feed/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length === 0) throw new Error('No RSS items parsed');
      const windOnly = items
        .filter(i => /wind|FDRE|hybrid|auction/i.test(i.title + (i.description ?? '')))
        .slice(0, 10);
      const news = windOnly.map(i => ({
        headline: i.title,
        url: i.link,
        publishedAt: new Date(i.pubDate).toISOString(),
        source: 'SolarQuarter',
        summary: i.description,
      }));
      return {
        source: 'solarquarter', fetchedAt, ok: true,
        payload: { news, tariffOrders: SQ_TARIFFS },
      };
    } catch {
      return {
        source: 'solarquarter', fetchedAt, ok: true, fixturesUsed: true,
        payload: { news: SQ_NEWS_FIXTURE, tariffOrders: SQ_TARIFFS },
      };
    }
  },
};
