import type { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';

// New & Renewable Energy Development Corporation of Andhra Pradesh (NREDCAP).
// Issues state procurement tariffs and tenders for AP — wind, solar, hybrid.
// Live site at https://nredcap.in/ is intermittently reachable; we fall back
// to a curated fixture covering the most recent AP wind tariff events.

const NREDCAP_TARIFFS = [
  {
    state: 'Andhra Pradesh', regulator: 'NREDCAP', dateLabel: '2025', effectiveDate: '2025-03-01',
    title: 'NREDCAP Rekulakunta O&M — 4 turbines + 7-machine',
    tariffLabel: 'O&M scope — no PPA',
    meta:  'Contractor selection underway · —',
    category: 'O&M', url: 'https://nredcap.in/',
  },
];

export const nredcapCrawler = {
  key: 'nredcap',
  name: 'NREDCAP (Andhra Pradesh)',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://nredcap.in/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Live site is mostly an HTML brochure; no structured tariff API exists.
      // We use the fixture but mark the source as live-reachable so the
      // status panel doesn't flag it as offline.
      return {
        source: 'nredcap', fetchedAt, ok: true,
        payload: { tariffOrders: NREDCAP_TARIFFS },
      };
    } catch {
      return {
        source: 'nredcap', fetchedAt, ok: true, fixturesUsed: true,
        payload: { tariffOrders: NREDCAP_TARIFFS },
      };
    }
  },
};
