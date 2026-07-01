# Deploying windpowerindia.com to the Hostinger VPS

Target: `root@187.127.169.28` (fresh Ubuntu). Domain: `windpowerindia.com`.
Web on the apex + `www`, API on `api.windpowerindia.com`.

All production artifacts live in `deploy/`:

```
deploy/
├── docker-compose.prod.yml      # overrides for prod (loopback bind, real API URL)
├── nginx/
│   ├── windpowerindia.com.conf
│   └── api.windpowerindia.com.conf
├── .env.production.example
├── setup.sh                     # one-shot bootstrap on a fresh box
└── update.sh                    # rebuild after git pull
```

---

## Step 0 — DNS

At your domain registrar, create three A records (TTL 300):

```
@     A   187.127.169.28
www   A   187.127.169.28
api   A   187.127.169.28
```

From your laptop, wait until all three resolve before continuing:

```bash
dig +short windpowerindia.com
dig +short www.windpowerindia.com
dig +short api.windpowerindia.com
```

Each must print `187.127.169.28`. Propagation takes 5 min – a few hours.

## Step 1 — Get code onto the VPS

Two options. Pick one.

**A) git clone (clean, requires the repo to be pushed):**

```bash
ssh root@187.127.169.28
mkdir -p /opt && cd /opt
git clone https://github.com/akshat99812/wpi.git wce
```

**B) rsync from your laptop (run locally):**

```bash
rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude 'ingestion/data/pdfs' --exclude 'ingestion/.venv' \
  ~/Desktop/wind/wce/ root@187.127.169.28:/opt/wce/
```

## Step 2 — Run the bootstrap script

SSH to the VPS, then:

```bash
ssh root@187.127.169.28
cd /opt/wce
bash deploy/setup.sh you@yourdomain.com
```

`setup.sh` does, in order:

1. `apt update && upgrade`, installs nginx + certbot + git + curl
2. Installs Docker if missing
3. Configures UFW (SSH + HTTP/HTTPS only)
4. Adds a 2 GB swap file (Next.js build is memory-hungry)
5. Creates `/opt/wce/.env` with a random `WPI_ADMIN_TOKEN`
6. `docker compose ... up -d --build` (both services on loopback)
7. Drops the nginx vhosts in place and runs `certbot --nginx` for all 3 hostnames

If certbot fails it's almost always DNS — wait, then rerun just the certbot line at the bottom of the script.

## Step 3 — Smoke test

From your laptop:

```bash
curl -sI https://windpowerindia.com           # 200
curl -s  https://api.windpowerindia.com/health # API JSON
```

In a browser:

- `https://windpowerindia.com` → landing page
- `https://windpowerindia.com/dashboard` → dashboard
- Devtools network tab: every API call should go to `https://api.windpowerindia.com`. If any still point at `http://api:3005` you have a stale build — `bash deploy/update.sh` will rebuild.

## Step 4 — Future updates

```bash
ssh root@187.127.169.28
bash /opt/wce/deploy/update.sh
```

`update.sh` does `git pull --ff-only` then rebuilds and restarts the containers. If you used rsync in Step 1, re-rsync from your laptop and then `cd /opt/wce && docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build`.

---

## Troubleshooting

**Build OOMs.** Confirm swap is on: `swapon --show`. If not, the script's swap step failed — run it manually.

**`502 Bad Gateway`.** Container isn't up or isn't listening on `127.0.0.1`. Check `docker compose ps` and `docker compose logs api` / `docker compose logs web`.

**API calls 404 / CORS error.** Hard-refresh the browser; older builds had `NEXT_PUBLIC_API_URL` pointing at a Render fallback. Rebuild the web container: `docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build web`.

**Certbot rate-limited.** You hit Let's Encrypt's 5-failures-per-hour limit. Wait an hour, fix the DNS issue, retry.

---

## Deploying the auth + RAG update (to the already-running box)

This adds user accounts (Better Auth), the Pro-gated RAG chat, and a Qdrant
vector DB to a box that's already serving the site. Run the steps in order.

### Prereqs (on your laptop)

1. **Push the code to `main`** (the VPS pulls `main`):
   ```bash
   git push origin main
   ```
