import { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __niwe_filename = fileURLToPath(import.meta.url);
const __niwe_dirname  = dirname(__niwe_filename);

const CEA_FIXTURE = {
  capacity: { installed_mw: 48200 },
  monthlyGeneration: [
    { month: 'Jan-2025', wind_mu: 8420 },
    { month: 'Dec-2024', wind_mu: 7890 },
    { month: 'Nov-2024', wind_mu: 6210 },
    { month: 'Oct-2024', wind_mu: 5840 },
    { month: 'Sep-2024', wind_mu: 7120 },
    { month: 'Aug-2024', wind_mu: 9340 },
  ]
};

// CEA (cea.nic.in) is frequently unreachable — try multiple URLs before falling back to fixture
export const ceaCrawler = {
  key: 'cea',
  name: 'Central Electricity Authority',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const { politeFetch } = await import('../httpClient');
      // Try multiple CEA URL paths; the site is frequently down/slow
      const urlsToTry = [
        'https://cea.nic.in/renewable-dashboard/',
        'https://cea.nic.in/report/?lang=en',
        'https://cea.nic.in/',
      ];
      let html = '';
      for (const url of urlsToTry) {
        try {
          const res = await politeFetch(url);
          if (res.ok) { html = await res.text(); break; }
        } catch { continue; }
      }
      if (!html) throw new Error('All CEA URLs failed');
      const mwMatch = html.match(/wind[^<]{0,300}?(\d[\d,]+)\s*(?:MW|GW)/i);
      const installed_mw = mwMatch?.[1] ? parseInt(mwMatch[1].replace(/,/g, '')) : null;
      if (installed_mw && installed_mw > 1000) {
        return { source: 'cea', fetchedAt, ok: true, payload: { capacity: { installed_mw } } };
      }
      throw new Error('No wind capacity data found in CEA page');
    } catch {
      return { source: 'cea', fetchedAt, ok: true, fixturesUsed: true, payload: CEA_FIXTURE };
    }
  }
};

/**
 * NIWE / MNRE Wind Overview crawler.
 *
 * Scrapes the national onshore wind potential headline from
 * https://mnre.gov.in/en/wind-overview/. The target sentence on the
 * page reads (verbatim, as of late 2024):
 *   "The recent assessment indicates a gross wind power potential of
 *    695.50 at 120 meter and 1163.9 GW at 150 meter above ground level."
 *
 * The NIWE assessment is published roughly once and updated only when
 * NIWE re-runs the national atlas (last revision 2021 → 150 m), so we
 * cache the parsed payload on disk for 365 days. State-wise potential
 * remains a static fixture (the per-state numbers are stable across the
 * atlas lifetime and the page presents them as a table we don't parse
 * here yet).
 */
const NIWE_CACHE_PATH    = path.resolve(__niwe_dirname, '../../../data/cache/niwe-overview.json');
const NIWE_CACHE_TTL_MS  = 365 * 24 * 60 * 60 * 1000; // 365 days
const WIND_OVERVIEW_URL  = 'https://mnre.gov.in/en/wind-overview/';

const NIWE_STATE_POTENTIAL_FIXTURE = [
  { state: 'Rajasthan', potential_150m_gw: 127.0, potential_120m_gw: 91.4 },
  { state: 'Gujarat', potential_150m_gw: 142.5, potential_120m_gw: 108.5 },
  { state: 'Karnataka', potential_150m_gw: 55.9, potential_120m_gw: 42.0 },
  { state: 'Tamil Nadu', potential_150m_gw: 84.7, potential_120m_gw: 68.2 },
  { state: 'Andhra Pradesh', potential_150m_gw: 75.3, potential_120m_gw: 62.4 },
  { state: 'Maharashtra', potential_150m_gw: 98.5, potential_120m_gw: 71.8 },
  { state: 'Madhya Pradesh', potential_150m_gw: 82.4, potential_120m_gw: 58.6 },
];

