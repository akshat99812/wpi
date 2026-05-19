---
name: project-stack
description: Core tech stack and repo structure for windpowerindia.com
metadata:
  type: project
---

Wind Power India — monorepo at `/Users/akshatpatel/Desktop/wind/wce`

**Apps:**
- `apps/api` — Bun + Express (NOT pure Bun.serve; uses express for routing). Port 3005. TypeScript.
- `apps/web` — Next.js 14 (App Router), React 18, Tailwind CSS, framer-motion, maplibre-gl. Port 3006.

**Auth:**
- NextAuth v4 with Google OAuth in the frontend (`apps/web/lib/auth.ts`)
- User model: `User` table with `googleId`, `email`, `tier` (FREE|PREMIUM)
- Users stored in flat file `data/users.json` (Prisma schema exists but data/users.json is what's actually used — no live DB connection currently)
- Admin auth: `WPI_ADMIN_TOKEN` env var checked via Bearer token in `apps/api/src/middleware/adminAuth.ts`

**Database situation:**
- Prisma schema defined (postgres) but API actually uses flat JSON files in `apps/api/data/` — no live DB running
- Qdrant vector DB for RAG chatbot (separate — `ingestion/` subsystem)

**Deployment:**
- Hostinger VPS at 187.127.169.28 (windpowerindia.com)
- Docker Compose: api container on 3005, web container on 3006
- nginx reverse proxy: apex/www → 3006, api.windpowerindia.com → 3005
- Manual deploy via `deploy/update.sh` (git pull + docker compose up --build)

**Key existing patterns:**
- Admin-gated routes use `adminAuth` middleware (Bearer token from `WPI_ADMIN_TOKEN`)
- No PATCH `/users/:id/tier` is publicly accessible (uses adminAuth)
- `NEXT_PUBLIC_API_URL` env var controls which API the Next.js app calls
- `session.user.tier` and `session.user.googleId` are extended on NextAuth session

**Why:** Helps frame new feature placement (new API routes go in apps/api/src/routes/, admin pages go in apps/web/app/admin/).
**How to apply:** Any new admin-only API endpoint should use the existing `adminAuth` middleware. New frontend pages use the Next.js App Router convention under `apps/web/app/`.
