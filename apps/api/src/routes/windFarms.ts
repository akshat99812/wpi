import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requirePro } from "../middleware/requirePro";

/**
 * District-level wind-farm points for the Pro map's zoom-out "green farm circle"
 * layer. Source data is WT-MARUT (NIWE/MNRE) district installed-capacity records
 * (data/windProjectData.json), canonicalised offline against authoritative GADM
 * district centroids by scripts/build-wind-farms (dirty district names → one
 * verified centroid per real district; spelling variants merged; multi-district
 * combos dropped). Capacity/turbine counts are summed exactly from the source.
 *
 * The baked GeoJSON ships as a static asset; this Pro-gated route just serves it
 * with a long cache. There is no per-point secret to protect (it's aggregate
 * public data), but Pro-gating keeps it consistent with the masts/turbines
 * layers it sits beside.
 */

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEOJSON_PATH = path.resolve(
  __dirname,
  "../../data/wind-projects.districts.geojson",
);

const userKey = (req: Request): string =>
  (req.user?.id as string | undefined) || req.ip || "anon";

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: userKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: "Too many requests" }),
});

// Read fresh per request — the file is tiny (~70 features, ~14 KB; OS page cache
// makes this ~free) and is rebuilt by build-wind-farms.py during data iteration,
// so an in-memory cache would serve stale circles until a server restart.
async function loadGeoJson(): Promise<string | null> {
  try {
    return await fs.readFile(GEOJSON_PATH, "utf8");
  } catch (err) {
    console.error("[wind-farms] geojson unavailable:", (err as Error).message);
    return null;
  }
}

router.get(
  "/wind-farms",
  limiter,
  ...requirePro,
  async (_req: Request, res: Response) => {
    const body = await loadGeoJson();
    if (!body) {
      res.status(503).json({ error: "Wind-farm data unavailable" });
      return;
    }
    res.setHeader("Content-Type", "application/geo+json");
    // Revalidate each load so a rebuilt dataset shows up without a hard refresh.
    res.setHeader("Cache-Control", "no-cache");
    res.send(body);
  },
);

export default router;
