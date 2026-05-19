export interface SourceResult {
  source: string;
  fetchedAt: Date;
  ok: boolean;
  error?: string;
  fixturesUsed?: boolean;
  payload: Record<string, unknown>;
}

export interface Bundle {
  generatedAt: string;
  capacity?: Record<string, unknown>;
  stateCapacity: Record<string, unknown>[];
  tariffOrders: Record<string, unknown>[];
  auctions: Record<string, unknown>[];
  lendingRates: Record<string, unknown>[];
  news: Record<string, unknown>[];
  policies: Record<string, unknown>[];
  grid?: Record<string, unknown>;
  windAtlas?: Record<string, unknown>;
  windPotential?: {
    total_150m_gw: number;
    total_120m_gw: number | null;
    sourceUrl: string;
    asOf: string | null;
    fetchedAt: string;
  };
  oemModels: Record<string, unknown>[];
  analystReports: Record<string, unknown>[];
  sourceStatus: Record<string, { ok: boolean; error?: string; fetchedAt: string; fixturesUsed?: boolean }>;
}

export const merge = (results: SourceResult[]): Bundle => {
  const bundle: Bundle = {
    generatedAt: new Date().toISOString(),
    stateCapacity: [],
    tariffOrders: [],
    auctions: [],
    lendingRates: [],
    news: [],
    policies: [],
    oemModels: [],
    analystReports: [],
    sourceStatus: {}
  };

  const getPayload = (sourceKey: string) =>
    results.find(r => r.source === sourceKey && r.ok)?.payload;

  // === Capacity: Prefer mnre, fallback to cea ===
  const mnrePayload = getPayload('mnre');
  const ceaPayload = getPayload('cea');
  bundle.capacity = (mnrePayload?.capacity as Record<string, unknown>) ||
                    (ceaPayload?.capacity as Record<string, unknown>);

  // === State Capacity: prefer MNRE (live), fall back to state_nodal,
  // then enrich with NIWE potential. MNRE Table 8.2 is the canonical
  // 31 Mar cumulative; state_nodal provides supplemental fields when
  // MNRE doesn't carry a state (e.g., minor wind states).
  const niweData       = getPayload('niwe');
  const stateNodalData = getPayload('state_nodal');
  const mnreState = (mnrePayload?.stateCapacity as Record<string, unknown>[]) ?? [];
  const fallbackState = (stateNodalData?.stateCapacity as Record<string, unknown>[]) ?? [];
  const statePotential = (niweData?.statePotential as Record<string, unknown>[]) ?? [];

  const stateMap: Record<string, Record<string, unknown>> = {};
  // Layer 1: nodal fallback (covers states MNRE doesn't list).
  for (const s of fallbackState) {
    stateMap[s.state as string] = { ...s };
  }
  // Layer 2: MNRE (overwrites installed_mw with the official figure).
  for (const s of mnreState) {
    const key = s.state as string;
    stateMap[key] = { ...(stateMap[key] ?? {}), ...s };
  }
  // Layer 3: NIWE potential.
  for (const p of statePotential) {
    const stateName = p.state as string;
    if (stateMap[stateName]) {
      stateMap[stateName] = { ...stateMap[stateName], ...p };
    } else {
      stateMap[stateName] = { ...p };
    }
  }
  bundle.stateCapacity = Object.values(stateMap);

  // === Wind Potential (national headline) — from niwe (MNRE wind-overview).
  // 150 m and 120 m gross potential figures, scraped from the MNRE
  // wind-overview page and cached for 365 days.
  if (niweData && typeof niweData.total_150m_gw === 'number') {
    bundle.windPotential = {
      total_150m_gw: niweData.total_150m_gw as number,
      total_120m_gw: (niweData.total_120m_gw as number | null) ?? null,
      sourceUrl:     (niweData.sourceUrl as string) ?? 'https://mnre.gov.in/en/wind-overview/',
      asOf:          (niweData.asOf as string | null) ?? null,
      fetchedAt:     (niweData.fetchedAt as string) ?? new Date().toISOString(),
    };
  }

  // === Auctions: from seci ===
  const seciData = getPayload('seci');
  bundle.auctions = (seciData?.auctions as Record<string, unknown>[]) ?? [];

  // === Tariff Orders: combine industry trackers + state nodal agencies ===
  // Pulls in tariff data from Mercom, SolarQuarter, SECI auctions, Renewable
  // Watch, NREDCAP (AP) and TSREDCO (Telangana) so the Tariffs tab reflects
  // the full discovered-price market — auction L1s, generic tariffs, FDRE
  // and state-procurement events — not just CERC/SERC generic orders.
  const tariffSourceKeys = [
    'mercom',
    'solarquarter',
    'seci',
    'renewable_watch',
    'nredcap',
    'tsredco',
  ];
  const seenTariffKeys = new Set<string>();
  const mergedTariffs: Record<string, unknown>[] = [];
  for (const key of tariffSourceKeys) {
    const payload = getPayload(key);
    const orders = (payload?.tariffOrders as Record<string, unknown>[]) ?? [];
    for (const t of orders) {
      // Dedupe by (title, effectiveDate) so the same auction reported by two
      // trackers (e.g. Mercom + SolarQuarter both citing SECI XVII) doesn't
      // double-count on the page.
      const dedupeKey = `${(t.title as string) ?? ''}|${(t.effectiveDate as string) ?? ''}`;
      if (seenTariffKeys.has(dedupeKey)) continue;
      seenTariffKeys.add(dedupeKey);
      mergedTariffs.push(t);
    }
  }
  bundle.tariffOrders = mergedTariffs;

  // === Lending Rates: from lenders ===
  const lendersData = getPayload('lenders');
  bundle.lendingRates = (lendersData?.lendingRates as Record<string, unknown>[]) ?? [];

  // === News: combine industry trackers + RE news outlets + PIB. Each
  // crawler returns wind-relevant items only (filtered upstream against
  // turbine / offshore / repowering / OEM keywords). Deduplicate by URL so
  // the same headline reported by two outlets doesn't double-count.
  const newsSourceKeys = [
    'mercom',
    'renewable_watch',
    'pib',
    'saur_energy',
    'et_energyworld',
    'pv_magazine',
    'eq_magazine',
    'business_standard',
  ];
  const seenUrls = new Set<string>();
  const allNews: Record<string, unknown>[] = [];
  for (const sourceKey of newsSourceKeys) {
    const data = getPayload(sourceKey);
    const newsItems = (data?.news as Record<string, unknown>[]) ?? [];
    for (const item of newsItems) {
      const url = item.url as string;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        allNews.push(item);
      }
    }
  }
  bundle.news = allNews.sort((a, b) =>
    new Date(b.publishedAt as string).getTime() - new Date(a.publishedAt as string).getTime()
  );

  // === Policies: from pib ===
  const pibData = getPayload('pib');
  bundle.policies = (pibData?.policies as Record<string, unknown>[]) ?? [];

  // === Grid: from grid source, fallback to cea daily gen ===
  const gridData = getPayload('grid');
  const ceaMonthly = getPayload('cea');
  bundle.grid = (gridData?.grid as Record<string, unknown>) ||
                (ceaMonthly?.dailyGeneration as Record<string, unknown>);

  // === Wind Atlas: from global_wind_atlas ===
  const gwaData = getPayload('global_wind_atlas');
  bundle.windAtlas = (gwaData?.windAtlas as Record<string, unknown>) ?? undefined;

  // === OEM Models: from oem_reports ===
  const oemData = getPayload('oem_reports');
  bundle.oemModels = (oemData?.oemModels as Record<string, unknown>[]) ?? [];

  // === Analyst Reports: from analyst_notes ===
  const analystData = getPayload('analyst_notes');
  bundle.analystReports = (analystData?.reports as Record<string, unknown>[]) ?? [];

  // === Source Status for all 15 sources ===
  results.forEach(r => {
    bundle.sourceStatus[r.source] = {
      ok: r.ok,
      error: r.error,
      fetchedAt: r.fetchedAt.toISOString(),
      fixturesUsed: r.fixturesUsed
    };
  });

  return bundle;
};
