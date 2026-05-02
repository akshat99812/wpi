# Build Prompt: Wind Power India — Full-Stack Rebuild

> Copy everything from the horizontal rule below into a new AI coding session.

---

You are a senior full-stack engineer. Build a **production-ready, monorepo** application called **Wind Power India (WPI)** — a geospatial intelligence portal and live data pipeline for India's wind energy market. Replicate the architecture described below exactly.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | **Bun** (all JS/TS execution) |
| Backend API | **Express.js** (TypeScript) |
| ORM | **Prisma** (with PostgreSQL) |
| Database | **PostgreSQL 16** |
| Frontend | **Next.js 14** (App Router, TypeScript, Tailwind CSS) |
| Scheduling | **node-cron** (in-process) |
| Containerization | **Docker** + **Docker Compose** |
| Geospatial Map | **MapLibre GL JS** |

---

## Monorepo Structure

Scaffold the following directory tree:

```
wind-power-india/
├── apps/
│   ├── api/                         # Express backend
│   │   ├── src/
│   │   │   ├── server.ts            # Express entry point
│   │   │   ├── routes/
│   │   │   │   ├── data.ts          # GET /api/data
│   │   │   │   ├── sources.ts       # GET /api/sources, GET /api/source/:key
│   │   │   │   ├── refresh.ts       # POST /api/refresh (admin-gated)
│   │   │   │   └── health.ts        # GET /api/health, GET /api/ready
│   │   │   ├── services/
│   │   │   │   ├── bundleStore.ts   # Read/write data/latest.json
│   │   │   │   └── scheduler.ts     # node-cron daily job
│   │   │   ├── middleware/
│   │   │   │   └── adminAuth.ts     # Bearer token check
│   │   │   └── orchestrator/
│   │   │       ├── index.ts         # Run all crawlers, merge, validate, write
│   │   │       ├── crawlers/        # 15 individual crawler modules (see below)
│   │   │       └── merge.ts         # Merge logic per source
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                         # Next.js frontend
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx             # Main dashboard page
│       │   └── api/                 # Next.js API passthrough (optional)
│       ├── components/
│       │   ├── Map/                 # MapLibre GL JS wrapper component
│       │   ├── KpiCard.tsx
│       │   ├── TabPanel.tsx
│       │   ├── AuctionCard.tsx
│       │   ├── NewsCard.tsx
│       │   └── SourceStatusBar.tsx
│       ├── lib/
│       │   └── api.ts               # Typed fetch client for WPI API
│       ├── package.json
│       └── tsconfig.json
├── docker-compose.yml
├── .env.example
└── Makefile
```

---

## Part 1: Database Schema (`prisma/schema.prisma`)

Define the following Prisma models with full field types and relations:

```prisma
model CapacitySnapshot {
  id             String   @id @default(cuid())
  asOf           DateTime
  installedMw    Float
  addedFyMw      Float?
  addedCyMw      Float?
  targetFyMw     Float?
  target2030Gw   Float?
  sourceUrl      String
  note           String?
  createdAt      DateTime @default(now())
}

model StateCapacity {
  id                String  @id @default(cuid())
  state             String  @unique
  installedMw       Float
  potentialMw120m   Float?
  potentialMw150m   Float?
  pipelineMw        Float?
  cufPct            Float?
  updatedAt         DateTime @updatedAt
}

model AuctionResult {
  id                  String   @id @default(cuid())
  issuer              String   // SECI, NTPC, GUVNL, MSEDCL
  tranche             String
  capacityMw          Float?
  tariffL1Inr         Float?
  tariffL2Inr         Float?
  tariffWeightedInr   Float?
  bidOpenDate         DateTime?
  resultDate          DateTime?
  winners             Json     @default("[]")
  structure           String?  // Wind | Wind-Solar Hybrid | FDRE | RTC | Peak
  sourceUrl           String
  createdAt           DateTime @default(now())
}

model TariffOrder {
  id              String   @id @default(cuid())
  serc            String   // GERC, KERC, RERC, MERC, TNERC...
  orderDate       DateTime
  title           String
  tariffInrPerKwh Float?
  projectSizeMw   Float?
  tariffType      String?  // APPC | Levelised | Generic | Auction-Discovered
  pdfUrl          String
  summary         String?
  createdAt       DateTime @default(now())
}

model LendingRate {
  id              String   @id @default(cuid())
  lender          String   // IREDA, REC, PFC, NaBFiD, SBI
  product         String
  rateFloorPct    Float
  rateCeilingPct  Float?
  tenorYears      Float?
  moratoriumMonths Int?
  asOf            DateTime
  sourceUrl       String
  createdAt       DateTime @default(now())
}

model NewsItem {
  id        String   @id @default(cuid())
  headline  String
  url       String
  source    String
  published DateTime
  summary   String?
  tags      String[] @default([])
  state     String?
  createdAt DateTime @default(now())
}

model PolicyDoc {
  id       String   @id @default(cuid())
  title    String
  issuer   String
  issued   DateTime
  pdfUrl   String
  category String   // Repowering | Offshore | Hybrid | ALMM | RPO | etc.
  summary  String?
  createdAt DateTime @default(now())
}

model GridSnapshot {
  id                String   @id @default(cuid())
  asOf              DateTime
  windGenerationMu  Float
  peakWindMw        Float?
  windSharePct      Float?
  curtailmentMu     Float?
  sourceUrl         String
  createdAt         DateTime @default(now())
}

model OemModel {
  id            String   @id @default(cuid())
  oem           String
  model         String
  ratedKw       Float
  rotorM        Float
  hubOptionsM   Float[]  @default([])
  almmListed    Boolean?
  deploymentMw  Float?
  sourceUrl     String
  createdAt     DateTime @default(now())
}

model SourceStatus {
  id         String   @id @default(cuid())
  source     String   @unique
  ok         Boolean
  error      String?
  fetchedAt  DateTime
  updatedAt  DateTime @updatedAt
}
```

