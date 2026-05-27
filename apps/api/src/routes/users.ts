import { Router, Request, Response } from 'express';
import { userAuth } from '../middleware/userAuth';
import { isPro } from '../lib/auth-helpers';

const router = Router();

// GET /api/users/me — current user + computed isPro flag
router.get('/users/me', userAuth, (req: Request, res: Response) => {
  const u = req.user!;
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    tier: (u as { tier?: string }).tier ?? 'FREE',
    isPro: isPro(u as { tier?: string | null; email: string }),
    createdAt: u.createdAt,
  });
});

export default router;
