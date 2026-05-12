import { Router, Request, Response } from 'express';
import { getLatestBundle, getSourceData } from '../services/bundleStore';
import { fetchStateNews } from '../services/stateNews';

const router = Router();

router.get('/data', async (req: Request, res: Response) => {
  const bundle = await getLatestBundle();
  if (!bundle) {
    res.status(404).json({ error: 'Data not found' });
    return;
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json(bundle);
});

router.get('/news', async (req: Request, res: Response) => {
  const bundle = await getLatestBundle();
  if (!bundle) {
    res.status(404).json({ error: 'Data not found' });
    return;
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    generatedAt: bundle.generatedAt,
    news: bundle.news ?? [],
    policies: bundle.policies ?? [],
    analystReports: bundle.analystReports ?? [],
  });
});

// State-specific wind news — aggregated live from Google News RSS, cached
// for 30 minutes per state. Falls back to filtering the bundle if the
// upstream fetch fails entirely.
router.get('/news/state/:state', async (req: Request, res: Response) => {
  const state = decodeURIComponent(req.params.state || '').trim();
  if (!state) {
    res.status(400).json({ error: 'state param required' });
    return;
  }

  try {
    const payload = await fetchStateNews(state);
    res.set('Cache-Control', 'public, max-age=600');
    res.json(payload);
  } catch (err) {
    console.error('[/news/state] error', err);
    // Last-resort fallback — filter the bundle's national news by
    // state name so the UI never lands on an outright 500.
    const bundle = await getLatestBundle();
    const needle = state.toLowerCase();
    type BundleNewsItem = { headline?: string; summary?: string; url?: string; source?: string; publishedAt?: string };
    const fallback = ((bundle?.news ?? []) as BundleNewsItem[]).filter(n =>
      `${n.headline ?? ''} ${n.summary ?? ''}`.toLowerCase().includes(needle)
    );
    res.json({
      generatedAt: new Date().toISOString(),
      state,
      news: fallback,
      cached: false,
      fallback: true,
    });
  }
});

router.get('/tariffs', async (req: Request, res: Response) => {
  const bundle = await getLatestBundle();
  if (!bundle) {
    res.status(404).json({ error: 'Data not found' });
    return;
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    generatedAt: bundle.generatedAt,
    auctions: bundle.auctions ?? [],
    tariffOrders: bundle.tariffOrders ?? [],
    lendingRates: bundle.lendingRates ?? [],
  });
});

router.get('/source/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  const data = await getSourceData(key as string);
  if (!data) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }
  res.json(data);
});

export default router;