---

## Part 2: Backend API (`apps/api`)

### `server.ts` — Express Entry Point

```typescript
// Setup Express with:
// - cors (allow all origins in dev, configurable via env)
// - compression (gzip)
// - json body parser
// - Mount all routers under /api
// - node-cron daily job at "0 1 * * *" (01:00 UTC / 06:30 IST) calling orchestrator
// - On startup, if data/latest.json doesn't exist, run the orchestrator once
```

### `routes/data.ts`
- `GET /api/data`: Read `data/latest.json`, return it as JSON with `Cache-Control: public, max-age=300`.
- `GET /api/source/:key`: Read `data/by-source/<key>.json`, return it.
- `GET /api/sources`: Return list of available source keys + their status from `data/latest.json#source_status`.

### `routes/health.ts`
- `GET /api/health`: Return `{ ok: true, uptime_s }`.
- `GET /api/ready`: Check if `data/latest.json` exists. Return bundle age in seconds. If age > 48h, set `stale: true`.

### `routes/refresh.ts`
- `POST /api/refresh`: Require `Authorization: Bearer <WPI_ADMIN_TOKEN>` header. Accept optional `?source=<key>` query param. Fire orchestrator in background thread and return `{ ok: true, queued: true }`.

### `middleware/adminAuth.ts`
- Check `Authorization: Bearer <token>` against `process.env.WPI_ADMIN_TOKEN`. Return 401 if missing or wrong.

---

## Part 3: The Orchestrator & Crawlers

### `orchestrator/index.ts`

This is the core data pipeline. It must:
1. Import all crawler modules from the registry.
2. Run each crawler in an isolated `try/catch`. One failure must not stop others.
3. Collect all `SourceResult` objects.
4. Call `merge()` to combine them into a single `Bundle` object.
5. Upsert all data into PostgreSQL via Prisma.
6. Write the final bundle to `data/latest.json`.
7. Copy it to `data/archive/<UTC-date>/latest.json`.
8. Write per-source JSON to `data/by-source/<key>.json`.

```typescript
interface SourceResult {
  source: string;
  fetchedAt: Date;
  ok: boolean;
  error?: string;
  fixturesUsed?: boolean;
  payload: Record<string, unknown>;
}

interface Bundle {
  generatedAt: string;
  capacity?: object;
  stateCapacity: object[];
  tariffOrders: object[];
  auctions: object[];
  lendingRates: object[];
  news: object[];
  policies: object[];
  grid?: object;
  oemModels: object[];
  sourceStatus: Record<string, { ok: boolean; error?: string; fetchedAt: string }>;
}
```

### Crawler Registry (`orchestrator/crawlers/`)

Create a crawler for **each of the following 15 sources**. Each crawler module exports:
- A `key: string` (unique slug)
- A `name: string` (human-readable)
- An `async run(): Promise<SourceResult>` function

All crawlers must:
- Use a polite HTTP client: `User-Agent: WindPowerIndia-CrawlBot/1.0 (+https://windpowerindia.in; contact: data@wpi.in)`
- Enforce a **2-second minimum gap** between requests to the same host.
- Implement **exponential backoff** with 3 retries on 5xx or network errors.
- Check `robots.txt` (cache per host) before fetching.
- Return `{ ok: false, error: "..." }` on failure — never throw.

| Crawler Key | Source | URLs to Fetch | What to Extract |
|---|---|---|---|
| `mnre` | Ministry of New & Renewable Energy | `mnre.gov.in/physical-progress/`, `mnre.gov.in/wind/current-status/` | Total installed wind capacity (MW), FY target, press releases |
| `cea` | Central Electricity Authority | `cea.nic.in/renewable-dashboard/`, `npp.gov.in/dailyReport/dailyEnergyGeneration` | Monthly generation, installed capacity breakdown |
| `niwe` | National Institute of Wind Energy | `niwe.res.in/department_wra.php` | State-wise wind potential at 120m and 150m hub height |
| `seci` | Solar Energy Corporation of India | `seci.co.in/tenders`, `seci.co.in/auction-results` | Open tenders, auction results, discovered tariffs (₹/kWh) |
| `lenders` | IREDA, REC, PFC, SBI | `ireda.in/applicable-interest-rates`, `recindia.nic.in/financial-products` | Current lending rates, tenor, moratorium for wind projects |
| `cerc` | Central Electricity Regulatory Commission | `cercind.gov.in/orders.html` | Tariff regulations, DSM orders |
| `state_serc` | State SERCs (GERC, KERC, RERC, MERC, TNERC) | Individual state SERC order pages | State wind tariff orders (₹/kWh), effective date |
| `state_nodal` | State Nodal Agencies (GEDA, KREDL, etc.) | Individual state energy agency pages | State-level installed capacity updates |
| `mercom` | Mercom India Research | RSS: `mercomindia.com/feed`, category pages | Latest wind energy news headlines |
| `renewable_watch` | Renewable Watch | RSS: `renewablewatch.in/feed/` | Industry news |
| `pib` | Press Information Bureau | RSS: `pib.gov.in/RssMain.aspx?ModId=6` | Government press releases on wind/MNRE |
| `grid` | POSOCO / NLDC | `posoco.in/reports/daily-reports/` | Daily wind generation (MU), grid share % |
| `global_wind_atlas` | Global Wind Atlas (DTU/IRENA) | `globalwindatlas.info/api/gis/country/IND` | GWA JSON API — wind speed data for India |
| `oem_reports` | Suzlon, Inox Wind, GE, Vestas-IN | Investor relations pages | OEM turbine models, rated kW, rotor diameter, ALMM status |
| `analyst_notes` | CRISIL, JMK, IEEFA, BNEF | Report listing pages | Latest analyst report titles and links on India wind |

