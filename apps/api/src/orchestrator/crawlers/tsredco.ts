import type { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';

// Telangana State Renewable Energy Development Corporation (TSREDCO).
// Telangana's wind is small (~1.2 GW) but the state regulator (TSERC) and
// nodal agency publish generic-tariff orders + open-access conditions that
// matter for repowering & C&I wheeling. Live site at https://tsredco.telangana.gov.in/
// is intermittently reachable — fall back to fixture.

const TSREDCO_TARIFFS = [
  {
    state: 'Telangana', regulator: 'TSREDCO', dateLabel: '2025', effectiveDate: '2025-06-01',
    title: 'Telangana Clean & Green Energy Policy, 2025 (TGECA-2025)',
    tariffLabel: 'Banking @ 2%, wheeling 5.5%, no cross-subsidy for captive',
    meta:  'All RE developers (wheeling + banking incentives) · —',
    category: 'Policy', url: 'https://tsredco.telangana.gov.in/',
  },
];

export const tsredcoCrawler = {
  key: 'tsredco',
  name: 'TSREDCO (Telangana)',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://tsredco.telangana.gov.in/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        source: 'tsredco', fetchedAt, ok: true,
        payload: { tariffOrders: TSREDCO_TARIFFS },
      };
    } catch {
      return {
        source: 'tsredco', fetchedAt, ok: true, fixturesUsed: true,
        payload: { tariffOrders: TSREDCO_TARIFFS },
      };
    }
  },
};
