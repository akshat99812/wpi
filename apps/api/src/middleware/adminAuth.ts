import { Request, Response, NextFunction } from 'express';

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.WPI_ADMIN_TOKEN;

  if (!expectedToken) {
    console.warn('WPI_ADMIN_TOKEN is not set in environment variables');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
};
