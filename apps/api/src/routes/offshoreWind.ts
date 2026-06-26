import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requirePro } from "../middleware/requirePro";

/**
 * India offshore-wind reference layer for the Pro map: NIWE/FOWIND-identified
 * offshore zones (Gulf of Khambhat off Gujarat; Gulf of Mannar and off
 * Kanyakumari, Tamil Nadu) as indicative polygons, plus VGF/LiDAR project
 * points, plus a `policy` block (National Offshore Wind Energy Policy 2015,
 * the 30 GW-by-2030 target, the 2024 VGF scheme, etc.).
 *
 * The data is a small static GeoJSON asset (no per-point secret) — Pro-gating
 * just keeps it consistent with the masts/turbines/wind-farm layers it sits
 * beside. Mirrors the wind-farms route: the hand-authored GeoJSON is served
 * fresh per request so an edit shows up without a server restart. The `policy`
 * member is a GeoJSON foreign member — MapLibre ignores it; the offshore tool
 * panel reads it.
 */

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEOJSON_PATH = path.resolve(__dirname, "../../data/offshore-wind.geojson");

const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: "Too many requests" }),
});

// Read fresh per request — the file is tiny (a handful of features) so the OS
// page cache makes this ~free, and it can be re-edited without a restart.
async function loadGeoJson(): Promise<string | null> {
  try {
    return await fs.readFile(GEOJSON_PATH, "utf8");
  } catch (err) {
    console.error(
      "[offshore-wind] geojson unavailable:",
      (err as Error).message,
    );
    return null;
  }
}

router.get(
  "/offshore-wind",
  limiter,
  ...requirePro,
  async (_req: Request, res: Response) => {
    const body = await loadGeoJson();
    if (!body) {
      res.status(503).json({ error: "Offshore-wind data unavailable" });
      return;
    }
    res.setHeader("Content-Type", "application/geo+json");
    res.setHeader("Cache-Control", "no-cache");
    res.send(body);
  },
);

export default router;
