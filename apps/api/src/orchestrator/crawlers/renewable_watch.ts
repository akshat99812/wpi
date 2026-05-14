import type { SourceResult } from '../merge';
import { politeFetch, parseRssItems } from '../httpClient';

const RW_FIXTURE = [
  { headline: 'Wind Energy Capacity in India Crosses 48 GW Mark', url: 'https://renewablewatch.in/wind-energy-capacity-india-48gw', publishedAt: '2025-03-15T00:00:00Z', source: 'Renewable Watch', summary: 'India crosses 48 GW installed wind energy capacity milestone' },
  { headline: 'Repowering of Old Wind Turbines: Policy and Opportunities', url: 'https://renewablewatch.in/repowering-old-wind-turbines-india', publishedAt: '2025-02-20T00:00:00Z', source: 'Renewable Watch', summary: 'Analysis of repowering potential and policy framework' },
  { headline: 'Gujarat Leads Wind Energy Addition with 3.2 GW in FY25', url: 'https://renewablewatch.in/gujarat-wind-energy-fy25', publishedAt: '2025-02-01T00:00:00Z', source: 'Renewable Watch', summary: 'Gujarat tops state-wise wind capacity addition in FY2025' },
  { headline: 'FDRE Projects: Combining Wind, Solar & Storage for Grid Stability', url: 'https://renewablewatch.in/fdre-wind-solar-storage', publishedAt: '2025-01-15T00:00:00Z', source: 'Renewable Watch', summary: 'FDRE project structures gaining traction in India wind sector' },
  { headline: 'Wind OEMs in India: Suzlon, Inox Lead Domestic Market Share', url: 'https://renewablewatch.in/wind-oem-india-market-share', publishedAt: '2024-12-10T00:00:00Z', source: 'Renewable Watch', summary: 'OEM landscape analysis for Indian wind turbine market' },
];

// Wind tariff data points reported in Renewable Watch features & trackers.
// Includes one MPERC petition entry (regulator-attributed) — Renewable Watch
// is the discovery channel even when the originating body is a state SERC.
const RW_TARIFFS = [
  {
    state: 'Rajasthan',      regulator: 'Renewable Watch', dateLabel: '2025', effectiveDate: '2025-04-01',
    title: 'Suzlon–Yanara 153 MW FDRE (Barmer)',
    tariffLabel: 'Bilateral PPA (not disclosed)',
    meta:  'Yanara Energy (offtaker) · 153 MW',
    category: 'FDRE', url: 'https://renewablewatch.in/',
  },
  {
    state: 'Madhya Pradesh', regulator: 'MPERC',           dateLabel: '2025', effectiveDate: '2025-05-01',
    title: 'MPERC Petition 22/2025 — wind-related order',
    tariffLabel: 'Generic wind tariff — see order',
    meta:  'MPPMCL regulated procurement · —',
    category: 'Generic Tariff', url: 'https://mperc.in/',
  },
];

export const renewableWatchCrawler = {
  key: 'renewable_watch',
  name: 'Renewable Watch',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://renewablewatch.in/feed/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length === 0) throw new Error('No RSS items parsed');
      // Sort wind articles first, then fill with other renewable news up to 10
      const windItems = items.filter(i => /wind/i.test(i.title + (i.description ?? '')));
      const others = items.filter(i => !/wind/i.test(i.title + (i.description ?? '')));
      const sorted = [...windItems, ...others].slice(0, 10);
      const news = sorted.map(i => ({
        headline: i.title,
        url: i.link,
        publishedAt: new Date(i.pubDate).toISOString(),
        source: 'Renewable Watch',
        summary: i.description
      }));
      return {
        source: 'renewable_watch', fetchedAt, ok: true,
        payload: { news, tariffOrders: RW_TARIFFS }
      };
    } catch (err) {
      return {
        source: 'renewable_watch', fetchedAt, ok: true, fixturesUsed: true,
        payload: { news: RW_FIXTURE, tariffOrders: RW_TARIFFS }
      };
    }
  }
};
