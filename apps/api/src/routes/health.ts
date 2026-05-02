import { Router, Request, Response } from 'express';
import { getLatestBundleStats } from '../services/bundleStore';

const router = Router();

router.get('/health', (req: Request, res: Response) => {
  res.json({ ok: true, uptime_s: process.uptime() });
});

router.get('/ready', async (req: Request, res: Response) => {
  const stats = await getLatestBundleStats();
  if (!stats) {
    res.json({ ready: false, message: 'data/latest.json not found' });
    return;
  }

  const ageMs = Date.now() - stats.mtime.getTime();
  const ageS = Math.floor(ageMs / 1000);
  const stale = ageS > 48 * 60 * 60; // 48 hours

  res.json({ ready: true, age_s: ageS, stale });
});

export default router;
