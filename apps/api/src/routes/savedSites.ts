import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requirePro } from "../middleware/requirePro";
import { authDb } from "../lib/better-auth";
import {
  createSavedSiteStore,
  SavedSiteLimitError,
  MAX_SAVED_SITES,
  type SavedSiteRow,
} from "../lib/saved-sites";

// One store over the Better Auth SQLite DB (per-user saved sites live next to
// the `user` table). The factory keeps the data layer unit-testable in isolation.
const store = createSavedSiteStore(authDb);

const router = Router();

// Per-route limiter, consistent with every other Pro router (analyze, logistics,
// …). Keyed by user id — requirePro's userAuth runs first and sets req.user — so
// it throttles per account, not per shared NAT/proxy IP. The 3-site cap already
// bounds writes; this bounds read/rename/delete floods against the auth SQLite DB.
const savedSitesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (req: Request) =>
    (req.user?.id as string | undefined) || req.ip || "anon",
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) =>
    res.status(429).json({ error: "Too many saved-site requests" }),
});

// ── Validation (system boundary — never trust the client) ───────────────────
const lonLat = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

// Compact, comparison-only summary. All numbers nullable so a "partial" run
// (some sections unavailable) still saves. .strict() rejects unknown keys so the
// stored payload can't be inflated with arbitrary fields.
const summarySchema = z
  .object({
    scoreValue: z.number().finite(),
    scoreRating: z.string().max(40),
    cuf: z.number().finite().nullable(),
    confidence: z.string().max(20),
    meanSpeedMs: z.number().finite().nullable(),
    cfIec3: z.number().finite().nullable(),
    powerDensity: z.number().finite().nullable(),
    siteClass: z.string().max(40).nullable(),
    capacityMw: z.number().finite().nullable(),
    energyGwh: z.number().finite().nullable(),
    equityIrr: z.number().finite().nullable(),
    lcoe: z.number().finite().nullable(),
    payback: z.number().finite().nullable(),
    redExclusionFraction: z.number().finite().nullable(),
    amberExclusionFraction: z.number().finite().nullable(),
    farmOverlapFraction: z.number().finite().nullable(),
    ehvWithin25Km: z.boolean().nullable(),
    nearestSubstationKm: z.number().finite().nullable(),
    state: z.string().max(80).nullable(),
  })
  .strict();

// Ring capped at 4,000 vertices so the JSON body stays well under the 256 kb
// global parser limit (a drawn AOI is a handful of points; only a very detailed
// uploaded boundary would approach this).
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    ring: z.array(lonLat).min(4).max(4000),
    centroid: lonLat,
    areaKm2: z.number().finite().positive(),
    isPointMode: z.boolean(),
    summary: summarySchema,
  })
  .strict();

const renameSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();

/** Shape a stored row (name in its own column, geometry+summary in payload)
 *  into the API site object. Tolerates a corrupt payload by degrading fields. */
function rowToSite(row: SavedSiteRow) {
  let p: {
    ring?: unknown;
    centroid?: unknown;
    areaKm2?: unknown;
    isPointMode?: unknown;
    summary?: unknown;
  } = {};
  try {
    p = JSON.parse(row.payload);
  } catch {
    // Corrupt payload → still return the row with empty geometry rather than 500.
  }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    ring: Array.isArray(p.ring) ? p.ring : [],
    centroid: p.centroid ?? null,
    areaKm2: typeof p.areaKm2 === "number" ? p.areaKm2 : null,
    isPointMode: p.isPointMode === true,
    summary: p.summary ?? null,
  };
}

// GET /api/saved-sites — the caller's own saved sites + the cap.
router.get("/saved-sites", ...requirePro, savedSitesLimiter, (req: Request, res: Response) => {
  try {
    const rows = store.list(req.user!.id as string);
    res.json({ sites: rows.map(rowToSite), max: MAX_SAVED_SITES });
  } catch (err) {
    console.error("[saved-sites] list failed", err);
    res.status(500).json({ error: "Could not load saved sites" });
  }
});

// POST /api/saved-sites — save the current AOI (enforces the per-user cap).
router.post("/saved-sites", ...requirePro, savedSitesLimiter, (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid saved-site payload",
      code: "INVALID_PAYLOAD",
    });
    return;
  }
  const { name, ring, centroid, areaKm2, isPointMode, summary } = parsed.data;
  const payload = JSON.stringify({ ring, centroid, areaKm2, isPointMode, summary });
  try {
    const row = store.create(req.user!.id as string, name, payload);
    res.status(201).json({ site: rowToSite(row) });
  } catch (err) {
    if (err instanceof SavedSiteLimitError) {
      res.status(409).json({
        error: `You can save up to ${MAX_SAVED_SITES} sites. Delete one to save another.`,
        code: err.code,
      });
      return;
    }
    console.error("[saved-sites] create failed", err);
    res.status(500).json({ error: "Could not save site" });
  }
});

// PATCH /api/saved-sites/:id — rename one of the caller's own sites.
router.patch("/saved-sites/:id", ...requirePro, savedSitesLimiter, (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing site id" });
    return;
  }
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid name", code: "INVALID_NAME" });
    return;
  }
  try {
    const row = store.rename(req.user!.id as string, id, parsed.data.name);
    if (!row) {
      res.status(404).json({ error: "Saved site not found" });
      return;
    }
    res.json({ site: rowToSite(row) });
  } catch (err) {
    console.error("[saved-sites] rename failed", err);
    res.status(500).json({ error: "Could not rename site" });
  }
});

// DELETE /api/saved-sites/:id — delete one of the caller's own sites.
router.delete("/saved-sites/:id", ...requirePro, savedSitesLimiter, (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing site id" });
    return;
  }
  try {
    const ok = store.remove(req.user!.id as string, id);
    if (!ok) {
      res.status(404).json({ error: "Saved site not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    console.error("[saved-sites] delete failed", err);
    res.status(500).json({ error: "Could not delete site" });
  }
});

export default router;
