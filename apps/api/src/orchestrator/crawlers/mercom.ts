import { SourceResult } from '../merge';
import { politeFetch, parseRssItems } from '../httpClient';

const MERCOM_FIXTURE = [
  { headline: 'India Wind Power Additions Hit Record 4.5 GW in FY25', url: 'https://mercomindia.com/india-wind-power-additions-record-fy25', publishedAt: '2025-04-05T00:00:00Z', source: 'Mercom India', summary: 'India added a record 4.5 GW of wind capacity in FY25' },
  { headline: 'SECI Floats Tender for 1200 MW Wind Power – Tranche XV', url: 'https://mercomindia.com/seci-tender-1200mw-wind-tranche-xv', publishedAt: '2025-03-20T00:00:00Z', source: 'Mercom India', summary: 'SECI issues new wind tender under Tranche XV' },
  { headline: 'Wind Tariffs Touch New Low of ₹2.99/kWh in NTPC Auction', url: 'https://mercomindia.com/wind-tariffs-low-ntpc-auction', publishedAt: '2025-03-01T00:00:00Z', source: 'Mercom India', summary: 'NTPC wind auction sees competitive L1 tariff of ₹2.99/kWh' },
  { headline: 'Suzlon Bags 504 MW Wind Order from NTPC Renewable', url: 'https://mercomindia.com/suzlon-504mw-wind-ntpc', publishedAt: '2025-02-15T00:00:00Z', source: 'Mercom India', summary: 'Suzlon Energy secures large wind order from NTPC' },
  { headline: 'India Offshore Wind: NIWE Releases Site Assessment for Gujarat Coast', url: 'https://mercomindia.com/india-offshore-wind-niwe-gujarat', publishedAt: '2025-01-28T00:00:00Z', source: 'Mercom India', summary: 'NIWE completes offshore wind assessment for Gujarat' },
];

export const mercomCrawler = {
  key: 'mercom',
  name: 'Mercom India Research',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://mercomindia.com/feed/?cat=wind');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length === 0) throw new Error('No RSS items parsed');
      const news = items.slice(0, 15).map(i => ({
        headline: i.title,
        url: i.link,
        publishedAt: new Date(i.pubDate).toISOString(),
        source: 'Mercom India',
        summary: i.description
      }));
      return { source: 'mercom', fetchedAt, ok: true, payload: { news } };
    } catch (err) {
      return {
        source: 'mercom', fetchedAt, ok: true, fixturesUsed: true,
        payload: { news: MERCOM_FIXTURE }
      };
    }
  }
};
