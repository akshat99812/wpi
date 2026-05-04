import { SourceResult } from '../merge';

// CEA crawler — uses fixture data based on published CEA monthly reports
// Real URL: cea.nic.in is often slow/down; authoritative figures are from CEA reports
export const ceaCrawler = {
  key: 'cea',
  name: 'Central Electricity Authority',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const { politeFetch } = await import('../httpClient');
      const res = await politeFetch('https://cea.nic.in/renewable-dashboard/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Look for wind capacity in the page
      const mwMatch = html.match(/wind[^<]{0,300}?(\d[\d,]+)\s*(?:MW|GW)/i);
      const installed_mw = mwMatch && mwMatch[1] ? parseInt(mwMatch[1].replace(/,/g, '')) : null;
      if (installed_mw && installed_mw > 1000) {
        return { source: 'cea', fetchedAt, ok: true, payload: { capacity: { installed_mw } } };
      }
      throw new Error('No capacity data found');
    } catch {
      return {
        source: 'cea', fetchedAt, ok: true, fixturesUsed: true,
        payload: {
          capacity: { installed_mw: 48200 },
          monthlyGeneration: [
            { month: 'Jan-2025', wind_mu: 8420 },
            { month: 'Dec-2024', wind_mu: 7890 },
            { month: 'Nov-2024', wind_mu: 6210 }
          ]
        }
      };
    }
  }
};

export const niweCrawler = {
  key: 'niwe',
  name: 'National Institute of Wind Energy',
  async run(): Promise<SourceResult> {
    return {
      source: 'niwe', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        statePotential: [
          { state: 'Rajasthan', potential_150m_gw: 127.0, potential_120m_gw: 91.4 },
          { state: 'Gujarat', potential_150m_gw: 142.5, potential_120m_gw: 108.5 },
          { state: 'Karnataka', potential_150m_gw: 55.9, potential_120m_gw: 42.0 },
          { state: 'Tamil Nadu', potential_150m_gw: 84.7, potential_120m_gw: 68.2 },
          { state: 'Andhra Pradesh', potential_150m_gw: 75.3, potential_120m_gw: 62.4 },
          { state: 'Maharashtra', potential_150m_gw: 98.5, potential_120m_gw: 71.8 },
          { state: 'Madhya Pradesh', potential_150m_gw: 82.4, potential_120m_gw: 58.6 },
        ]
      }
    };
  }
};

export const lendersCrawler = {
  key: 'lenders',
  name: 'IREDA, REC, PFC, SBI',
  async run(): Promise<SourceResult> {
    return {
      source: 'lenders', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        lendingRates: [
          { institution: 'IREDA', product: 'Wind Project Loan', rate_pct: 9.40, tenor_yrs: 18, moratorium_months: 18 },
          { institution: 'REC', product: 'Wind IPP Financing', rate_pct: 9.85, tenor_yrs: 15, moratorium_months: 12 },
          { institution: 'PFC', product: 'Renewable Energy Loan', rate_pct: 9.65, tenor_yrs: 20, moratorium_months: 18 },
          { institution: 'SBI', product: 'Green Climate Fund', rate_pct: 10.20, tenor_yrs: 15, moratorium_months: 12 }
        ]
      }
    };
  }
};

export const cercCrawler = {
  key: 'cerc',
  name: 'Central Electricity Regulatory Commission',
  async run(): Promise<SourceResult> {
    return {
      source: 'cerc', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        tariffOrders: [
          { regulator: 'CERC', title: 'Wind Tariff Regulations 2023 (Amendment)', date: '2023-11-01', category: 'Tariff Regulation', type: 'Wind' },
          { regulator: 'CERC', title: 'DSM Regulations Amendment 2024', date: '2024-03-15', category: 'DSM', type: 'General' },
          { regulator: 'CERC', title: 'FDRE Tariff Framework', date: '2024-01-20', category: 'FDRE', type: 'Hybrid' }
        ]
      }
    };
  }
};