2. **Have the secrets ready.** Generate fresh ones:
   ```bash
   openssl rand -hex 32   # BETTER_AUTH_SECRET
   openssl rand -hex 32   # QDRANT_API_KEY
   ```
   You also need a real `OPENAI_API_KEY` (required — embeddings + generation
   fallback) and optionally an `XAI_API_KEY` (Grok is the primary generator
   when set; it auto-falls-back to OpenAI o4-mini on error/rate-limit).

### Step 1 — Copy the Qdrant snapshot to the VPS

The corpus (`wind_energy_v1`, ~882 points) is shipped as a Qdrant snapshot, not
re-ingested on the box. From your laptop:

```bash
scp deploy/wind_energy_v1.snapshot root@187.127.169.28:/root/
```

> The snapshot is regenerated locally with:
> ```bash
> QK=$(grep '^QDRANT_API_KEY=' ingestion/.env | cut -d= -f2-)
> SNAP=$(curl -s -X POST -H "api-key: $QK" \
>   http://localhost:6333/collections/wind_energy_v1/snapshots \
>   | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
> curl -s -H "api-key: $QK" \
>   "http://localhost:6333/collections/wind_energy_v1/snapshots/$SNAP" \
>   -o deploy/wind_energy_v1.snapshot
> ```

### Step 2 — Add the new env vars on the VPS

```bash
ssh root@187.127.169.28
cd /opt/wce
nano .env        # append the block below, with real values
```

```ini
# Better Auth
BETTER_AUTH_SECRET=<openssl rand -hex 32>
PRO_ALLOWLIST_EMAILS=you@example.com        # comma-separated; grants Pro/chat
RESEND_API_KEY=                              # optional (email flows are off)
EMAIL_FROM=onboarding@resend.dev

# RAG
OPENAI_API_KEY=sk-...                        # REQUIRED
XAI_API_KEY=                                 # optional (Grok primary if set)
XAI_MODEL=grok-4-fast-reasoning
QDRANT_API_KEY=<openssl rand -hex 32>
QDRANT_COLLECTION=wind_energy_v1
```

`BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `AUTH_COOKIE_DOMAIN` and
`QDRANT_URL` are hard-coded to the prod values in
`deploy/docker-compose.prod.yml` — don't set them here. `BETTER_AUTH_SECRET`,
`OPENAI_API_KEY` and `QDRANT_API_KEY` have **no defaults**: if they're missing
the API container starts broken. Double-check they're set before rebuilding.

### Step 3 — Pull + rebuild (brings up the new Qdrant service)

```bash
bash /opt/wce/deploy/update.sh
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml ps
# expect: api, web, umami, umami-db, qdrant all "Up"
```

### Step 4 — Restore the corpus into prod Qdrant

```bash
QK=$(grep '^QDRANT_API_KEY=' /opt/wce/.env | cut -d= -f2-)
curl -X POST -H "api-key: $QK" \
  -F "snapshot=@/root/wind_energy_v1.snapshot" \
  "http://127.0.0.1:6333/collections/wind_energy_v1/snapshots/upload?priority=snapshot"

# verify — expect "points_count":882
curl -s -H "api-key: $QK" \
  http://127.0.0.1:6333/collections/wind_energy_v1 | grep -o '"points_count":[0-9]*'
```

### Step 5 — Refresh the API nginx vhost (SSE streaming fix)

`update.sh` does **not** touch nginx. The chat stream needs the updated vhost
(disables proxy buffering, raises the read timeout for reasoning models):

```bash
cp /opt/wce/deploy/nginx/api.windpowerindia.com.conf /etc/nginx/sites-available/
nginx -t && systemctl reload nginx
```

### Step 6 — Smoke test

```bash
curl -s https://api.windpowerindia.com/api/health           # API up
```

In a browser:
- Sign up / log in at `https://windpowerindia.com` — confirm the `wpi.*` session
  cookie is set on `.windpowerindia.com`.
- Open the chat (must be a Pro-allowlisted email). Ask a question and confirm
  the answer **streams** token-by-token (not one big delayed block — that would
  mean buffering is still on) and that sources are cited.
- `docker compose ... logs -f api` — a `provider "xai" failed ... falling back`
  line is expected/healthy if Grok rate-limits; an OpenAI error there means the
  `OPENAI_API_KEY` is wrong.

## Site-report PDF export (feature flag)