### Merge Logic (`orchestrator/merge.ts`)

Implement this exact merge priority:
- **Capacity**: Prefer `mnre` data. Only use `cea` if `mnre` returns `ok: false`.
- **State Capacity**: Extend array from all sources. Merge state potential into state capacity by matching `state` name.
- **Auctions**: Append all from `seci`.
- **News**: Aggregate from `mercom`, `renewable_watch`, `pib`. De-duplicate by URL.
- **Grid**: First-wins (use `grid` source; fallback to `cea` daily generation).

---

## Part 4: Frontend (`apps/web`)

### Design Language (MANDATORY)

The frontend must look like a **high-end, premium B2B SaaS terminal**. Not a demo. Not a boilerplate. A product that costs money. Apply these rules:

- **Color Palette (Dark Mode)**: Background `#0b0f19`, Panel `#131826`, Border `#27324a`, Text `#e8ecf4`, Muted `#9aa4ba`, Primary Accent `#ff8a1f` (orange), Success `#4cc87a` (green), Link `#58a6ff` (blue).
- **Typography**: Import `Inter` from Google Fonts. Use `font-feature-settings: "cv11", "salt"`.
- **Components**: Use glassmorphism with `backdrop-filter: blur(12px)` on modals and floating panels.
- **Micro-animations**: All hover states use `transition: all 0.15s ease`. Cards lift with `transform: translateY(-1px)` on hover.
- **No placeholder images**: Generate or use SVG icons inline.

### Page Layout (`app/page.tsx`)

A fixed-height `100vh` layout that doesn't scroll. Two-column split:

- **Left Column (60%)**: The Map Card
  - Header: "India Wind Intelligence Map" + last-refreshed timestamp
  - A `<Map />` component (MapLibre GL JS via `react-map-gl` or direct wrapper)
  - Floating controls: search box, layer toggle panel (checkboxes for: Wind Farm Clusters, State Boundaries, Wind Potential Heatmap)
  - On state polygon click: fly to state, show state detail in right panel
- **Right Column (40%)**: The Knowledge Bank (scrollable)
  - 3 `<KpiCard />` components at the top:
    - "Total Installed Capacity" (from `bundle.capacity.installed_mw`, unit: GW)
    - "Auctions Pipeline" (count of open auctions from `bundle.auctions`)
    - "Latest Bundle Age" (calculated from `bundle.generatedAt`)
  - A `<TabPanel />` with tabs: **Overview | Auctions | Tariffs | Policies | News**
    - **Overview**: Year-over-year capacity growth chart (SVG or Chart.js), state-wise capacity list.
    - **Auctions**: List of `<AuctionCard />` components. Each shows: Issuer, Tranche, Capacity MW, L1 Tariff, Result Date. Expandable for winners list.
    - **Tariffs**: State SERC tariff orders. Show SERC name, tariff ₹/kWh, order date, PDF link.
    - **Policies**: Accordion list of policy documents by category (Repowering, Offshore, Hybrid, RPO).
    - **News**: `<NewsCard />` feed with headline, source name, published timestamp.
  - A `<SourceStatusBar />` at the very bottom: shows a dot (green/red) + name for each of the 15 sources.

### Data Fetching

- Use **React Server Components** for the initial page render. Fetch `http://api:3001/api/data` server-side so the page is never blank.
- Client-side, poll `/api/data` every 5 minutes and silently update state.
- If a source in `bundle.source_status` has `ok: false`, show a `data-stale="true"` warning pill next to that data section.

---

## Part 5: Docker & Deployment

### `docker-compose.yml`

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: wpi
      POSTGRES_PASSWORD: wpi_secret
      POSTGRES_DB: wind_power_india
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql://wpi:wpi_secret@db:5432/wind_power_india
      WPI_ADMIN_TOKEN: ${WPI_ADMIN_TOKEN}
      WPI_CRON_SCHEDULE: "0 1 * * *"
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
    depends_on:
      - db

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    environment:
      NEXT_PUBLIC_API_URL: http://api:3001
    ports:
      - "3000:3000"
    depends_on:
      - api

volumes:
  pgdata:
```

### `apps/api/Dockerfile`

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx prisma generate
RUN bun run build
CMD ["bun", "run", "src/server.ts"]
```