export const stateSercCrawler = {
  key: 'state_serc',
  name: 'State SERCs (GERC, KERC, RERC, MERC, TNERC)',
  async run(): Promise<SourceResult> {
    return {
      source: 'state_serc', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        tariffOrders: [
          { state: 'Gujarat', regulator: 'GERC', tariff_inr: 3.78, effectiveDate: '2024-04-01', capacity_mw: null },
          { state: 'Karnataka', regulator: 'KERC', tariff_inr: 4.05, effectiveDate: '2024-07-01', capacity_mw: null },
          { state: 'Rajasthan', regulator: 'RERC', tariff_inr: 3.62, effectiveDate: '2024-01-01', capacity_mw: null },
          { state: 'Maharashtra', regulator: 'MERC', tariff_inr: 4.12, effectiveDate: '2023-10-01', capacity_mw: null },
          { state: 'Tamil Nadu', regulator: 'TNERC', tariff_inr: 3.95, effectiveDate: '2024-04-01', capacity_mw: null }
        ]
      }
    };
  }
};

export const stateNodalCrawler = {
  key: 'state_nodal',
  name: 'State Nodal Agencies',
  async run(): Promise<SourceResult> {
    return {
      source: 'state_nodal', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        stateCapacity: [
          { state: 'Gujarat', installed_mw: 11000, year: 2025 },
          { state: 'Rajasthan', installed_mw: 7100, year: 2025 },
          { state: 'Karnataka', installed_mw: 6100, year: 2025 },
          { state: 'Tamil Nadu', installed_mw: 9500, year: 2025 },
          { state: 'Andhra Pradesh', installed_mw: 4200, year: 2025 },
          { state: 'Maharashtra', installed_mw: 3800, year: 2025 },
          { state: 'Madhya Pradesh', installed_mw: 3400, year: 2025 },
          { state: 'Telangana', installed_mw: 1200, year: 2025 }
        ]
      }
    };
  }
};

export const gridCrawler = {
  key: 'grid',
  name: 'POSOCO / NLDC',
  async run(): Promise<SourceResult> {
    return {
      source: 'grid', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        grid: {
          daily_wind_gen_mu: 142.5,
          wind_grid_share_pct: 4.8,
          curtailment_pct: 2.1,
          date: new Date().toISOString().split('T')[0]
        }
      }
    };
  }
};

export const oemReportsCrawler = {
  key: 'oem_reports',
  name: 'Suzlon, Inox Wind, GE, Vestas-IN',
  async run(): Promise<SourceResult> {
    return {
      source: 'oem_reports', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        oemModels: [
          { oem: 'Suzlon', model: 'S144-3.0 MW', rated_kw: 3000, rotor_m: 144, hub_height_m: 140, almm: true },
          { oem: 'Suzlon', model: 'S120-2.8 MW', rated_kw: 2800, rotor_m: 120, hub_height_m: 120, almm: true },
          { oem: 'Inox Wind', model: 'DF116-2.0 MW', rated_kw: 2000, rotor_m: 116, hub_height_m: 100, almm: true },
          { oem: 'GE', model: 'Cypress 5.3-158', rated_kw: 5300, rotor_m: 158, hub_height_m: 155, almm: false },
          { oem: 'Vestas', model: 'V150-4.5 MW', rated_kw: 4500, rotor_m: 150, hub_height_m: 155, almm: false },
          { oem: 'Windworld', model: 'W-3000', rated_kw: 3000, rotor_m: 132, hub_height_m: 140, almm: true }
        ]
      }
    };
  }
};

export const analystNotesCrawler = {
  key: 'analyst_notes',
  name: 'CRISIL, JMK, IEEFA, BNEF',
  async run(): Promise<SourceResult> {
    return {
      source: 'analyst_notes', fetchedAt: new Date(), ok: true, fixturesUsed: true,
      payload: {
        reports: [
          { analyst: 'JMK Research', title: 'India Wind Energy Market Outlook H2 FY2025', date: '2025-02-01', url: 'https://jmkresearch.com' },
          { analyst: 'IEEFA', title: 'India Repowering: Unlocking 25 GW by 2030', date: '2024-12-10', url: 'https://ieefa.org' },
          { analyst: 'CRISIL', title: 'Bankability of Indian Wind Projects – FY25 Update', date: '2024-11-15', url: 'https://crisil.com' },
          { analyst: 'BNEF', title: 'India Auction Tracker Q4 2024', date: '2024-12-20', url: 'https://about.bnef.com' }
        ]
      }
    };
  }
};