The Pro "Export report (PDF)" feature renders 6-page A4 reports server-side with
headless Chromium. The `api` image now ships Chromium + fonts (incl. the ₹
glyph) and runs it with `--no-sandbox` under container isolation. The feature is
**OFF by default** behind `REPORT_PDF_ENABLED`.

Rollout:

```bash
# In the prod env file, enable the flag (optionally tune the render pool):
REPORT_PDF_ENABLED=true
REPORT_BROWSER_POOL_SIZE=4        # max concurrent Chromium pages
PDF_EXPORT_RATE_LIMIT=5           # exports / user / hour

# Rebuild the api image (Chromium install) and restart:
docker compose up -d --build api
```

Smoke test:

```bash
# Off (default) → 404; on → 401 without a Pro session (route is reachable).
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://api.windpowerindia.com/api/site-analysis/report -d '{}'
```

In a browser: as a Pro user, draw an AOI → run analysis → **Export report
(PDF)** → confirm a 6-page PDF downloads with the maps, figures, and a header/
footer on every page.

- **Kill switch:** set `REPORT_PDF_ENABLED=false` and restart the api service.
- **Memory:** Chromium is memory-heavy; the api service sets `shm_size: 1gb`.
- **Metrics (`GET /api/site-analysis/report/stats`):** in-process render metrics
  for the export path. Gated by a bearer token in `REPORT_METRICS_TOKEN`; when
  the token is unset the endpoint 404s (fail-closed), so prod never leaks metrics
  by accident. It is independent of `REPORT_PDF_ENABLED`, so stats stay readable
  even after the kill switch is flipped.

  ```bash
  # Set REPORT_METRICS_TOKEN=<secret> in the prod env file, then:
  curl -s -H "Authorization: Bearer <secret>" \
    https://api.windpowerindia.com/api/site-analysis/report/stats | jq
  ```

  The JSON reports `requests`, per-outcome `outcomes` (succeeded / dedupeHit /
  rateLimited429 / analysisBusy503 / poolBusy503 / badRequest400 / failed500 /
  aborted), and `renderMs` / `queueWaitMs` distributions (`count`/`p50`/`p95`/
  `max`, over the last 512 samples) plus the live `pool` and `inFlight` gauges.
- **When to revisit async scale-out (plan §6.4 / §9.4 — PR15 queue):** the
  synchronous design (bounded pool → 503 + Retry-After, per-user 429) is
  sufficient until the `/stats` numbers cross these thresholds in production —
  build the BullMQ/Redis job queue only once they fire:
  - `renderMs.p95` (or render + `queueWaitMs.p95`) sustained **> ~10 s**, or
  - `queueWaitMs.p95` **persistently non-zero** (renders waiting on a permit), or
  - a **climbing `poolBusy503`** count relative to `succeeded`.
  Until then, the cheaper lever is raising `REPORT_BROWSER_POOL_SIZE` on a bigger
  box. Both the DbPolicyProvider (policy already reads live from Postgres) and
  the queue remain deferred-until-needed by design.
- **Retention (plan §9.3):** the endpoint streams the PDF and persists nothing
  by default; if you later cache PDFs or debug snapshots, give them an owner-
  scoped store + TTL and log digests, not full image data URLs.

## Exclusion-zone geodatabase (PostGIS) — required for the site-analysis %

The site-analysis report's exclusion-zone **percentage** reads two PostGIS
tables — `wce.excl_polygon` (~720k features) and `wce.excl_buffer` — at query
time. This is **separate** from the Pro-map exclusion *layer*, which renders
from `data/by-source/exclusions.pmtiles`. Copying the `.pmtiles` does NOT
populate these tables. If the tables are empty (or missing), every AOI computes
**0% exclusions** and the report shows "exclusions unavailable" / no percentage,
even though the map layer looks fine. (This bit us once: the pmtiles was
deployed but the tables were never loaded.)

The migration that *creates* the empty `wce.*` tables runs with the schema, but
the **data is not** part of the git repo or the image (2.2 GB) — it must be
loaded into the VPS Postgres once. The simplest, most reliable path is a
data-only dump from a known-good local DB (the tables already exist on the VPS,
so restore data only). Run from your laptop with the local PostGIS up:

