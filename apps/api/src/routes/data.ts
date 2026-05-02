import { Router, Request, Response } from 'express';
import { getLatestBundle, getSourceData } from '../services/bundleStore';

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

router.get('/source/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  const data = await getSourceData(key);
  if (!data) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }
  res.json(data);
});

export default router;
