import { Router, Request, Response } from 'express';
import { getLatestBundle } from '../services/bundleStore';

const router = Router();

router.get('/sources', async (req: Request, res: Response) => {
  const bundle = await getLatestBundle();
  if (!bundle) {
    res.status(404).json({ error: 'Data not found' });
    return;
  }
  
  const sources = Object.keys(bundle.sourceStatus).map(key => {
    return {
      key,
      ...bundle.sourceStatus[key]
    };
  });
  
  res.json(sources);
});

export default router;
