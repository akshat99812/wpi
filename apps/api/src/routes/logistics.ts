// Turbine Logistics Planner API (LOGISTICS_TOOL_PLAN.md §7). All Pro-gated.
//   GET  /api/logistics/catalog   — OEMs, models, facilities, presets, defaults
//   POST /api/logistics/plan      — resolve origins + route + cost (one ORS call/leg)
//   POST /api/logistics/quote     — pure cost re-run (no routing); powers live editing

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requirePro } from "../middleware/requirePro";
import {
  buildPlan,
  quote,
  LogisticsError,
  type PlanRequest,
  type QuoteRequest,
} from "../services/logistics";
import { TURBINES } from "../services/logistics/turbines";
import { FACILITIES } from "../services/logistics/facilities";
import { DEFAULT_ASSUMPTIONS, TRAILER_LABELS } from "../services/logistics/cost";
import { OEM_LABELS } from "../services/logistics/types";

const router = Router();

const logisticsLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req as unknown as { user?: { id?: string } }).user?.id || req.ip || "anon",
  message: { error: "Too many logistics requests" },
});

// ── Validation schemas ──────────────────────────────────────────────────
const MAX_TURBINES = 1000;
const MAX_DISTANCE_KM = 20_000;

const oemEnum = z.enum(["suzlon", "inox", "vestas", "siemensgamesa", "envision", "adani"]);
const componentEnum = z.enum(["blade", "nacelle", "hub", "tower"]);
const terrainEnum = z.enum(["plains", "hilly"]);
const trailerEnum = z.enum(["standardMultiAxle", "extendableBlade", "hydraulicModular"]);

const nonNeg = z.number().nonnegative().finite();
const posInt = z.number().int().positive();

const destinationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().max(120).optional(),
});

// Assumptions are an editable partial overlay on DEFAULT_ASSUMPTIONS. Every
// knob is bounded so a hostile body can't trigger absurd/overflowing math.
const assumptionsSchema = z
  .object({
    ratePerKm: z
      .object({
        standardMultiAxle: nonNeg.max(10_000),
        extendableBlade: nonNeg.max(10_000),
        hydraulicModular: nonNeg.max(10_000),
      })
      .partial()
      .optional(),
    bladeAdapterPremiumPerKm: nonNeg.max(10_000).optional(),
    avgKmPerDay: z.number().positive().max(2_000).optional(),
    escortVehicles: nonNeg.max(20).optional(),
    escortPerDay: nonNeg.max(1_000_000).optional(),
    policePerDay: nonNeg.max(1_000_000).optional(),
    nhPermitPer50Km: nonNeg.max(1_000_000).optional(),
    statePermitEach: nonNeg.max(10_000_000).optional(),
    statesCrossed: nonNeg.max(30).optional(),
    loadsPerConvoy: z.number().positive().max(50).optional(),
    craneTiers: z
      .array(
        z.object({
          maxLoadT: z.number().positive().finite(),
          capacityT: z.number().positive().finite(),
          dayRate: nonNeg.max(100_000_000),
        }),
      )
      .min(1)
      .max(20)
      .optional(),
    craneDaysPerTurbine: nonNeg.max(365).optional(),
    craneMobilization: nonNeg.max(1_000_000_000).optional(),
    gst: z
      .object({
        transportPct: nonNeg.max(100),
        cranePct: nonNeg.max(100),
      })
      .partial()
      .optional(),
    turbinePricePerMW: nonNeg.max(10_000_000_000).optional(),
  })
  .strict();

const planSchema = z
  .object({
    oem: oemEnum,
    turbineModel: z.string().min(1).max(60),
    scope: z.enum(["turbine", "component"]),
    component: componentEnum.optional(),
    destination: destinationSchema,
    numTurbines: posInt.max(MAX_TURBINES),
    terrain: terrainEnum,
    // partialRecord (not record): an origin override may cover only some
    // components (e.g. just blade). z.record(enum, …) in Zod v4 requires ALL
    // enum keys present and rejects partial overrides as INVALID_BODY.
    origins: z.partialRecord(componentEnum, z.string().min(1).max(60)).optional(),
    assumptions: assumptionsSchema.optional(),
  })
  .refine((b) => b.scope !== "component" || !!b.component, {
    message: "scope=component requires a component",
    path: ["component"],
  });

const facilitySchema = z.object({
  id: z.string(),
  oem: oemEnum,
  name: z.string(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lon: z.number(),
  products: z.array(z.string()),
  legacy: z.boolean().optional(),
  note: z.string().optional(),
});

const shipmentSchema = z.object({
  component: componentEnum,
  label: z.string().max(120),
  countPerTurbine: posInt.max(50),
  trailerType: trailerEnum,
  weightT: nonNeg.max(10_000),
  lengthM: nonNeg.max(1_000),
  widthM: nonNeg.max(100),
  heightM: nonNeg.max(100),
  superOdc: z.boolean(),
  origin: facilitySchema,
  towerSourcedLocally: z.boolean().optional(),
  distanceKm: nonNeg.max(MAX_DISTANCE_KM),
  durationHr: nonNeg.max(10_000),
  routingMode: z.enum(["ors", "estimate"]),
});

const quoteSchema = z.object({
  shipments: z.array(shipmentSchema).min(1).max(20),
  ratedMW: z.number().positive().max(100),
  numTurbines: posInt.max(MAX_TURBINES),
  terrain: terrainEnum,
  assumptions: assumptionsSchema,
});

function cacheHeader(res: Response): void {
  res.setHeader(
    "Cache-Control",
    process.env.NODE_ENV === "production" ? "private, max-age=300" : "no-store",
  );
}

// LogisticsError → 400 (client mistake); anything else → 500.
function handleError(res: Response, err: unknown, where: string): void {
  if (err instanceof LogisticsError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  console.error(`[logistics/${where}] failed`, err);
  res.status(500).json({ error: "Logistics computation failed" });
}

// ── Routes ──────────────────────────────────────────────────────────────
router.get("/logistics/catalog", ...requirePro, logisticsLimiter, (_req: Request, res: Response) => {
  cacheHeader(res);
  res.json({
    oems: (Object.keys(OEM_LABELS) as (keyof typeof OEM_LABELS)[]).map((id) => ({
      id,
      label: OEM_LABELS[id],
    })),
    turbines: TURBINES,
    facilities: FACILITIES,
    trailerTypes: (Object.keys(TRAILER_LABELS) as (keyof typeof TRAILER_LABELS)[]).map(
      (id) => ({ id, label: TRAILER_LABELS[id] }),
    ),
    defaultAssumptions: DEFAULT_ASSUMPTIONS,
  });
});

router.post("/logistics/plan", ...requirePro, logisticsLimiter, async (req: Request, res: Response) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid plan request", code: "INVALID_BODY", details: parsed.error.issues });
    return;
  }
  try {
    const plan = await buildPlan(parsed.data as PlanRequest);
    cacheHeader(res);
    res.json(plan);
  } catch (err) {
    handleError(res, err, "plan");
  }
});

router.post("/logistics/quote", ...requirePro, logisticsLimiter, (req: Request, res: Response) => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid quote request", code: "INVALID_BODY", details: parsed.error.issues });
    return;
  }
  try {
    const breakdown = quote(parsed.data as QuoteRequest);
    res.json({ breakdown });
  } catch (err) {
    handleError(res, err, "quote");
  }
});

export default router;
