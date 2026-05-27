import { Router, Request, Response } from 'express';
import { requirePro } from '../middleware/requirePro';

const router = Router();

// GET /api/mast — proprietary mast data, Pro-only. Stub for now; real
// API shape (map bbox vs paginated table) is deferred until UI is chosen.
router.get('/mast', ...requirePro, (req: Request, res: Response) => {
  res.json({
    ok: true,
    stub: 'mast data coming soon',
    user: req.user?.email,
  });
});

export default router;
