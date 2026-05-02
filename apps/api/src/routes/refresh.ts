import { Router, Request, Response } from 'express';
import { adminAuth } from '../middleware/adminAuth';
import { runOrchestrator } from '../orchestrator';

const router = Router();

router.post('/refresh', adminAuth, (req: Request, res: Response) => {
  const source = req.query.source as string;
  
  // Fire orchestrator in background
  runOrchestrator(source).catch(err => {
    console.error('Background orchestrator run failed', err);
  });
  
  res.json({ ok: true, queued: true });
});

export default router;
