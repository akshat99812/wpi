"""Routes. Spatial routes are synchronous `def` so FastAPI runs them in the
threadpool — blocking rasterio/shapely/numpy must never run in `async def`
(RUNBOOK_v3 §2.5). Auth stays in the Express layer; this service is internal-only
(§2.6), so no Pro gate here.
"""
from __future__ import annotations
from fastapi import APIRouter, Response
from .. import health

router = APIRouter()


@router.get("/health")
def health_route(response: Response) -> dict:
    body = health.run_health()
    if body["status"] != "healthy":
        response.status_code = 503
    return body


@router.post("/analyze")
def analyze_route(response: Response) -> dict:
    # Engine port is Phase 3. Phase 2 is scaffold-only.
    response.status_code = 501
    return {"error": "Not implemented - engine port is Phase 3"}
