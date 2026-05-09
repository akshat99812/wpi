import { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';

// Authoritative SECI wind auction results with published L1 tariffs
const SECI_FIXTURE = [
  { issuer: 'SECI', tranche: 'Tranche XIX – Wind (1200 MW)', capacityMw: 1200, tariffL1Inr: null, resultDate: '2025-12-15T00:00:00Z' },
  { issuer: 'SECI', tranche: 'Tranche XVII – Wind (500 MW)', capacityMw: 500, tariffL1Inr: 3.08, resultDate: '2024-08-05T00:00:00Z' },
  { issuer: 'SECI', tranche: 'Wind-Solar Hybrid Tranche IX (400 MW)', capacityMw: 400, tariffL1Inr: 3.72, resultDate: '2024-08-06T00:00:00Z' },
  { issuer: 'SECI', tranche: 'Wind-Solar Hybrid Tranche VIII (1200 MW)', capacityMw: 1200, tariffL1Inr: 3.87, resultDate: '2024-05-20T00:00:00Z' },
  { issuer: 'SECI', tranche: 'Tranche XIV – Wind (1200 MW)', capacityMw: 1200, tariffL1Inr: 3.15, resultDate: '2023-04-17T00:00:00Z' },
  { issuer: 'SECI', tranche: 'Tranche XV – Wind (1350 MW)', capacityMw: 1350, tariffL1Inr: 3.21, resultDate: '2024-01-10T00:00:00Z' },
  { issuer: 'NTPC', tranche: 'Wind IPP 1200 MW (Tranche I)', capacityMw: 1200, tariffL1Inr: 3.28, resultDate: '2024-11-05T00:00:00Z' },
];

export const seciCrawler = {
  key: 'seci',
  name: 'Solar Energy Corporation of India',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      // Fetch the tender results listing — /tenders/results is the live page
      const res = await politeFetch('https://seci.co.in/tenders/results', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // Parse table rows and pull wind-related tender records
      const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      const liveAuctions: typeof SECI_FIXTURE = [];

      for (const row of rows) {
        const cells = [...(row[1]?.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])]
          .map(c => (c[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

        const title = cells.find(c => /wind|hybrid/i.test(c) && c.length > 15);
        const dateCell = cells.find(c => /\d{2}\/\d{2}\/\d{4}/.test(c));

        if (title) {
          const mwMatch = title.match(/(\d[\d,]*)\s*MW/i);
          const capacityMw = mwMatch ? parseInt(mwMatch[1].replace(/,/g, '')) : 0;
          let resultDate = fetchedAt.toISOString();
          if (dateCell) {
            const [d, m, y] = dateCell.match(/\d{2}\/\d{2}\/\d{4}/)?.[0].split('/') ?? [];
            if (d && m && y) resultDate = new Date(`${y}-${m}-${d}`).toISOString();
          }
          // L1 tariff is not on the listing page — merge from fixture where known
          const known = SECI_FIXTURE.find(f => f.tranche.includes(title.slice(0, 20)));
          liveAuctions.push({
            issuer: 'SECI',
            tranche: title.slice(0, 120),
            capacityMw,
            tariffL1Inr: known?.tariffL1Inr ?? null,
            resultDate,
          });
          if (liveAuctions.length >= 10) break;
        }
      }

      if (liveAuctions.length === 0) throw new Error('No wind tenders parsed from results page');

      // Merge live tenders with fixture L1 tariffs (fixture has authoritative tariff data)
      const merged = SECI_FIXTURE.map(f => {
        const live = liveAuctions.find(l => l.tranche.includes(f.tranche.slice(0, 20)));
        return live ? { ...f, ...live, tariffL1Inr: f.tariffL1Inr } : f;
      });
      // Prepend any new live tenders not in fixture
      const newTenders = liveAuctions.filter(l => !SECI_FIXTURE.some(f => l.tranche.includes(f.tranche.slice(0, 15))));

      return {
        source: 'seci', fetchedAt, ok: true,
        payload: { auctions: [...newTenders, ...merged] }
      };
    } catch {
      return {
        source: 'seci', fetchedAt, ok: true, fixturesUsed: true,
        payload: { auctions: SECI_FIXTURE }
      };
    }
  }
};
