# Turbine Logistics Planner — Implementation Plan (for Claude Code)

> Hand this file to Claude Code. It is **self-contained**: all research (six
> OEMs' India facilities + turbine component specs, Indian ODC cost figures,
> OpenRouteService API) and all repo conventions needed to implement are
> captured below. No re-research required.
>
> **Kickoff prompt suggestion:** _"Implement the Turbine Logistics Planner per
> LOGISTICS_TOOL_PLAN.md. Follow the file list and conventions exactly. Start
> with the backend service modules, then the route, then the web page. Finish
> by adding the deterministic cost unit test and running `tsc`."_

---

## 1. Goal

Add a **Pro-gated logistics planner** to the existing Wind Power India app that
answers, for a wind turbine (from **Suzlon, Inox Wind, Vestas, Siemens Gamesa /
Vayona, Envision, or Adani Wind**) going to a site in India:

1. **Where do the big (over-dimensional) parts ship from?** Blades, nacelle,
   hub and tower sections each come from a different factory of the **chosen
   OEM**. The tool auto-picks that OEM's nearest producing plant (e.g. nearest
   **blade** plant to the site) and lets the user override.
2. **How do they move?** Each component maps to a trailer/axle system
   (extendable blade trailer, hydraulic modular axles, multi-axle low-bed),
   with a real road route + distance from OpenRouteService (HGV profile).
3. **What does it cost?** A detailed, itemised, **user-editable** financial
   model: trucking, pilot/police escorts, state & national permits, crane
   load-in/erection, and GST — rolled up per turbine, per project, and per MW.

Blades are the headline — and India's longest are now **Adani 91.2 m**,
**Envision 89 m**, **Suzlon 70.5 m (S144)**, **Siemens Gamesa 71 m (SG 3.4-145)** —
matching the "blades are supplied by the OEM → find the plant → compute
transport + financials" framing. The model covers every major ODC load.