### `apps/web/Dockerfile`

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
CMD ["bun", "run", "start"]
```

---

## Part 6: `.env.example`

```env
# PostgreSQL
DATABASE_URL=postgresql://wpi:wpi_secret@localhost:5432/wind_power_india

# API Security
WPI_ADMIN_TOKEN=changeme-please-set-a-long-random-string

# CRON Schedule (UTC) — default 01:00 UTC = 06:30 IST
WPI_CRON_SCHEDULE=0 1 * * *

# CORS
WPI_ALLOW_ORIGINS=*

# Frontend API base URL
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Part 7: `Makefile`

```makefile
install:
	bun install --cwd apps/api && bun install --cwd apps/web

db:up:
	docker compose up -d db

migrate:
	cd apps/api && bunx prisma migrate dev

seed:
	cd apps/api && bun run src/orchestrator/index.ts --dry-run

dev:api:
	cd apps/api && bun run --watch src/server.ts

dev:web:
	cd apps/web && bun run dev

test:
	cd apps/api && bun test

docker:up:
	docker compose up -d --build
```

---

## Delivery Checklist

When you are done, verify:

1. `docker compose up -d` starts all services cleanly.
2. `GET http://localhost:3001/api/health` returns `{ ok: true }`.
3. `GET http://localhost:3000` renders the dashboard fully hydrated.
4. The map loads India state boundaries with the geospatial layer.
5. Crawlers for `mnre` and `seci` are functional and write to `data/by-source/`.
6. `POST http://localhost:3001/api/refresh` with the correct Bearer token triggers a pipeline run.
7. All Prisma models are migrated and receiving data.

Start by generating the full `prisma/schema.prisma`, then `apps/api/src/server.ts`, then the orchestrator, then the crawlers in order of the registry table, then the Next.js frontend.

---

## Part 8: MapLibre GL JS — Full Geospatial Engine

The map is NOT a simple choropleth. It is a full MapLibre GL JS instance with **5 basemap modes**, GeoJSON data layers, and interactive controls. Replicate ALL of these:

### 8.1 Basemap Swatches (5 modes)

Render a basemap picker panel (`.layer-panel`) with clickable swatches. Each swatch has a custom SVG icon and label:

| Basemap | Tile Source | Notes |
|---|---|---|
| **Satellite** (default) | Esri World Imagery | High-res aerial |
| **Terrain** | OpenTopoMap | SRTM contours + relief shading |
| **Streets** | OpenStreetMap Carto | Roads, settlements, infra labels |
| **Wind Profile** | Darkened satellite + NIWE heatmap overlay | GWA-style cool→hot gradient (blue→cyan→yellow→orange→red) at low opacity so state borders remain visible |
| **CECL 40 Yr** (locked/PRO) | Locked swatch — click shows a toast "premium view, coming soon" | Gold-tinted lock icon, `aria-disabled="true"` |

Switching basemaps: save camera state (`center`, `zoom`, `pitch`, `bearing`), call `map.setStyle()`, re-add all overlays on `styledata` event, restore camera with `jumpTo`.

### 8.2 Data Layers (always loaded)

1. **India State Boundaries** — GeoJSON polygons from a public India states TopoJSON. Properties: `_code` (2-letter state code), `name`. Fill: transparent default, orange on hover/selected. Line: `#27324a` 1px, brightens on hover.
2. **Wind Farm Cluster Pins** — GeoJSON Point layer from `WIND_CLUSTERS` array (~32 district centroids with `{state, name, mw, lng, lat}`). Rendered as custom wind-turbine SVG icons. Icon size scales with installed MW (`interpolate linear`). Labels appear at zoom ≥ 5.5 showing `"Name · MW MW"`.
3. **Wind Speed Heatmap** — A MapLibre `heatmap` layer from a grid of ~400 points covering India with `ws` (mean wind speed m/s) values. Weight interpolates from 3 m/s (0.05) to 9 m/s (1.0). Color ramp: `rgba(61,147,181)` → `rgba(90,173,130)` → `rgba(200,224,74)` → `rgba(255,192,65)` → `rgba(255,122,26)` → `rgba(255,26,0)`. Visibility toggled per basemap (only visible in "wind-profile" mode).
4. **Offshore Wind Zones** — Two GeoJSON polygons: Gulf of Kutch (SECI 500 MW RfS) and Gulf of Mannar (Dhanushkodi LiDAR zone). Blue fill 22% opacity, dashed blue line. Off by default.

### 8.3 Interactive Controls

- **State search input** + "Search" button: fuzzy-match state names or district cluster names. On match, `flyTo` the state centroid or cluster coordinates. If input is empty, reset to India overview (`center:[80.0, 22.5], zoom:3.9`).
- **Coordinate readout**: bottom-left floating div showing live `lng`, `lat`, `zoom` on `mousemove`.
- **Layer panel collapse**: toggle button to collapse/expand the basemap picker.
- **Clicks**: Clicking a state polygon calls `selectState(code)` to update the right-side knowledge bank. Clicking a turbine pin calls `selectState(pin.state)`.

### 8.4 State Centroids

Store a lookup object mapping each 2-letter state code to `{center: [lng, lat], zoom: number}` for all 36 states/UTs. Used by search and `flyTo`.

