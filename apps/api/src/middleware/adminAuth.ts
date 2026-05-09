import { Request, Response, NextFunction } from 'express';

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.WPI_ADMIN_TOKEN;

  if (!expectedToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
};
