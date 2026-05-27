import type { Request, Response, NextFunction } from "express";
import { auth } from "../lib/better-auth";
import type { AuthedUser } from "../lib/auth-helpers";

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

// Forwards Express headers to a Web Headers object that Better Auth expects.
function toWebHeaders(req: Request): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((vv) => h.append(k, vv));
    else h.set(k, String(v));
  }
  return h;
}

export const userAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const session = await auth.api.getSession({ headers: toWebHeaders(req) });
  if (!session?.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = session.user;
  next();
};