---

## Part 9: Knowledge Bank — 8-Tab Intelligence Panel (Right Column)

The right column is NOT a simple tab panel. It has TWO modes: **India Overview** (default) and **State Detail** (on state click). The content of every tab changes based on mode.

### 9.1 Header Section

- `detailKind`: "India Overview" or "State Detail"
- `stName`: "India — National Wind Snapshot" or state name
- "← Back to India overview" button (hidden in India mode)

### 9.2 Metrics Strip (3 KPI cards)

| Metric | India Mode | State Mode |
|---|---|---|
| Installed Capacity | Sum of all state MW (computed from STATE data, not hardcoded) | State's `capacity_MW` |
| 150m Potential | `1,163.86 GW` (NIWE published) | State's `potential_150m_GW` |
| Realisation | `Installed ÷ Potential × 100` | Same formula per state |

### 9.3 Tab Strip (8 tabs, horizontally scrollable)

**Wind | Policy | Capacity | Tariffs | Grid | Land | Technology | News**

- **Land** and **Technology** tabs are **hidden in state mode** (only show in India mode).
- If the active tab is hidden when switching modes, auto-select "Wind".

### 9.4 Tab Content

**Wind Tab**: Regime description text + long-form wind profile (multi-section brief with stats grid and paragraphs). Each state and India has its own `PROFILE` object with stats array and sections array.

**Policy Tab**: Accordion of policy groups. India mode shows central policies (MNRE, MoP, CERC, SECI, CEA). State mode shows state-specific policy groups from the STATE data.

**Capacity Tab**: India mode shows a horizontal bar chart (SVG) of top-10 wind states by installed MW. State mode shows district-wise capacity chart from `WIND_CLUSTERS`, or a "pending" shell if no cluster data.

**Tariffs Tab**: India mode aggregates all state tariff rows sorted by date (top 20). State mode shows only that state's tariffs. Each tariff row is a clickable link card with: date, tender name, capacity MW, winner, tariff value, source.

**Grid Tab**: Pending shell linking to CEA, PGCIL, Grid-India, and state STU. State mode adds the state transmission utility.

**Land Tab** (India only): Pending shell linking to ISRO Bhuvan, FSI, MoEF&CC, Global Wind Atlas, OSM, NIWE.

**Technology Tab** (India only): Pending shell linking to MNRE ALMM PDF and NIWE Type Certification.

**News Tab**: India mode aggregates news from all states (top 20, sorted by date). State mode shows only that state's news items.

Every tab has a **source footer** (`srcStamp`) listing authoritative source links.

### 9.5 CECL Pro Teaser (compact, persistent)

A compact gold-themed CTA card at the bottom of the knowledge bank (below all tabs), always visible. Shows: PRO badge, "CECL Pro · 40-year proprietary wind dataset", feature bullets (reanalysis, SCADA, auction microdata, P50/P75/P90), and a `mailto:` CTA button.

---

## Part 10: Persona Engine — Full-Screen Modal System

Three "engines" launched from top-nav pill buttons: **Finance**, **Research**, **Operators** (coming soon). Each opens a full-screen modal overlay.

### 10.1 Modal Structure

```
.engine-modal (fixed overlay, backdrop-blur)
  .engine-shell (max-width container)
    header.engine-bar
      - Left: pill icon + engine name
      - Center: tab switcher (Finance | Research | Operators[locked])
      - Right: close button (×)
    .engine-body
      section[data-engine-pane="finance"]
      section[data-engine-pane="research"]
      section[data-engine-pane="operators"] (placeholder "coming soon")
```

Modal opens with CSS animation (fade + translateY). Closes on: × button, backdrop click, Escape key. Body overflow is `hidden` while open.

### 10.2 Finance Engine (Left Column — Dashboard)

A scrollable column of **7 collapsible accordion sections** (`<details>` elements), each containing a KPI grid:

1. **Tariff Regime** — 8 KPIs: SECI auction band, State PPA pool, FDRE, Hybrid RTC, C&I captive, tariff escalation (flat/nil), must-run status, curtailment risk.
2. **CapEx Structure (turnkey)** — 10 KPIs: Turnkey CapEx, WTG package, BoP all-in, Land & ROW, Evacuation infra, Civil & foundation, Electricals & SCADA, IDC + pre-op, Repowering CapEx, Hub height premium.
3. **Debt & Leverage** — 8 KPIs: IREDA rate, REC/PFC rate, PSU bank rate, Leverage band (70-80% D:E), Tenor (15-20 yrs), DSCR covenant (1.30×), DSRA (2 quarters), Refinance window.
4. **Taxation & Depreciation** — 8 KPIs: Sec 115BAA effective (25.168%), Standard CIT, MAT, Wind WDV 40%/yr, Acc-dep first year, Dep exhausted ~Y10, Cap-gains on salvage, GST on WTG (12%).
5. **Cashflow Parameters** — 8 KPIs: Tariff escalation (0%), O&M escalation (5%/yr), Insurance (0.40% CapEx), Insurance escalation (3%/yr), Generation degradation (0.5%/yr), Auxiliary load (0.5%), Working capital (1 month), Salvage (5% CapEx).
6. **Operating Benchmarks** — 8 KPIs: National avg PLF (~24%), Top-quartile PLF (32-38%), Best-in-class PLF (40%+), Project life (25 yrs PPA), Useful life (30 yrs), O&M run-rate, Bankable IRR floor (13% equity post-tax), Min DSCR target (1.30×).
7. **FY24-25 Capacity Additions** — Horizontal bar chart (Gujarat 3.4GW, Tamil Nadu 2.1GW, Karnataka 1.7GW, Rajasthan 1.4GW, Maharashtra 0.8GW).
8. **Wind Finance Macro Signals** — 7 bullet items covering auction trajectory, project debt, Sec 115BAA + WDV, FDRE premium, repowering pipeline, ALMM-II, group captive uplift.