interface NiwePayload {
  fetchedAt:        string;
  sourceUrl:        string;
  asOf:             string | null;
  total_150m_gw:    number;
  total_120m_gw:    number | null;
  statePotential:   typeof NIWE_STATE_POTENTIAL_FIXTURE;
}

async function loadNiweCache(): Promise<NiwePayload | null> {
  try {
    const buf = await readFile(NIWE_CACHE_PATH, 'utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

async function saveNiweCache(data: NiwePayload): Promise<void> {
  await mkdir(path.dirname(NIWE_CACHE_PATH), { recursive: true });
  await writeFile(NIWE_CACHE_PATH, JSON.stringify(data, null, 2));
}

function parseWindOverview(html: string): { total_150m_gw: number; total_120m_gw: number | null; asOf: string | null } {
  // Strip tags so the sentence joins across nested <strong>/<span> nodes.
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Target: "... 695.50 at 120 meter and 1163.9 GW at 150 meter ..."
  // Accept "metre" spelling and an optional "GW" on the 120 m figure.
  const re150 = /([0-9]+(?:\.[0-9]+)?)\s*(?:GW)?\s*at\s*150\s*met(?:er|re)/i;
  const m150  = text.match(re150);
  if (!m150 || !m150[1]) throw new Error('150 m potential not found on wind-overview page');
  const total_150m_gw = parseFloat(m150[1]);
  if (!Number.isFinite(total_150m_gw)) throw new Error(`150 m potential parsed as NaN from "${m150[0]}"`);

  const re120 = /([0-9]+(?:\.[0-9]+)?)\s*(?:GW)?\s*at\s*120\s*met(?:er|re)/i;
  const m120  = text.match(re120);
  const total_120m_gw = m120 && m120[1] ? parseFloat(m120[1]) : null;

  // "Last Updated: December 19, 2024" lives in the page footer.
  const asOfMatch = text.match(/Last\s+Updated[:\s]+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
  const asOf      = asOfMatch && asOfMatch[1] ? asOfMatch[1] : null;

  return { total_150m_gw, total_120m_gw, asOf };
}

async function fetchNiweOverview(): Promise<NiwePayload> {
  const res = await politeFetch(WIND_OVERVIEW_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`wind-overview HTTP ${res.status}`);
  const html = await res.text();
  const { total_150m_gw, total_120m_gw, asOf } = parseWindOverview(html);

  return {
    fetchedAt:      new Date().toISOString(),
    sourceUrl:      WIND_OVERVIEW_URL,
    asOf,
    total_150m_gw,
    total_120m_gw,
    statePotential: NIWE_STATE_POTENTIAL_FIXTURE,
  };
}

export const niweCrawler = {
  key: 'niwe',
  name: 'National Institute of Wind Energy',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    const cache     = await loadNiweCache();

    if (cache) {
      const age = Date.now() - new Date(cache.fetchedAt).getTime();
      if (age < NIWE_CACHE_TTL_MS) {
        return {
          source: 'niwe', fetchedAt, ok: true,
          payload: { ...cache, _cache: { hit: true, ageMs: age } },
        };
      }
    }

    try {
      const fresh = await fetchNiweOverview();
      await saveNiweCache(fresh);
      return {
        source: 'niwe', fetchedAt, ok: true,
        payload: { ...fresh, _cache: { hit: false } },
      };
    } catch (err) {
      if (cache) {
        return {
          source: 'niwe', fetchedAt, ok: true,
          payload: { ...cache, _cache: { hit: true, stale: true, error: (err as Error).message } },
        };
      }
      // Cold start with no cache and no upstream — serve the static
      // headline so the UI never renders a blank potential figure.
      return {
        source: 'niwe', fetchedAt, ok: true, fixturesUsed: true,
        error: (err as Error).message,
        payload: {
          fetchedAt:      fetchedAt.toISOString(),
          sourceUrl:      WIND_OVERVIEW_URL,
          asOf:           null,
          total_150m_gw:  1163.9,
          total_120m_gw:  695.50,
          statePotential: NIWE_STATE_POTENTIAL_FIXTURE,
          _cache:         { hit: false, fallback: true },
        },
      };
    }
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
