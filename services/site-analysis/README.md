# site-analysis (FastAPI) — Phase 2 scaffold

Parity-first port of the Express site-analysis engine. See
[`../../MIGRATION/RUNBOOK_v3.md`](../../MIGRATION/RUNBOOK_v3.md) (the plan) and
[`../../MIGRATION/PHASE2_KICKOFF.md`](../../MIGRATION/PHASE2_KICKOFF.md).

**Phase 2 = empty, healthy service wired to the same DB + rasters. No engine logic.**
The engine port is Phase 3.

## Run locally
```
cd services/site-analysis
python3.12 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
ANALYSIS_DATA_DIR="$(cd ../../apps/api/data && pwd)" \
  DATABASE_URL="postgres://wpi:wpi@localhost:5432/wpi" \
  uvicorn app.main:app --port 8000
curl -s localhost:8000/health | python3 -m json.tool
```

## Gate 2
`docker compose up site-analysis` (or the local run above) → `GET /health` returns
`status: healthy` (DB reachable, Weibull COGs open as EPSG:4326, India CDF = 101
quantiles). Sync routes + threadpool + per-thread raster handles in place. No engine
logic. Do NOT start Phase 3 until this is green.
