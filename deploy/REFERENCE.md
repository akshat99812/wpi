# windpowerindia.com — Deployment Reference

Personal reference for editing the VPS deploy. Lives at
`~/Desktop/wind/wce/deploy/REFERENCE.md`. Open in any editor or paste to
Claude when you need help.

- **VPS:** `root@187.127.169.28` (Hostinger)
- **Domain:** `windpowerindia.com` (apex + www), `api.windpowerindia.com`
- **Code on VPS:** `/opt/wce`
- **Repo:** https://github.com/akshat99812/wpi

---

## 1. File map

```
~/Desktop/wind/wce/
├── apps/
│   ├── api/                       # Bun + Express + Prisma backend (port 3005)
│   │   └── Dockerfile             # how the API container is built
│   └── web/                       # Next.js 14 frontend (port 3006)
│       └── Dockerfile             # how the web container is built
├── docker-compose.yml             # BASE compose — used in dev AND prod
├── deploy/
│   ├── docker-compose.prod.yml    # PROD-ONLY overrides (loopback bind, real API URL)
│   ├── nginx/
│   │   ├── windpowerindia.com.conf       # vhost for apex + www
│   │   └── api.windpowerindia.com.conf   # vhost for api subdomain
│   ├── .env.production.example    # template for /opt/wce/.env on the VPS
│   ├── setup.sh                   # one-shot bootstrap for a fresh VPS
│   ├── update.sh                  # rebuild after code changes
│   └── REFERENCE.md               # this file
└── DEPLOY.md                      # first-time runbook
```

---

## 2. What each file does (one-liner each)

| File | Purpose |
|---|---|
| `docker-compose.yml` | Defines the `api` and `web` services. Same in dev and prod. |
| `deploy/docker-compose.prod.yml` | Adds prod-only changes: loopback port binding, real `NEXT_PUBLIC_API_URL`, CORS allow-list. |
| `deploy/nginx/*.conf` | Reverse-proxy configs. nginx listens on 80/443 and forwards to containers on `127.0.0.1`. |
| `deploy/.env.production.example` | Template for the `/opt/wce/.env` file on the VPS. Holds secrets. |
| `deploy/setup.sh` | Runs once on a fresh VPS. Installs deps, builds, gets TLS certs. |
| `deploy/update.sh` | Run after every code change to rebuild + restart. |
| `apps/api/Dockerfile` | Bun base image, `bun install`, `prisma generate`, runs `src/server.ts`. |
| `apps/web/Dockerfile` | Bun base image, `bun install`, `bun run build` (Next), `bun run start`. |

---

## 3. Commands cheat sheet

### From your laptop

```bash
# Sync latest code to VPS (skips heavy stuff)
rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude 'ingestion/data/pdfs' --exclude 'ingestion/data/parsed' \
  --exclude 'ingestion/.venv' --exclude 'ingestion/qdrant_storage' \
  --exclude 'apps_web_git_bak' --exclude '.DS_Store' \
  ~/Desktop/wind/wce/ root@187.127.169.28:/opt/wce/

# SSH in
ssh root@187.127.169.28

# Verify DNS
dig +short windpowerindia.com api.windpowerindia.com www.windpowerindia.com
```

### On the VPS (after `ssh`)

```bash
cd /opt/wce

# First-time bootstrap (only runs once per VPS)
bash deploy/setup.sh you@email.com

# Rebuild after pushing/rsyncing new code
bash deploy/update.sh                      # if cloned with git
# OR if rsync'd:
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build

# Status
docker compose ps
docker compose logs api  -f                # tail API logs
docker compose logs web  -f                # tail web logs
docker compose logs api  --tail 100        # last 100 lines

# Restart just one service
docker compose restart api
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build web

# Hard reset (rebuild from scratch, no cache)
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d

# Nginx
nginx -t                                   # check config syntax
systemctl reload nginx                     # apply changes
systemctl status nginx                     # is it running?
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# TLS certs
certbot certificates                       # what certs do I have, expiry?
certbot renew --dry-run                    # test auto-renewal
certbot renew --force-renewal              # force renew now

# Disk space (Docker eats it)
df -h
docker system df                           # how much Docker is using
docker system prune -a                     # nuke unused images/containers (frees GBs)
```

---

## 4. Common changes — exactly what to edit

### Add a new env var the **server** (API) reads at runtime

1. Add to `deploy/.env.production.example` (so future bootstraps include it):
   ```
   OPENAI_API_KEY=sk-...
   ```
2. Add to `docker-compose.yml` under `services.api.environment:`:
   ```yaml
   OPENAI_API_KEY: ${OPENAI_API_KEY:-}
   ```
3. On the VPS, append to `/opt/wce/.env` with the real value.
4. `bash deploy/update.sh`

### Add a new env var the **browser** (web) reads

Public env vars in Next.js MUST start with `NEXT_PUBLIC_` and MUST be passed at **build** time (they get inlined into the JS bundle).

1. In `apps/web/Dockerfile` add an `ARG` + `ENV` line:
   ```dockerfile
   ARG NEXT_PUBLIC_FOO
   ENV NEXT_PUBLIC_FOO=$NEXT_PUBLIC_FOO
   ```
