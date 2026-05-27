import type { Request, Response, NextFunction } from "express";
import { userAuth } from "./userAuth";
import { isPro } from "../lib/auth-helpers";

// Composed: runs userAuth first, then the Pro check. Apply directly to a route.
export const requirePro = [
  userAuth,
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!isPro(req.user as { tier?: string | null; email: string })) {
      res.status(403).json({ error: "Pro subscription required" });
      return;
    }
    next();
  },
];