Followed by a modeling assumptions paragraph and a CECL Pro teaser (full-size, gold theme).

### 10.3 Finance Engine (Right Column — Bankability Calculator)

A **live, client-side 25-year DCF model** with 9 slider inputs that update all outputs in real-time. This is the most complex frontend component.

**Slider Inputs:**

| Input | ID | Min | Max | Step | Default | Unit |
|---|---|---|---|---|---|---|
| Capacity | `finSize` | 20 | 1000 | 5 | 100 | MW |
| WTG cost | `finWtg` | 4.5 | 9.0 | 0.05 | 6.50 | ₹ Cr/MW |
| BoP cost | `finBop` | 1.5 | 4.0 | 0.05 | 2.50 | ₹ Cr/MW |
| Debt % | `finDebt` | 0 | 85 | 1 | 75 | % |
| Interest rate | `finRate` | 7.0 | 13.0 | 0.1 | 9.0 | % |
| Debt tenor | `finTenor` | 5 | 20 | 1 | 18 | yrs |
| Tariff | `finTariff` | 2.50 | 6.50 | 0.05 | 4.20 | ₹/kWh |
| PLF | `finPlf` | 16 | 45 | 0.5 | 37.0 | % |
| O&M | `finOm` | 5 | 30 | 0.1 | 8.0 | ₹ L/MW/yr |

**Derived Display (4 tiles):** Turnkey CapEx (₹ Cr), Equity incl WC (₹ Cr), Debt (₹ Cr), Annual debt service (₹ Cr).

**Year-1 Run Rate (6 tiles):** Generation (MU), Revenue (₹ Cr), O&M (₹ Cr), EBITDA margin (%), EBITDA Y1 (₹ Cr), DSCR Y1 (×).

**Returns & Coverage (6 tiles):** Project IRR (%), Equity IRR (%), Payback (yrs), 25-yr ROI (%), Avg DSCR (×), Min DSCR (×).

**Bankability Verdict:** Color-coded status banner:
- **Bankable** (green): Equity IRR ≥ 13% AND Avg DSCR ≥ 1.30×
- **Marginal** (yellow): Equity IRR ≥ 11% AND Avg DSCR ≥ 1.15×
- **Sub-bankable** (red): Fails either threshold

**Calculation Engine (implement exactly):**

```
Constants: HOURS=8760, AUX=0.005, DEGRAD=0.005, OM_ESC=0.05,
           INS_PCT=0.004, INS_ESC=0.03, DEPR=0.40, TAX=0.25168,
           SALV=0.05, WC_MONTHS=1, LIFE=25

Turnkey = WTG + BoP (Cr/MW)
TotalCapex = Capacity × Turnkey
Debt = TotalCapex × Debt%
EquityHard = TotalCapex − Debt
Annuity = Debt × r × (1+r)^N / ((1+r)^N − 1)  [equated annual]
GrossGen_Y1 = Capacity × 8760 × PLF/100  (MWh)
NetGen_Y1 = GrossGen × (1 − AUX)
Revenue_Y1 = NetGen × Tariff × 1000 / 1e7  (Cr)
WC = Revenue_Y1 / 12
EquityInclWC = EquityHard + WC

For each year 1..25:
  NetGen_Y(n) = GrossGen_Y1 × (1−AUX) × (1−DEGRAD)^(n−1)
  Revenue_Y(n) = NetGen_Y(n) × Tariff × 1000 / 1e7
  O&M_Y(n) = (Capacity × O&M_L/MW/yr / 100) × (1+OM_ESC)^(n−1)
  Insurance_Y(n) = TotalCapex × INS_PCT × (1+INS_ESC)^(n−1)
  EBITDA = Revenue − O&M − Insurance

  Interest_Y(n) = Outstanding × r
  Principal_Y(n) = min(Annuity − Interest, Outstanding)
  Outstanding -= Principal

  Dep_Y(n) = WDV × 0.40;  WDV -= Dep

  TaxableUnlev = max(0, EBITDA − Dep)
  TaxableLev = max(0, EBITDA − Dep − Interest)
  TaxUnlev = TaxableUnlev × 0.25168
  TaxLev = TaxableLev × 0.25168

  ProjectCF[n] = EBITDA − TaxUnlev
  EquityCF[n] = EBITDA − Annuity − TaxLev
  DSCR[n] = EBITDA / Annuity (pre-tax, covenant standard)

Year 25 terminal: Salvage=CapEx×5%, CapGainsTax=max(0,Salvage−WDV)×25.168%
  TerminalCF = Salvage − CapGainsTax + WC
  Add to both ProjectCF[25] and EquityCF[25]

ProjectCF[0] = −TotalCapex − WC
EquityCF[0] = −EquityInclWC

IRR: Newton-Raphson (seed 10%, 80 iterations) with bisection fallback [-0.95, 5]
Payback: interpolated year where cumulative project CF crosses zero
ROI: (sum of equity inflows − equity outlay) / equity outlay × 100
```