```bash
# Streams ~1 GB local -> VPS in a single transaction (rolls back on failure).
# Prereq: wce.source_registry must already match on both sides (FK target).
docker exec wce-postgis-1 pg_dump -U wpi -d wpi -Fc -a \
    -t wce.excl_polygon -t wce.excl_buffer \
  | ssh root@187.127.169.28 \
      "docker exec -i wce-postgis-1 pg_restore -U wpi -d wpi \
         --data-only --single-transaction --no-owner"

# Refresh planner stats after a bulk load.
ssh root@187.127.169.28 'docker exec wce-postgis-1 psql -U wpi -d wpi \
  -c "ANALYZE wce.excl_polygon; ANALYZE wce.excl_buffer;"'
```

Verify the load and that the live coverage query returns a percentage fast:

```bash
ssh root@187.127.169.28 'docker exec wce-postgis-1 psql -U wpi -d wpi -tAc \
  "SELECT (SELECT count(*) FROM wce.excl_polygon), (SELECT count(*) FROM wce.excl_buffer);"'
# expect: 720945 | 276  (or current local counts)
```

In a browser, run a site analysis over an exclusion-dense AOI (e.g. Kutch,
Gujarat) and confirm the report shows hard (red) / verify (amber) percentages.

> **This data lives only in the VPS Postgres volume.** If that volume is ever
> recreated (`docker compose down -v`, disk loss, fresh box), the tables come
> back **empty** and the % silently returns to 0 — re-run the dump/restore above.
> `update.sh` does NOT touch it.

## Wind-farm attribution (PostGIS `wind_farm_districts`) — Pro-map turbine card

When a Pro user clicks an individual turbine on the map, the detail card shows the
**WT-MARUT wind-farm district** it sits in plus that district's installed capacity
(MW) and turbine count (WEG). This is a point-in-polygon join (`ST_Contains`) in
`/api/turbine/:id` against the `wind_farm_districts` table (70 GADM district
polygons tagged with WT-MARUT/NIWE totals). If the table is empty/missing the card
**degrades gracefully** — it just omits the wind-farm block (no crash), which is
exactly why a missed deploy step ships silently. Build/ingest chain:

- `apps/api/scripts/build-wind-farms.py` → `data/wind-farm-districts.geojson` (4.2 MB,
  **committed to git** so `update.sh`'s `cp -f apps/api/data/*.geojson data/` lands it
  on the host `./data` bind-mount — same shadow-mount rule as offshore-wind).
- migration `apps/api/migrations/005_wind_farm_districts.sql` (mounted at initdb, so
  it auto-runs only on a *fresh* DB — apply by hand on the existing VPS DB).
- `apps/api/scripts/ingest-wind-farm-districts.ts` loads the geojson → PostGIS.

Deploy on the existing VPS (after `git pull` + `update.sh` has copied the geojson):

```bash
# 1. Create the table (idempotent; no-op if it already exists).
ssh root@187.127.169.28 'docker exec -i wce-postgis-1 psql -U wpi -d wpi \
  < /opt/wce/apps/api/migrations/005_wind_farm_districts.sql'

# 2. Load the 70 district polygons (TRUNCATE+INSERT in one txn; safe to re-run).
ssh root@187.127.169.28 'cd /opt/wce && docker compose exec -T api \
  bun run scripts/ingest-wind-farm-districts.ts'

# 3. Restart the api so its one-time table probe re-runs (it caches "absent" until
#    restart, so a click served before step 2 would otherwise stay un-attributed).
ssh root@187.127.169.28 'cd /opt/wce && docker compose restart api'
```

Verify (expect `70 | 31670 | 14061`):

```bash
ssh root@187.127.169.28 'docker exec wce-postgis-1 psql -U wpi -d wpi -tAc \
  "SELECT count(*), round(sum(capacity_mw)), sum(weg) FROM wind_farm_districts;"'
```

Then click a turbine in a dense belt (e.g. Kutch, Gujarat) and confirm the card's
**Wind farm** block shows the district, capacity, and registered-turbine (WEG) count.

> **The table lives only in the Postgres volume.** `docker compose down -v` / a fresh
> box wipes it → turbine cards silently drop the wind-farm block. Re-run steps 1–3.
> After editing the source data, re-run `build-wind-farms.py`, commit the regenerated
> geojson, `git pull` on the box, then repeat steps 2–3 (migration 1 is already applied).
