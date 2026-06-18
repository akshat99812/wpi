"""FastAPI app entrypoint. Internal-only service; auth + rate-limit + the Pro gate
stay in the Express layer, which proxies an already-authorized request here
(RUNBOOK_v3 §2.6).
"""
from __future__ import annotations
from fastapi import FastAPI
from .api.routes import router

app = FastAPI(title="site-analysis", version="0.1.0")
app.include_router(router)


@app.get("/")
def root() -> dict:
    return {"service": "site-analysis", "status": "scaffold (Phase 2)"}
