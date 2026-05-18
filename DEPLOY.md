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
