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

  // === State Capacity: from state_nodal + enrich with niwe potential ===
  const stateNodalData = getPayload('state_nodal');
  const niweData = getPayload('niwe');
  const stateInstalled = (stateNodalData?.stateCapacity as Record<string, unknown>[]) ?? [];
  const statePotential = (niweData?.statePotential as Record<string, unknown>[]) ?? [];

  const stateMap: Record<string, Record<string, unknown>> = {};
  for (const s of stateInstalled) {
    stateMap[s.state as string] = { ...s };
  }
  for (const p of statePotential) {
    const stateName = p.state as string;
    if (stateMap[stateName]) {
      stateMap[stateName] = { ...stateMap[stateName], ...p };
    } else {
      stateMap[stateName] = { ...p };
    }
  }
  bundle.stateCapacity = Object.values(stateMap);

  // === Auctions: from seci ===
  const seciData = getPayload('seci');
  bundle.auctions = (seciData?.auctions as Record<string, unknown>[]) ?? [];

  // === Tariff Orders: from cerc + state_serc ===
  const cercData = getPayload('cerc');
  const stateSercData = getPayload('state_serc');
  bundle.tariffOrders = [
    ...((cercData?.tariffOrders as Record<string, unknown>[]) ?? []),
    ...((stateSercData?.tariffOrders as Record<string, unknown>[]) ?? [])
  ];

  // === Lending Rates: from lenders ===
  const lendersData = getPayload('lenders');
  bundle.lendingRates = (lendersData?.lendingRates as Record<string, unknown>[]) ?? [];

  // === News: from mercom + renewable_watch + pib — deduplicate by url ===
  const seenUrls = new Set<string>();
  const allNews: Record<string, unknown>[] = [];
  for (const sourceKey of ['mercom', 'renewable_watch', 'pib']) {
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