2. In `deploy/docker-compose.prod.yml` under `services.web.build.args:`:
   ```yaml
   NEXT_PUBLIC_FOO: actual-value-here
   ```
3. Rebuild: `bash deploy/update.sh`

### Change the API URL the frontend uses

Edit `deploy/docker-compose.prod.yml` — both `build.args.NEXT_PUBLIC_API_URL` AND `environment.NEXT_PUBLIC_API_URL`. Rebuild.

### Add a new container (e.g., Qdrant for the RAG chatbot)

In `docker-compose.yml`:
```yaml
services:
  qdrant:
    image: qdrant/qdrant:v1.7.0
    volumes:
      - ./qdrant_data:/qdrant/storage
    restart: unless-stopped
```

In `deploy/docker-compose.prod.yml` (so it's not publicly exposed):
```yaml
services:
  qdrant:
    ports: !override
      - "127.0.0.1:6333:6333"
```

The API container can reach it at `http://qdrant:6333` (Docker's internal DNS).

### Add a new subdomain (e.g., `chat.windpowerindia.com`)

1. Add the DNS A record at your registrar pointing to `187.127.169.28`.
2. Create `deploy/nginx/chat.windpowerindia.com.conf` (copy an existing one).
3. On the VPS:
   ```bash
   cp /opt/wce/deploy/nginx/chat.windpowerindia.com.conf /etc/nginx/sites-available/
   ln -s /etc/nginx/sites-available/chat.windpowerindia.com.conf /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   certbot --nginx -d chat.windpowerindia.com --redirect
   ```

### Allow bigger uploads

In both nginx configs, change `client_max_body_size 20m;` to whatever (e.g. `100m`).
`nginx -t && systemctl reload nginx`.

### Tighten CORS (currently allows only `windpowerindia.com`)

Edit `deploy/nginx/api.windpowerindia.com.conf` — the `Access-Control-Allow-Origin` line.

### Change cron schedule (daily crawl)

Edit `deploy/docker-compose.prod.yml`, `services.api.environment.WPI_CRON_SCHEDULE`. Standard cron format, UTC. Rebuild.

### Rotate the admin token

```bash
# On the VPS:
new=$(openssl rand -hex 32)
sed -i "s/^WPI_ADMIN_TOKEN=.*/WPI_ADMIN_TOKEN=$new/" /opt/wce/.env
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d
echo "New token: $new"
```

---

## 5. Troubleshooting

### `502 Bad Gateway` from nginx
The container behind it is down or not listening on loopback.
```bash
docker compose ps                  # is the container up?
docker compose logs web --tail 50  # crash logs
curl -I http://127.0.0.1:3006      # bypass nginx, hit the container directly
```

### Browser shows stale content / API calls go to wrong host
The web container was built before `NEXT_PUBLIC_API_URL` was set correctly. Force a rebuild:
```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml build --no-cache web
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d web
```

### Build runs out of memory (process killed)
Swap probably isn't on. Check with `swapon --show`. If empty:
```bash
fallocate -l 4G /swap && chmod 600 /swap && mkswap /swap && swapon /swap
echo '/swap none swap sw 0 0' >> /etc/fstab
```

### Certbot fails
- DNS hasn't propagated → check with `dig +short api.windpowerindia.com` from your laptop.
- Rate-limited → Let's Encrypt allows 5 failures/hour. Wait an hour.
- Port 80 blocked → `ufw status`, should allow `Nginx Full`.

### Disk full
```bash
df -h                              # find culprit
docker system prune -a --volumes   # frees Docker images + volumes (be careful)
journalctl --vacuum-time=3d        # truncate old systemd logs
```

### "Why isn't my edit showing up?"
Did you rsync from your laptop and then run `update.sh`? `update.sh` does `git pull` — if you rsync'd (no git on the VPS) it errors. Use this instead:
```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

### Roll back a bad deploy
```bash
cd /opt/wce
git log --oneline -5               # find the last good commit
git reset --hard <commit>
bash deploy/update.sh
```
(Only works if you cloned with git, not rsync.)

---

## 6. What lives where on the VPS

| Path | What |
|---|---|
| `/opt/wce/` | The repo (cloned or rsync'd) |
| `/opt/wce/.env` | Secrets (NOT in git) |
| `/opt/wce/data/` | API data volume (cached crawls) — survives container rebuilds |
| `/etc/nginx/sites-available/*.conf` | Active nginx configs (certbot edits these) |
| `/etc/letsencrypt/live/windpowerindia.com/` | TLS cert + key |
| `/var/log/nginx/{access,error}.log` | Web traffic logs |
| `/swap` | 2 GB swap file |

---

## 7. Asking Claude for help later

When you want me to make a change, paste:
1. What you want to change ("I want to add Qdrant", "raise upload limit to 100MB")
2. This file's path (or just say "see deploy/REFERENCE.md")
3. Any error output from the VPS, if relevant

I'll edit the right files and tell you exactly what commands to run on the VPS.
