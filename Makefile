.PHONY: install dev dev\:api dev\:web build test docker\:up docker\:down crawl lint

# ── Local development ─────────────────────────────────────────────────────────
install:
	bun install --cwd apps/api && bun install --cwd apps/web

dev:
	@trap 'kill 0' INT; \
	(cd apps/api && PORT=3005 bun run --watch src/server.ts) & \
	(sleep 3 && cd apps/web && PORT=3006 bun run dev) & \
	wait

dev\:api:
	cd apps/api && PORT=3005 bun run --watch src/server.ts

dev\:web:
	cd apps/web && PORT=3006 bun run dev

# ── Build ─────────────────────────────────────────────────────────────────────
build:
	cd apps/web && bun run build

# ── Testing ───────────────────────────────────────────────────────────────────
test:
	cd apps/api && bun test

lint:
	cd apps/web && bun run lint

# ── Data pipeline ─────────────────────────────────────────────────────────────
crawl:
	cd apps/api && bun run src/orchestrator/index.ts

crawl\:source:
	@if [ -z "$(SRC)" ]; then echo "Usage: make crawl:source SRC=mnre"; exit 1; fi
	cd apps/api && SRC=$(SRC) bun run src/orchestrator/index.ts

# ── Docker ───────────────────────────────────────────────────────────────────
docker\:up:
	docker compose up -d --build

docker\:down:
	docker compose down

docker\:logs:
	docker compose logs -f

docker\:crawl:
	docker compose exec api bun run src/orchestrator/index.ts

# ── Port cleanup (dev helper) ────────────────────────────────────────────────
kill\:ports:
	-lsof -i :3005 -i :3006 | awk 'NR>1{print $$2}' | sort -u | xargs kill -9