**Methodology Disclosure:** A collapsible section explaining all 12 calculation steps with formulas. Toggle button with chevron animation.

**Disclaimer:** Warning banner: "Indicative model — not a bankability certificate" with list of what the calculator cannot see (mast data, terrain, evacuation, P50/P75/P90, offtaker risk).

**Reset Button:** Restores all sliders to defaults.

### 10.4 Research Engine (Left Column — Research Bench)

**Top KPI Dashboard (6 tiles):** Installed wind (48.2 GW), FY30 target (140 GW), @150m potential (1,164 GW), FY24 auction tariff (₹3.05/kWh), National avg PLF (~24%), Top-decile PLF (38-42%).

**11 Collapsible Research Sections** (each is a `<details>` card with tag chips, narrative paragraph, data grid, and source citations):

1. **Resource & Wind Regime** — 8 data rows: @150m/120m/100m potential, offshore, Class I speed, top-site WPD, air density, P50→P90 spread
2. **Technology Benchmark — Turbines** — 8 rows: avg new MW, largest commissioned, hub height, rotor diameter, specific power, OEM share, ALMM-II OEMs, localisation depth
3. **Policy & Regulatory Stack** — 7 bullet items: Hybrid Policy, Repowering Policy, RGO 2024, RPO trajectory, Offshore Strategy, ALMM-II, Sec 115BAA + Sec 32(1)
4. **Tariff History & Auctions** — 8 rows: SECI-I through FY24, State DISCOM, FDRE RTC, Wind+Solar+BESS, Captive C&I, Group captive uplift
5. **Grid Integration & Curtailment** — 8 rows: Scheduling threshold, deviation band, paise/kWh, curtailment %, forecast resolution, InSTS charges, GNA, wind LCOE shadow
6. **Repowering Opportunity** — 8 rows: sub-2MW fleet (~25 GW), avg age, existing/post-repower PLF, energy uplift (1.6-2.4×), CapEx, site reuse %, permit cycle
7. **Offshore Wind Program** — 8 rows: combined potential (~70 GW), FY30 target (37 GW), first auction, VGF support, LiDAR, lease term, min draught, tariff range
8. **Hybrid + Storage (RTC/FDRE)** — 8 rows: RTC clearing history, FDRE peak block, min annual CUF, wind allocation, BESS sizing, storage cost, round-trip efficiency
9. **ESG, Community & Environment** — 8 rows: land per MW, CO₂ payback, lifecycle CO₂, avian mortality, decommissioning fund, blade recycling, women in workforce
10. **R&D Frontier** — 8 rows: floating LCOE, digital-twin savings, green H₂ tariff, NGHM outlay, AWE TRL, CFD micrositing, LiDAR adoption, hybrid inverter trial
11. **State Comparator** — HTML `<table>` with 6 states × 5 columns (State, Installed, Avg PLF, Best site WPD, Tariff regime)

Followed by a full-size CECL Pro teaser for the Research Engine.

### 10.5 Research Engine (Right Column — AI Topic Search)

A search card that builds India-scoped queries against **14 curated sources**:

- **Input**: Text field + "Search" button + 16 preset topic chips (Repowering, Offshore Gujarat, Wake losses, Hybrid+BESS, RPO compliance, Forecasting, LCOE, Micro-siting, Land & siting, Green hydrogen, FDRE/RTC, ALMM-II, DSM, Floating offshore, P50/P75/P90, GIB & siting)
- **Sources**: Google Scholar, arXiv, SSRN, NIWE Wind Atlas, Global Wind Atlas, Mercom India, JMK Research, Reuters India, Times of India, The Hindu BusinessLine, Mongabay India, PIB India, MNRE site, CEA & CERC
- **Output**: 2-column grid of clickable cards, each showing tag, source name, description. Each card opens a pre-built search URL in a new tab.

**Research Methodology Disclosure:** Collapsible section with 12 sub-sections explaining: Resource layer methodology, P50/P75/P90 conversion formula (`Pn = P50 × exp(−z_n × σ)`), PLF convention, LCOE methodology, tariff aggregation (capacity-weighted), curtailment measurement, tax & depreciation regime, repowering economics formula, offshore-onshore tariff gap, forecasting & DSM penalties, limitations, and update cadence with source list.

### 10.6 Operators Engine

Placeholder "Coming Soon" card with icon, tag, title, and description: "Fleet performance benchmarks, OEM SCADA telemetry, lost-energy diagnostics, repowering calculators and BESS hybridisation scenarios."

---

## Part 11: About Modal

A separate modal (NOT a persona engine) opened by the top-nav "About" button. Contains:

- CECL company description (since 1986, 40 years, Bhopal)
- 3 stat cards: 350+ clients, 600+ projects, 340+ locations
- 3 mini stat cards: 40+ yrs experience, 20,000 MW sites identified, 5 countries
- Capability tags grid (15 capabilities from Wind Resource Assessment to Repowering Studies)
- Client grid (World Bank, ADB, MNRE, IREDA, GEDA, MPNRED, Suzlon, Inox Wind, ReNew, Jindal, SBI Capital)
- Signature engagements list (6 items)
- International footprint pills (India, Bangladesh, Nepal, Sri Lanka, Mauritius)
- CECL Pro teaser section
- CTA row: "Visit cecl.in" button + Close button + "Press Esc to close" hint

