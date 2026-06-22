// Wind-policy comparison API (feature spec §5). Pro-gated, read-only.
//   GET /api/policy/meta
//   GET /api/policy/compare?jurisdictions=national,TN,GJ&year=2025
//   GET /api/policy/compare?base=national&targets=TN,GJ&year=2025   (diff mode)
//   GET /api/policy/choropleth?dimension=wheeling_concession&year=2025

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { requirePro } from "../middleware/requirePro";
import { dbAvailable } from "../lib/db";
import { getMeta, getCompare, getChoropleth, getPolicyScore } from "../services/policy/query";

const router = Router();

const policyLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req as unknown as { user?: { id?: string } }).user?.id || req.ip || "anon",
  message: { error: "Too many policy requests" },
});

const CODE_RE = /^[A-Za-z]{1,20}$/;
const YEAR_MIN = 1990;
const YEAR_MAX = 2100;

function cacheHeader(res: Response): void {
  res.setHeader(
    "Cache-Control",
    process.env.NODE_ENV === "production" ? "private, max-age=300" : "no-store",
  );
}

// Parse a comma list of jurisdiction codes; returns null on any malformed entry.
function parseCodes(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const codes = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (codes.length === 0) return null;
  if (!codes.every((c) => CODE_RE.test(c))) return null;
  return [...new Set(codes)];
}

// Returns { year } or null if present-but-invalid; year is null when absent.
function parseYear(raw: unknown): { year: number | null } | null {
  if (raw === undefined) return { year: null };
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  if (y < YEAR_MIN || y > YEAR_MAX) return null;
  return { year: y };
}

router.get("/policy/meta", ...requirePro, policyLimiter, async (_req: Request, res: Response) => {
  if (!dbAvailable()) {
    res.status(503).json({ error: "Policy data offline" });
    return;
  }
  try {
    const meta = await getMeta();
    cacheHeader(res);
    res.json(meta);
  } catch (err) {
    console.error("[policy/meta] query failed", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.get("/policy/compare", ...requirePro, policyLimiter, async (req: Request, res: Response) => {
  if (!dbAvailable()) {
    res.status(503).json({ error: "Policy data offline" });
    return;
  }

  const yr = parseYear(req.query.year);
  if (!yr) {
    res.status(400).json({ error: "Invalid year", code: "INVALID_YEAR" });
    return;
  }

  let codes: string[];
  let base: string | undefined;

  if (req.query.base !== undefined || req.query.targets !== undefined) {
    // diff mode
    const baseCode = parseCodes(req.query.base);
    const targets = parseCodes(req.query.targets);
    if (!baseCode || baseCode.length !== 1 || !targets) {
      res.status(400).json({ error: "diff mode needs base=<code> and targets=<comma list>", code: "INVALID_DIFF" });
      return;
    }
    const b = baseCode[0]!;
    base = b;
    codes = [...new Set([b, ...targets])];
  } else {
    const list = parseCodes(req.query.jurisdictions);
    if (!list) {
      res.status(400).json({ error: "jurisdictions=<comma list> required", code: "INVALID_JURISDICTIONS" });
      return;
    }
    codes = list;
  }

  try {
    // Validate codes against known jurisdictions (reject typos with 400).
    const meta = await getMeta();
    const valid = new Set(meta.jurisdictions.map((j) => j.code));
    const unknown = codes.filter((c) => !valid.has(c));
    if (unknown.length) {
      res.status(400).json({ error: `unknown jurisdiction(s): ${unknown.join(", ")}`, code: "UNKNOWN_JURISDICTION" });
      return;
    }

    const result = await getCompare(codes, yr.year, base);
    cacheHeader(res);
    res.json(result);
  } catch (err) {
    console.error("[policy/compare] query failed", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.get("/policy/choropleth", ...requirePro, policyLimiter, async (req: Request, res: Response) => {
  if (!dbAvailable()) {
    res.status(503).json({ error: "Policy data offline" });
    return;
  }
  const dimension = req.query.dimension;
  if (typeof dimension !== "string" || !/^[a-z_]{1,40}$/.test(dimension)) {
    res.status(400).json({ error: "Invalid dimension", code: "INVALID_DIMENSION" });
    return;
  }
  const yr = parseYear(req.query.year);
  if (!yr) {
    res.status(400).json({ error: "Invalid year", code: "INVALID_YEAR" });
    return;
  }
  try {
    const fc = await getChoropleth(dimension, yr.year);
    if (!fc) {
      res.status(400).json({ error: "Dimension is not numeric (or unknown)", code: "NOT_NUMERIC" });
      return;
    }
    cacheHeader(res);
    res.json(fc);
  } catch (err) {
    console.error("[policy/choropleth] query failed", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.get("/policy/score", ...requirePro, policyLimiter, async (req: Request, res: Response) => {
  if (!dbAvailable()) {
    res.status(503).json({ error: "Policy data offline" });
    return;
  }
  const yr = parseYear(req.query.year);
  if (!yr) {
    res.status(400).json({ error: "Invalid year", code: "INVALID_YEAR" });
    return;
  }
  try {
    const fc = await getPolicyScore(yr.year);
    cacheHeader(res);
    res.json(fc);
  } catch (err) {
    console.error("[policy/score] query failed", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

export default router;