### Decisions already locked (from requirements)
- **Coverage:** 6 OEMs (Suzlon, Inox Wind, Vestas, Siemens Gamesa/Vayona, Envision, Adani Wind).
- **Integration:** dedicated web page (`/logistics`) + new API route (`/api/logistics`).
- **Routing:** OpenRouteService **driving-hgv** (free API key), with a graceful offline fallback.
- **Components:** all major ODC parts (blades, nacelle, hub, tower sections; the gearbox+generator drivetrain ships inside each OEM's geared **DFIG** nacelle).
- **Cost model:** detailed **and** editable (every rate tunable in the UI, live re-quote).

---

## 2. Tech stack & repo conventions (MUST follow)

### Backend — `apps/api` (Bun + Express, ESM)
- **Entry/registration:** `apps/api/src/server.ts`. Routers are imported at the
  top and mounted with `app.use('/api', xRoutes)`. Add the new one the same way.
- **Routes:** `apps/api/src/routes/<name>.ts`, each `export default router`
  (an `express.Router()`), paths relative (e.g. `router.post('/logistics/plan', …)`).
- **Pro-gating:** `import { requirePro } from "../middleware/requirePro"` then
  `router.post("/logistics/plan", ...requirePro, handler)`. `requirePro` is an
  **array** `[userAuth, proCheck]` — spread it. (401 if not logged in, 403 if
  `tier !== "PREMIUM"`.)
- **Services:** `apps/api/src/services/<domain>/`. Put logistics under
  `apps/api/src/services/logistics/`.
- **Env:** read with `process.env.X` and a lazy singleton + throw-if-missing
  pattern (see `services/rag/qdrant.ts`, `services/rag/embed.ts`). ESM imports
  use **no file extension** (Bun resolves). `zod` is available — use it for
  request-body validation. `fetch` is global (Bun) — use it for ORS.

### Frontend — `apps/web` (Next.js 14 app router, React 18, Tailwind 3.4)
- **Page:** `apps/web/app/logistics/page.tsx`, top line `"use client"`.
- **API base:** `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005'`
  then `` `${apiUrl}/api/logistics/...` `` (see `apps/web/lib/api.ts`).
  Pro endpoints need cookies → **`credentials: 'include'`** on every fetch.
- **Auth/gate:** `import { useSession, signOut } from '@/lib/auth-client'`.
  Pro = `(session.user as { tier?: string }).tier === 'PREMIUM'`. `@` alias → `apps/web/`.
- **Nav:** `import TopBar from "@/components/TopBar"` →
  `<TopBar showEngines={false} showAbout={false} />` (like the landing page).
- **Tailwind tokens** (`tailwind.config.ts`): `bg #0b0f19`, `panel #131826`,
  `border #27324a`, `text #e8ecf4`, `muted #9aa4ba`, `orange #ff8a1f`,
  `success #4cc87a`, `link #58a6ff` → utilities `text-text`, `text-muted`,
  `bg-orange`, `text-orange`, `border-border`, `text-success`, `bg-panel`, etc.
- **Palette across pages:** page bg `#090d18`; cards
  `bg-gradient-to-b from-[#0f1424] to-[#0a0f1c]` + `border-[#1f2c44]`;
  hairlines `border-[#1a2540]`; accent `orange`; Inter font; `tabular-nums` for numbers.

### Env vars to add
| Var | Where | Purpose |
|---|---|---|
| `ORS_API_KEY` (alias `OPENROUTESERVICE_API_KEY`) | `apps/api/.env` | OpenRouteService key (free tier). If unset → offline estimate fallback. |
| `NEXT_PUBLIC_API_URL` | `apps/web/.env.local` | already used; confirm it points at the API. |

---

## 3. File list (what to create)

```
apps/api/src/services/logistics/
  types.ts        # all shared types (incl. OEM)        ── SCAFFOLDED (multi-OEM, ready)
  facilities.ts   # ALL OEM facility datasets + helpers  ── SCAFFOLDED (multi-OEM, ready)
  turbines.ts     # per-OEM model specs (§4.2) + shipment assembly (§4.3)
  routing.ts      # ORS driving-hgv client + haversine fallback
  cost.ts         # DEFAULT_ASSUMPTIONS + computeCost() + crane/super-ODC helpers
  index.ts        # buildPlan() (route+cost) and quote() (cost only)
apps/api/src/routes/logistics.ts   # GET /catalog, POST /plan, POST /quote (Pro-gated)
apps/api/src/server.ts             # EDIT: import + app.use('/api', logisticsRoutes)

apps/web/lib/logistics.ts          # client-side types mirror + fetch helpers
apps/web/app/logistics/page.tsx    # the planner UI (OEM → model → site → results)
# OPTIONAL: add a "Logistics" entry to apps/web/components/PageSwitcher.tsx
```

> **Already scaffolded** in this repo: `types.ts` (with `OEM`, `oem` fields,
> `Shipment.towerSourcedLocally`) and `facilities.ts` (all six OEMs' plants +
> helpers `resolveOrigin(oem, component, dest)`, `facilitiesProducing`,
> `facilitiesForOem`, `haversineKm`). Review against this plan; all data is also
> in the tables below if you'd rather regenerate.

---

## 4. Researched data

### 4.0 OEMs covered
Six manufacturers. Every facility and turbine record carries an **`oem`** field,
and **a turbine's components ship only from that OEM's own plants** (origins are
OEM-scoped). Facility coordinates are city/site-level; component
**weights/dimensions are mostly engineering estimates `(E)`** — OEMs rarely
publish per-component masses. Blade lengths and rotor diameters are mostly official.

| OEM | `oem` id | Owns blade plants? | Owns tower plants? | Notes |
|---|---|---|---|---|
| Suzlon | `suzlon` | Yes (5) | Yes (Gandhidham) | DFIG; drivetrain inside nacelle |
| Inox Wind | `inox` | Yes (Rohika, Barwani) | Yes (Rohika, Barwani) | AMSC-licensed DFIG |
| Vestas | `vestas` | Yes (Bavla/Ahmedabad) | **No** — towers sourced locally | nacelle/hub at Chennai |
| Siemens Gamesa / Vayona | `siemensgamesa` | Yes (Nellore, Halol) | Yes (Halol) | Onshore India business → **Vayona Energy** (Dec 2025) |
| Envision | `envision` | Yes (Trichy, Dabaspet; Bavla ~2027) | **No** — towers sourced locally | nacelle/hub at Pune/Chakan |
| Adani Wind | `adani` | Yes (Mundra) | **No** — towers sourced locally | Integrated Mundra plant beside Mundra Port |

> **Tower-sourcing fallback:** OEMs without a tower plant (Vestas, Envision,
> Adani) buy tower sections from regional third-party fabricators near the
> project, so there is no fixed factory origin. The planner defaults the tower
> leg's origin to that OEM's **nearest own plant** and sets
> `towerSourcedLocally: true`, so the UI can show "towers sourced locally —
> origin approximated; override with the actual fabricator location."

### 4.1 Facilities (origins) by OEM
City/site-level coords. `legacy: true` ⇒ selectable but never auto-picked.
**IDs are OEM-prefixed and globally unique** (note: both Suzlon and Inox have a
Bhuj plant).

**Suzlon** (`suzlon`)

| id | Site | State | lat | lon | Produces |
|---|---|---|---|---|---|
| `suz_bhuj` | Bhuj (Kutch) | Gujarat | 23.24 | 69.67 | blade |
| `suz_dhule` | Dhule | Maharashtra | 20.90 | 74.77 | blade |
| `suz_anantapur` | Anantapur | Andhra Pradesh | 14.68 | 77.60 | blade |
| `suz_ratlam` | Badnawar (Ratlam) | Madhya Pradesh | 23.33 | 75.04 | blade |
| `suz_jaisalmer` | Jaisalmer | Rajasthan | 26.91 | 70.90 | blade |
| `suz_daman` | Daman | Daman & Diu | 20.40 | 72.85 | nacelle, hub |
| `suz_pondicherry` | Puducherry | Puducherry | 11.93 | 79.83 | nacelle, hub |
| `suz_gandhidham` | Gandhidham (Kutch) | Gujarat | 23.07 | 70.13 | tower |
| `suz_coimbatore` | SE Forge, Coimbatore | Tamil Nadu | 11.12 | 77.02 | forging (info) |
| `suz_vadodara` | Vadodara | Gujarat | 22.31 | 73.18 | transformer/forging (info) |
| `suz_padubidri` | Padubidri (Udupi) | Karnataka | 13.18 | 74.75 | blade, nacelle — **legacy** |

**Inox Wind** (`inox`)

| id | Site | State | lat | lon | Produces |
|---|---|---|---|---|---|
| `inox_rohika` | Rohika (Ahmedabad) | Gujarat | 22.85 | 71.95 | blade, tower |
| `inox_barwani` | Barwani (integrated) | Madhya Pradesh | 22.03 | 74.90 | blade, tower, nacelle, hub |
| `inox_una` | Una (Basal) | Himachal Pradesh | 31.47 | 76.27 | nacelle, hub |
| `inox_bhuj` | Bhuj | Gujarat | 23.25 | 69.67 | nacelle, hub |
| `inox_kalyangarh` | Kalyangarh (Ahmedabad) | Gujarat | 22.95 | 72.35 | nacelle, hub |

**Vestas** (`vestas`) — towers sourced locally

| id | Site | State | lat | lon | Produces |
|---|---|---|---|---|---|
| `ves_ahmedabad` | Bavla (Ahmedabad) | Gujarat | 22.83 | 72.35 | blade |
| `ves_chennai` | Sriperumbudur (Chennai) | Tamil Nadu | 12.70 | 79.95 | nacelle, hub |

**Siemens Gamesa / Vayona** (`siemensgamesa`)

| id | Site | State | lat | lon | Produces |
|---|---|---|---|---|---|
| `sg_nellore` | Nellore | Andhra Pradesh | 14.45 | 79.99 | blade |
| `sg_halol` | Halol | Gujarat | 22.68 | 73.47 | blade, tower |
| `sg_mamandur` | Mamandur (Kancheepuram) | Tamil Nadu | 12.72 | 79.86 | nacelle, hub |

**Envision** (`envision`) — towers sourced locally

| id | Site | State | lat | lon | Produces |
|---|---|---|---|---|---|
| `env_trichy` | Tiruchirappalli | Tamil Nadu | 10.79 | 78.70 | blade |
| `env_dabaspet` | Dabaspet (Bengaluru) | Karnataka | 13.13 | 77.37 | blade |
| `env_bavla` | Bavla (Ahmedabad) | Gujarat | 22.85 | 72.38 | blade (from ~2027) |
| `env_chakan` | Chakan (Pune) | Maharashtra | 18.76 | 73.86 | nacelle, hub |

**Adani Wind** (`adani`) — towers sourced locally

| id | Site | State | lat | lon | Produces |
|---|---|---|---|---|---|
| `adani_mundra` | Mundra (integrated, beside Mundra Port) | Gujarat | 22.84 | 69.72 | blade, nacelle, hub |

**Origin auto-pick (OEM-scoped):** for each component, choose the chosen OEM's
**nearest non-legacy plant that produces it** (great-circle distance to the
destination). If the OEM has no plant for that component (towers for
Vestas/Envision/Adani), fall back to the OEM's nearest plant of any kind and set
`towerSourcedLocally`. User can override any origin.

### 4.2 Turbine models by OEM (transport specs)
`(E)` = engineering estimate (weights and most dims). Rotor diameter and the
headline blade length are mostly official. Mark every model `estimated: true`
and show a UI disclaimer. All these OEMs use **geared DFIG** drivetrains → the
gearbox + generator ship **inside the nacelle** (no separate drivetrain load).
Default `towerSectionLengthM = 30` (road-transport practical max) unless noted.

**Suzlon** (`suzlon`)

| model | MW | rotor m | blade m | blade t (E) | nacelle t (E) | hub t (E) | tower ×n | sec t (E) | base dia m | hub heights m |
|---|---|---|---|---|---|---|---|---|---|---|
| S52  | 0.60 | 52   | 25   | 3   | 25 | 5  | 3 | 25 | 3.0 | 50–75 |
| S64  | 1.25 | 64   | 31   | 5   | 35 | 8  | 3 | 30 | 3.3 | 65–75 |
| S97  | 2.10 | 97   | 47.5 | 7.5 | 70 | 20 | 4 | 35 | 4.04 | 80/90/100 |
| S111 | 2.10 | 111.8| 54   | 9.5 | 72 | 22 | 4 | 40 | 4.2 | 90/120 |
| S120 | 2.10 | 120  | 59   | 11  | 75 | 23 | 4 | 45 | 4.2 | 90/120/140 |
| S128 | 2.80 | 128  | 63   | 12.5| 80 | 25 | 4 | 50 | 4.5 | 120/140 |
| S133 | 3.00 | 133  | 65.5 | 13.5| 85 | 27 | 4 | 55 | 4.6 | 120/140/160 |
| S144 | 3.15 | 144  | 70.5 | 15  | 92 | 28 | 4 | 60 | 4.8 | 140/160 |

**Inox Wind** (`inox`) — AMSC-licensed DFIG; no public component weights

| model | MW | rotor m | blade m | blade t (E) | nacelle t (E) | hub t (E) | tower ×n | sec t (E) | base dia m | hub heights m |
|---|---|---|---|---|---|---|---|---|---|---|
| DF 100 | 2.0 | 100 | 48.7 | 8  | 65 | 20 | 3 | 60 | 4.0 | 80/92 |
| DF 113 | 2.0 | 113 | 54.9 | 10 | 70 | 22 | 4 | 70 | 4.1 | 92/120 |
| DF 3.3-145 (DF/3000/145) | 3.3 | 145 | 70.5 | 25 | 95 | 40 | 4 | 80 | 4.5 | 100/122.5/140 |

**Vestas** (`vestas`) — official nacelle transport box **12.8 L × 4.2 W × 3.4 H**; hub **5.5 × 3.8 × 3.8**

| model | MW | rotor m | blade m | blade t (E) | nacelle t (E) | hub t (E) | tower ×n | sec t (E) | base dia m | hub heights m |
|---|---|---|---|---|---|---|---|---|---|---|
| V120-2.2 | 2.2 | 120 | 59 | 10 | 70 | 20 | 3 | 65 | 4.2 | 80/95/120/140 |
| V150-4.2 | 4.2 | 150 | 73.65 | 22 | 75 | 24 | 4 | 85 | 4.3 | 105/125 |
| V155-3.3 (India) | 3.3 | 155 | 76.2 | 24 | 72 | 24 | 4 | 85 | 4.3 | up to 140 |
| V162-6.2 (EnVentus) | 6.2 | 162 | 79.35 | 32 | 105 | 40 | 5 | 110 | 4.5 | up to 166 |

**Siemens Gamesa / Vayona** (`siemensgamesa`) — SG 3.4-145 blade = LM 71.0

| model | MW | rotor m | blade m | blade t (E) | nacelle t (E) | hub t (E) | tower ×n | sec t (E) | base dia m | hub heights m |
|---|---|---|---|---|---|---|---|---|---|---|
| G114-2.0 | 2.0 | 114 | 55.5 | 8  | 80 | 20 | 4 | 50 | 4.1 | 93/120/140 |
| SG 2.6-114 | 2.6 | 114 | 56 | 9 | 80 | 20 | 4 | 55 | 4.1 | 93/125 |
| G132-3.3 | 3.3 | 132 | 64.5 | 15 | 90 | 25 | 4 | 65 | 4.3 | 84/97/114/134 |
| SG 3.4-145 | 3.465 | 145 | 71 | 21 | 100 | 30 | 5 | 85 | 4.5 | 127.5/133.5/146 |

**Envision** (`envision`) — towers sourced locally

| model | MW | rotor m | blade m | blade t (E) | nacelle t (E) | hub t (E) | tower ×n | sec t (E) | base dia m | hub heights m |
|---|---|---|---|---|---|---|---|---|---|---|
| EN-156/3.3 | 3.3 | 156 | 76.5 | 15 | 65 | 28 | 4 | 85 | 4.5 | 120/140 |
| EN-182/5.0 | 5.0 | 181 | 89 | 24 | 100 | 50 | 5 | 110 | 4.8 | 130/140 |

**Adani Wind** (`adani`) — integrated Mundra; towers sourced locally

| model | MW | rotor m | blade m | blade t (E) | nacelle t (E) | hub t (E) | tower ×n | sec t (E) | base dia m | hub heights m |
|---|---|---|---|---|---|---|---|---|---|---|
| Adani 3.3-164 | 3.3 | 164 | 80.5 | 22 | 95 | 25 | 5 | 85 | 4.5 | 140 |
| Adani 5.2-160 | 5.2 | 160 | 78.5 | 20 | 115 | 30 | 5 | 90 | 4.6 | 120/140 |
| Adani 5.0-185 (NextGen, prototype) | 5.0 | 185 | 91.2 | 32 | 110 | 50 | 5 | 110 | 4.8 | 140/160 |

> Longest blades in the dataset: **Adani 91.2 m**, **Envision 89 m**, **Vestas
> 79.35 m**, **Adani 78.5–80.5 m**. All are extreme super-ODC (flagged by
> `lengthM > 30`) and in reality need extendable trailers with 80–95 m load
> length + overhang.

### 4.3 Component → transport envelope & trailer (derive in `turbines.ts`)
For a chosen model, build these shipments:

| component | count/turbine | length m | width m | height m | weight t | trailer |
|---|---|---|---|---|---|---|
| blade | 3 | `bladeLengthM` | `bladeMaxChordM` | 4.0 | `bladeWeightT` | `extendableBlade` |
| nacelle | 1 | 12 | 4.2 | 4.0 | `nacelleWeightT` | `hydraulicModular` |
| hub | 1 | 4.5 | 4.2 | 4.2 | `hubWeightT` | `standardMultiAxle` |
| tower | `towerSections` | `towerSectionLengthM` (default 30) | `towerBaseDiameterM` | `towerBaseDiameterM` | `towerSectionWeightT` | `towerSectionWeightT > 45 ? hydraulicModular : standardMultiAxle` |

`bladeMaxChordM`: use **3.5** for rotor ≥ 128 m, else **3.0**.

**Super-ODC flag** (drives police escort + a "special permit" badge):
```
superOdc = weightT > 55 || widthM > 4.25 || heightM > 4.5 || lengthM > 30
```
(Every blade is super-ODC by length; nacelles by weight; tower base cans by
width. Hubs typically are not.)

### 4.4 Trailer types & default ₹/km (editable)
Indian ODC is a negotiated, project-specific market — treat as order-of-magnitude.

| TrailerType | use | ₹/km range | **default** |
|---|---|---|---|
| `standardMultiAxle` | hubs, lighter tower cans | 35–85 | **70** |
| `extendableBlade` | blades (telescopic trailer) | 80–150 | **115** |
| `hydraulicModular` | nacelles, heavy base cans (SPMT) | 120–250 | **185** |
| blade adapter premium (hilly) | added to blade ₹/km on ghats | +30–60 | **+45** |

### 4.5 Other cost inputs (defaults, all editable)
| Knob | Default | Basis |
|---|---|---|
| `avgKmPerDay` | 150 | ODC moves daylight-only, slow |
| `escortVehicles` (per convoy) | 2 | 1 lead + 1 rear |
| `escortPerDay` | ₹3,000 | range ₹2,000–4,500 |
| `policePerDay` (super-ODC only) | ₹5,000 | range ₹3,000–8,000 |
| `nhPermitPer50Km` | ₹1,000 | MoRTH-OWC (₹2,000/50 km above HT3) |
| `statePermitEach` | ₹15,000 | range ₹5,000–25,000, per state, **per vehicle** |
| `statesCrossed` | 2 | user-tunable (no auto state-boundary detection v1) |
| `loadsPerConvoy` | 1 | batching factor (set 3 to run blades together) |
| crane tiers (₹/day) | 100T→30k, 250T→90k, 400T→300k, 750T→600k | by heaviest load |
| `craneDaysPerTurbine` | 3 | load-in + erection |
| `craneMobilization` (per project) | ₹2,000,000 | range ₹15–40 lakh |
| `gst.transportPct` | 5 | GTA under RCM (SAC 9965) |
| `gst.cranePct` | 18 | equipment + operator (SAC 9973/9987) |
| `turbinePricePerMW` | ₹60,000,000 | optional, for "% of turbine cost"; 0 ⇒ skip |

**Sanity rule of thumb:** transport-only logistics ≈ **₹15–35 lakh/MW** for
300–700 km hauls; total logistics (incl. crane) ≈ 4–8% of turbine ex-works.

---

## 5. Routing — OpenRouteService (`routing.ts`)

**Endpoint:** `POST https://api.openrouteservice.org/v2/directions/driving-hgv/json`
**Auth header:** `Authorization: <API_KEY>` (raw key, **no** `Bearer` prefix).
**Coords are `[lon, lat]`** (GeoJSON order).

Request body (pass the binding load's restrictions for the leg):
```json
{
  "coordinates": [[69.67, 23.24], [69.86, 23.86]],
  "options": {
    "vehicle_type": "hgv",
    "profile_params": {
      "restrictions": { "weight": 92, "height": 4.8, "width": 4.8, "axleload": 12 }
    }
  }
}
```
- Restrictions only honoured when `vehicle_type: "hgv"`. **Do not pass `length`**
  (poorly tagged in OSM; risks empty routes). Pass max `weight`/`height`/`width`
  among the leg's shipments; `axleload` ≈ 12.
- Read `routes[0].summary.distance` (m ÷1000 → km) and
  `routes[0].summary.duration` (s ÷3600 → h).
- **Free tier:** 2,500 req/day, 40 req/min, ≤6,000 km. India hauls fit easily.

**Fallback** (no key, ORS error, or no route):
```
distanceKm  = haversineKm(origin, dest) * 1.3   // road-circuity factor
durationHr  = distanceKm / 40
routingMode = "estimate"   // else "ors"
```
Surface `routingMode` to the UI as a badge so estimates are honest.

**Leg grouping:** group shipments by distinct **resolved origin facility** → one
ORS call per origin (≤3 per plan). Attach the leg's
`distanceKm/durationHr/routingMode` to each shipment from that origin.

---

## 6. Cost model (`cost.ts`) — exact formulas (OEM-agnostic)

`computeCost(shipments, ctx, A)` where `ctx = { ratedMW, numTurbines, terrain }`,
`A = CostAssumptions`. INR throughout. **Per shipment `s`:**

```
totalLoads  = s.countPerTurbine * numTurbines
ratePerKm   = A.ratePerKm[s.trailerType]
              + (s.component === "blade" && terrain === "hilly" ? A.bladeAdapterPremiumPerKm : 0)
trucking    = totalLoads * s.distanceKm * ratePerKm
convoys     = ceil(totalLoads / A.loadsPerConvoy)
transitDays = max(1, ceil(s.distanceKm / A.avgKmPerDay))
escort      = convoys * A.escortVehicles * A.escortPerDay * transitDays
police      = s.superOdc ? convoys * A.policePerDay * transitDays : 0
permits     = totalLoads * (ceil(s.distanceKm / 50) * A.nhPermitPer50Km
                            + A.statesCrossed * A.statePermitEach)   // permits are per-vehicle
subtotal    = trucking + escort + police + permits
```

**Project level:**
```
transportSubtotal = Σ s.subtotal
heaviest          = max(s.weightT)
craneTier         = first tier where heaviest <= tier.maxLoadT      // tiers sorted asc
craneCost         = craneTier.dayRate * A.craneDaysPerTurbine * numTurbines + A.craneMobilization
transportGst      = transportSubtotal * A.gst.transportPct / 100
craneGst          = craneCost * A.gst.cranePct / 100
grandTotal        = transportSubtotal + transportGst + craneCost + craneGst
perTurbine        = grandTotal / numTurbines
perMW             = grandTotal / (numTurbines * ratedMW)
pctOfTurbineCost  = A.turbinePricePerMW > 0
                    ? grandTotal / (A.turbinePricePerMW * ratedMW * numTurbines) * 100 : null
```

Return a `CostBreakdown` with per-shipment line items + the top-level totals.

**Crane tiers default:**
```
[ {maxLoadT:40,capacityT:100,dayRate:30000},
  {maxLoadT:80,capacityT:250,dayRate:90000},
  {maxLoadT:120,capacityT:400,dayRate:300000},
  {maxLoadT:1e12,capacityT:750,dayRate:600000} ]
```
(Heaviest loads here reach ~115 t — Adani 5.2-160 nacelle — still the 400T tier;
push `craneDaysPerTurbine`/tiers up for 5 MW+ if desired.)

---

## 7. API contracts (`routes/logistics.ts`) — all Pro-gated

### `GET /api/logistics/catalog`
→ `{ oems: {id,label}[], turbines: TurbineModel[], facilities: Facility[], trailerTypes: {id,label}[], presetSites: PresetSite[], defaultAssumptions: CostAssumptions }`

Every `TurbineModel` and `Facility` carries `oem`. The web filters models and
facility-override options by the selected OEM.

`presetSites` (illustrative Indian wind sites; user can also enter manual lat/lon):

| name | state | lat | lon |
|---|---|---|---|
| Khavda RE Park (Kutch) | Gujarat | 23.86 | 69.86 |
| Jaisalmer | Rajasthan | 26.91 | 70.92 |
| Gadag | Karnataka | 15.42 | 75.63 |
| Anantapur | Andhra Pradesh | 14.68 | 77.60 |
| Aralvaimozhi (Tirunelveli) | Tamil Nadu | 8.30 | 77.50 |
| Dharashiv (Osmanabad) | Maharashtra | 18.18 | 76.04 |
| Bhavnagar | Gujarat | 21.76 | 72.15 |

### `POST /api/logistics/plan`
Body (validate with zod):
```ts
{
  oem: string,                    // e.g. "adani" — must own turbineModel
  turbineModel: string,
  scope: "turbine" | "component",
  component?: "blade" | "nacelle" | "hub" | "tower",  // required if scope==="component"
  destination: { lat: number, lon: number, name?: string },
  numTurbines: number,            // >= 1
  terrain: "plains" | "hilly",
  origins?: Partial<Record<ComponentCategory, string>>, // facility-id overrides (same OEM)
  assumptions?: Partial<CostAssumptions>                 // overrides on top of defaults
}
```
Handler: resolve OEM+turbine → assemble shipments (scope filter) → resolve
origins (override, or OEM-scoped `resolveOrigin(oem, component, dest)` which sets
`sourcedLocally`/`towerSourcedLocally` where applicable) → group by origin → ORS
route each origin → attach distances → `computeCost` → respond:
```ts
{
  oem, turbine: TurbineModel,
  destination, numTurbines, terrain,
  legs: { origin: Facility, distanceKm, durationHr, routingMode }[],
  shipments: Shipment[],          // each carries towerSourcedLocally? where relevant
  assumptions: CostAssumptions,   // fully resolved (defaults merged with overrides)
  breakdown: CostBreakdown
}
```

### `POST /api/logistics/quote`  (powers live editing — no ORS)
Body: `{ shipments: Shipment[], ratedMW: number, numTurbines: number, terrain, assumptions: CostAssumptions }`
→ `{ breakdown: CostBreakdown }`. Pure re-run of `computeCost` — keeps the cost
math single-source on the server while the web re-quotes on every edit (debounced).

> Validate with `zod`; clamp `numTurbines` (1–1000); reject a `turbineModel`
> whose `oem` ≠ body `oem`; reject `origins` whose facility `oem` ≠ body `oem`.
> On ORS failure, don't 500 — fall back to estimate.

---

## 8. Web page (`apps/web/app/logistics/page.tsx`)

`"use client"`. Structure:

1. **Gate** (`useSession`): loading → skeleton; not logged in → "Log in" CTA
   (`/login`); logged in but `tier !== "PREMIUM"` → Pro upsell card; Pro → tool.
   (Server enforces via `requirePro`; this is UX only.)
2. **`<TopBar showEngines={false} showAbout={false} />`** + page heading.
3. **Form panel:**
   - **OEM** segmented control / `<select>` (Suzlon, Inox Wind, Vestas, Siemens
     Gamesa/Vayona, Envision, Adani Wind) — **first control**.
   - Turbine model `<select>` **filtered to the selected OEM** (shows MW + blade length).
   - Scope segmented: *Whole turbine* / *Single component*; if component, a
     component `<select>`.
   - Destination: preset `<select>` (fills lat/lon) + editable lat/lon inputs.
   - Number of turbines; Terrain toggle (Plains/Hilly).
   - Advanced (collapsible): per-component origin overrides, options filtered to
     the OEM's facilities (default "Auto — nearest").
   - **Compute plan** → `POST /plan` with `credentials:'include'`.
4. **Results:**
   - **Leg cards:** origin → destination, distance, transit days, `routingMode`
     badge; show the "towers sourced locally — origin approximated" note when set.
   - **Transport plan table:** component, qty, weight, L×W×H, trailer, super-ODC chip.
   - **Financials:** itemised table (per-shipment trucking/escort/police/permits;
     then transport subtotal, transport GST, crane (+capacity), crane GST,
     **grand total**, per-turbine, **per-MW**, % of turbine cost).
   - **Assumptions editor:** number inputs for every `CostAssumptions` field; on
     change debounce ~250 ms and `POST /quote` with current `shipments` + edited
     `assumptions`; update the breakdown in place ("updating…" state).
5. **Disclaimer:** weights/dims are engineering estimates; ₹ figures are
   indicative ranges, not quotes.

Styling per §2; format INR with `Intl.NumberFormat('en-IN')`, show lakh/crore
where helpful, `tabular-nums` for money.

`apps/web/lib/logistics.ts`: mirror response types and expose `getCatalog()`,
`postPlan(req)`, `postQuote(req)` (all `credentials:'include'`, base from
`NEXT_PUBLIC_API_URL`).

---

## 9. Implementation order (tasks)

1. **Backend data** — update `types.ts` (add `OEM` + `oem` fields), finish
   `facilities.ts` (all six OEMs, §4.1, OEM-scoped helpers), write `turbines.ts`
   (per-OEM model tables §4.2 + shipment assembly §4.3 + super-ODC).
2. **`routing.ts`** — ORS HGV client (§5) + haversine fallback + leg grouping.
3. **`cost.ts`** — `DEFAULT_ASSUMPTIONS` (§4.4–4.5) + `computeCost` (§6) + crane/super-ODC helpers.
4. **`index.ts`** — `buildPlan()` (resolve OEM origins → route → cost) and `quote()`.
5. **`routes/logistics.ts`** — zod validation (incl. OEM↔model check), `...requirePro`, three endpoints (§7); register in `server.ts`.
6. **`apps/web/lib/logistics.ts`** — types + fetch helpers.
7. **`apps/web/app/logistics/page.tsx`** — gate + OEM/model form + results + editor (§8).
8. **(Optional)** add "Logistics" to `PageSwitcher` / landing product cards.
9. **Verify** — §10.

---

## 10. Verification & acceptance

### 10.1 Deterministic cost unit test (no ORS — assert exact total)
`computeCost` is OEM-agnostic; test it with **fixed distances** and
`DEFAULT_ASSUMPTIONS`. Input: **Suzlon S144, numTurbines=1, terrain="plains"**:

| component | count | trailer | weight t | super-ODC | distance km |
|---|---|---|---|---|---|
| blade | 3 | extendableBlade | 15 | yes (len 70.5) | 100 |
| nacelle | 1 | hydraulicModular | 92 | yes (wt 92) | 300 |
| hub | 1 | standardMultiAxle | 28 | no | 300 |
| tower | 4 | hydraulicModular | 60 | yes (width 4.8) | 200 |

Expected per-shipment (against §6):

| shipment | trucking | escort | police | permits | subtotal |
|---|---|---|---|---|---|
| blade | 34,500 | 18,000 | 15,000 | 96,000 | **163,500** |
| nacelle | 55,500 | 12,000 | 10,000 | 36,000 | **113,500** |
| hub | 21,000 | 12,000 | 0 | 36,000 | **69,000** |
| tower | 148,000 | 48,000 | 40,000 | 136,000 | **372,000** |

```
transportSubtotal = 718,000
craneCost         = 300,000 * 3 * 1 + 2,000,000 = 2,900,000   (heaviest 92 t → 400T tier)
transportGst (5%) = 35,900
craneGst (18%)    = 522,000
grandTotal        = 4,175,900          // ₹41.76 lakh for one S144
perMW             = 4,175,900 / 3.15 ≈ 1,325,683   // ₹13.26 lakh/MW
pctOfTurbineCost  = 4,175,900 / (60,000,000 * 3.15) * 100 ≈ 2.21%
```
**Assert `grandTotal === 4175900`.** This pins the formula; any drift is a bug.

### 10.2 Other checks
- `tsc` (api): `cd apps/api && bunx tsc --noEmit`. Web: `cd apps/web && npm run lint`.
- **OEM scoping:** `/plan` for `oem:"vestas"` never returns a Suzlon origin; a
  Vestas tower leg sets `towerSourcedLocally` (Vestas owns no tower plant).
- **OEM↔model guard:** `{ oem:"adani", turbineModel:"S144" }` → 400.
- **ORS live:** key set → `routingMode:"ors"`, road distance > haversine; key
  unset → `routingMode:"estimate"`, no crash.
- **Auth:** `/api/logistics/plan` → 401 unauth, 403 non-PREMIUM, 200 Pro.
- **Editing:** changing `statePermitEach` or a `ratePerKm` updates the grand
  total within ~250 ms (via `/quote`).
- **Gut check:** a realistic 300–700 km full-turbine plan lands roughly in
  ₹15–35 lakh/MW (short hauls lower — fine).

### 10.3 Suggested verification subagent
After building, spawn a review agent to (a) re-derive the §10.1 total, (b)
confirm the ORS request shape (§5), (c) check `...requirePro` + route
registration, and (d) confirm OEM-scoped origin resolution + tower fallback.

---

## 11. Out of scope (v1) / future
- Automatic state-boundary counting along the route (v1 uses editable `statesCrossed`).
- Interactive route map (ORS geometry is available — render with the app's `maplibre-gl`).
- Address geocoding (v1 uses presets + manual lat/lon; ORS Pelias `/geocode` later).
- Real third-party tower-fabricator locations (v1 approximates with the OEM's nearest plant).
- Exposing the planner as a tool the RAG chatbot can call.
- Live carrier/crane rate integration (rates here are indicative defaults).

---

## 12. Sources

**Suzlon** — Factsheet Dec 2024 (https://newsroom.suzlon.com/wp-content/uploads/2025/04/Suzlon-Factsheet-Dec-2024.pdf) · S144 brochure (https://www.suzlon.com/pdf/S144-Product-Brochure-June-2023.pdf) · S97/S111 brochure (https://www.suzlon.com/pdf/media_kit/S97-S111_ProductBrochure.pdf) · plants overview (https://projectindustrialbuzz.com/suzlon-manufacturing-plants-in-india/)

**Inox Wind** — thewindpower.net (https://www.thewindpower.net/manufacturer_en_64_inox-wind.php) · DF 113 (https://en.wind-turbine-models.com/turbines/1846-inox-df-113) · Barwani blade plant (https://greentechlead.com/wind/inox-wind-sets-up-800-mw-blade-facility-in-madhya-pradesh-28989) · 3 MW DF/3000/145 cert (https://windinsider.com/2023/07/18/inox-winds-3-mw-turbine-achieves-type-certification-from-tuv-sud/) · Kalyangarh plant (https://deshgujarat.com/2025/12/18/harsh-sanghavi-inaugurates-inoxgfl-groups-advanced-solar-and-wind-manufacturing-facilities-in-gujarat/)

**Vestas** — nacelle/hub India plant (https://www.vestas.com/en/media/company-news/2019/vestas-to-establish-new-nacelle-and-hub-assembly-factor-c2963168) · V155-3.3 India launch (https://www.vestas.com/en/media/company-news/2020/vestas-introduces-low-wind-variant-suited-for-india-s-w-c3211237) · 4 MW platform brochure / nacelle+hub+blade dims (https://puc.sd.gov/commission/dockets/electric/2018/EL18-003/testimony/testimony/kaaz/4_MW_Product_Brochure.pdf) · EnVentus brochure (https://docs.wind-watch.org/EnVentus_Product_Brochure_Vestas-150162.pdf) · V150-4.2 (https://en.wind-turbine-models.com/turbines/1841-vestas-v150-4-2) · Bavla blade plant (https://deshgujarat.com/2020/10/06/vestas-wind-systems-to-expand-its-gujarat-plant/)

**Siemens Gamesa / Vayona** — SG 3.4-145 India (https://www.siemensgamesa.com/global/en/home/products-and-services/onshore/wind-turbine-sg-3-4-145.html) · SG 2.6-114 (https://www.siemensgamesa.com/global/en/home/products-and-services/onshore/wind-turbine-sg-2-6-114.html) · Vayona about/history (https://www.vayonaenergy.com/about) · TPG/Vayona acquisition (https://www.tpg.com/news-and-insights/tpg-and-mavco-led-consortium-completes-acquisition-of-siemens-gamesas-wind-business-in-india-and-sri-lanka-forming-new-platform-vayona-energy) · Nellore blade factory (https://www.renewableenergymagazine.com/wind/gamesa-opens-new-blade-factory-in-india-20170206) · G132-3.3 (https://en.wind-turbine-models.com/turbines/1336-gamesa-g132-3.3mw)

**Envision** — India about (https://www.envision-energy.in/about-us) · products (https://www.envision-energy.in/product) · India brochure Oct 2025 (https://www.envision-energy.in/assets/frontend/images/documents/India-Brochure-Oct-2025-V10-2-LR.pdf) · EN-156/3.3 (https://www.thewindpower.net/turbine_en_1905_envision_en-156-3.3.php) · EN-182/5.0 RLMM (https://renewablewatch.in/2025/06/23/envision-energys-5-mw-turbine-model-secures-rlmm-approval/) · Gujarat blade plant (https://www.energetica-india.net/news/envision-energy-india-performs-ground-breaking-ceremony-for-blade-plant-in-gujarat)

**Adani Wind** — adaniwind.com (https://www.adaniwind.com/) · 5.2 MW RLMM (https://www.adanienterprises.com/en/newsroom/media-releases/adani-winds-5-2-mw-wind-turbine-enlisted-in-the-mnre-revised-list-of-models-and-manufacturers-rlmm) · 5.2-160 datasheet (https://en.wind-turbine-models.com/turbines/2512-adani-5-2-160) · India's largest turbine at Mundra (https://windinsider.com/2022/11/04/adani-new-industries-installs-indias-largest-wind-turbine-taller-than-statue-of-unity/) · 91.2 m blade (https://www.manufacturingtodayindia.com/adani-new-industries-to-manufacture-91-2m-wind-turbine-blades-in-mundra) · NextGen 5 MW prototype (https://www.newkerala.com/news/a/adani-wind-commissions-nextgen-mw-wind-turbine-mundra-874.htm)

**Indian ODC transport & cranes** — ODC costs (https://nimbuslogistics.in/project-logistics/odc/what-are-the-various-costs-associated-with-odc/) · ODC process (https://prclimited.co.in/what-is-over-dimensional-cargo-odc-transport-in-india-process-challenges-best-practices/) · crane rates 2026 (https://rentals.expresscranes.com/crane-rental-price-in-india-cost-breakdown-and-savings-guide.html) · Sanghvi Movers (https://sanghvicranes.com/) · GST on GTA (https://cleartax.in/s/goods-transport-services-gst-rates-sac-code-9965) · MoRTH OWC portal (https://morth-owc.nic.in/)

**OpenRouteService** — routing options/restrictions (https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options) · requests & return types (https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types) · restrictions (https://openrouteservice.org/restrictions/) · dev sign-up (https://openrouteservice.org/dev/#/home)

> **Accuracy note:** turbine weights/dimensions marked (E) are engineering
> estimates; Indian ODC ₹ figures are indicative market ranges (2024–2026), not
> contract quotes. Siemens Gamesa's onshore India business is now **Vayona
> Energy** (Dec 2025). Every figure is an editable assumption in the tool.
