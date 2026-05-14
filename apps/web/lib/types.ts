export interface WpiBundle {
  generatedAt: string;
  capacity?: {
    installed_mw: number;
    target_fy_mw: number;
  };
  stateCapacity: Array<{
    state: string;
    installed_mw?: number;
    potential_150m_gw?: number;
    potential_120m_gw?: number;
  }>;
  auctions: Array<{
    issuer: string;
    tranche: string;
    capacityMw: number;
    tariffL1Inr: number;
    resultDate: string;
  }>;
  tariffOrders: Array<{
    state?: string;
    regulator: string;        // Source publication / issuing body label
    tariff_inr?: number;      // Optional numeric tariff
    tariffLabel?: string;     // Display string when tariff isn't a single number
    effectiveDate?: string;   // ISO date — used for the date label
    dateLabel?: string;       // Pre-formatted human date ("Mar 2026", "2025")
    title?: string;
    meta?: string;            // Party list / capacity / stage line
    url?: string;             // "open source" link
    category?: string;
  }>;
  lendingRates: Array<{
    institution: string;
    product: string;
    rate_pct: number;
    tenor_yrs: number;
    moratorium_months: number;
  }>;
  news: Array<{
    headline: string;
    url: string;
    publishedAt: string;
    source: string;
    summary?: string;
  }>;
  policies: Array<{
    title: string;
    url: string;
    publishedAt: string;
    source: string;
    category: string;
    summary?: string;
  }>;
  grid?: {
    daily_wind_gen_mu: number;
    wind_grid_share_pct: number;
    curtailment_pct: number;
    date: string;
  };
  windAtlas?: {
    country: string;
    mean_wind_speed_100m: number;
    mean_wind_speed_150m?: number;
    exploitable_potential_150m_gw?: number;
    exploitable_potential_100m_gw?: number;
    source: string;
  };
  oemModels: Array<{
    oem: string;
    model: string;
    rated_kw: number;
    rotor_m: number;
    hub_height_m: number;
    almm: boolean;
  }>;
  analystReports?: Array<{
    analyst: string;
    title: string;
    date: string;
    url: string;
  }>;
  sourceStatus: Record<string, {
    ok: boolean;
    error?: string;
    fetchedAt: string;
    fixturesUsed?: boolean;
  }>;
}