---

## Part 12: Top Navigation Bar

The topbar contains (left to right):

1. **Brand**: Animated dot + "Wind Power India" + tagline
2. **Last-refreshed chip**: Hydrated from `data/latest.json#generated_at`
3. **Stats cluster** (desktop only, hidden ≤1024px): "350+ clients · 600+ projects · 340+ locations"
4. **Persona launcher pills**: 3 icon+label buttons for Finance, Research, Operators — each opens the engine modal to that tab
5. **About button**: Orange gradient CTA button

---

## Part 13: Live Data Bridge

A client-side script that fetches `./data/latest.json` on page load and hydrates any DOM element tagged with `data-live="dotted.path"`:

- Supports format types via `data-live-fmt`: `mw`, `gw`, `pct`, `inr`, `mu`, `date`, `range-inr`, `range-pct`
- Elements that can't resolve their path get `data-stale="true"` (shown with reduced opacity and dotted underline)
- Updates the `#wpi-generated-at` chip with the bundle's `generated_at` date
- Prepends fresh news items to `#newsBox` from `data.news[]`, tagged with `data-wpi-live="1"` to avoid duplication on re-render

---

## Part 14: State Data Object

The frontend must embed a `STATE` object mapping 2-letter codes to state data for all 36 states/UTs. For the 10 wind states (rj, gj, mh, ka, ap, tn, mp, tg, kl, or), each entry contains:

```typescript
interface WindState {
  name: string;
  capacity_MW: number | null;
  capacity_as: string;           // source attribution
  potential_150m_GW: number | null;
  cuf_note: string;
  regime: string;                // wind regime paragraph
  policy_groups: PolicyGroup[];  // accordion data
  news: NewsItem[];
  tariffs: TariffRow[];
  _priority?: boolean;          // marks the top 8 states
}
```

Non-wind states have `{ name, _nonwind: true }`.

The `PROFILE` object contains long-form wind briefs for India and each wind state, with `stats` array and `sections` array (each section has heading `h` and paragraphs `p[]`).

---

## Updated Component Tree

```
apps/web/components/
├── Map/
│   ├── MapCanvas.tsx            # MapLibre GL JS instance
│   ├── BasemapSwatches.tsx      # 5 basemap picker
│   ├── LayerPanel.tsx           # Collapsible layer controls
│   ├── CoordReadout.tsx         # Live lng/lat/zoom
│   └── SearchBar.tsx            # State/cluster search
├── KnowledgeBank/
│   ├── MetricsStrip.tsx         # 3 KPI cards
│   ├── TabPanel.tsx             # 8-tab switcher with mode logic
│   ├── WindTab.tsx              # Regime + wind profile
│   ├── PolicyTab.tsx            # Accordion
│   ├── CapacityTab.tsx          # SVG bar chart
│   ├── TariffsTab.tsx           # Tariff row cards
│   ├── GridTab.tsx              # Pending shell
│   ├── LandTab.tsx              # Pending shell (India only)
│   ├── TechnologyTab.tsx        # Pending shell (India only)
│   ├── NewsTab.tsx              # News feed
│   └── ProTeaser.tsx            # CECL Pro CTA
├── Engines/
│   ├── EngineModal.tsx          # Full-screen modal shell
│   ├── FinanceDashboard.tsx     # 7 accordion sections + KPI grids
│   ├── BankabilityCalc.tsx      # 9-slider DCF calculator
│   ├── ResearchBench.tsx        # 11 research sections
│   ├── TopicSearch.tsx          # AI search builder
│   ├── OperatorsPlaceholder.tsx # Coming soon
│   └── MethodologyDisclosure.tsx # Collapsible methodology
├── AboutModal.tsx               # CECL about dialog
├── TopBar.tsx                   # Navigation + persona launchers
├── SourceStatusBar.tsx          # 15-source health dots
└── CeclProTeaser.tsx            # Reusable gold CTA component
```

---

## Updated Delivery Checklist

When you are done, verify:

1. `docker compose up -d` starts all services cleanly.
2. `GET http://localhost:3001/api/health` returns `{ ok: true }`.
3. `GET http://localhost:3000` renders the full dashboard, fully hydrated.
4. The map loads with Satellite basemap, state boundaries, and wind turbine pins.
5. All 5 basemap modes work (including wind-profile heatmap and CECL 40yr locked toast).
6. Clicking a state on the map updates the right-side knowledge bank to state mode.
7. All 8 knowledge-bank tabs render correctly in both India and State modes.
8. The Finance Engine modal opens, all 9 sliders work, and the bankability verdict updates live.
9. The Research Engine modal opens with all 11 sections and the AI topic search returns cards.
10. The About modal opens and closes correctly.
11. Crawlers for `mnre` and `seci` are functional and write to `data/by-source/`.
12. `POST http://localhost:3001/api/refresh` with the correct Bearer token triggers a pipeline run.
13. All Prisma models are migrated and receiving data.
14. The live data bridge hydrates `data-live` elements from `data/latest.json`.
