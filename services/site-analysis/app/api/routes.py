"""Routes. Spatial routes are synchronous `def` so FastAPI runs them in the
threadpool — blocking rasterio/shapely/numpy must never run in `async def`
(RUNBOOK_v3 §2.5). Auth stays in the Express layer; this service is internal-only
(§2.6), so no Pro gate here.

POST /analyze is a verbatim port of apps/api/src/routes/analyze.ts, MINUS the
auth + rate-limit + BOTH 429s (the Pro gate, the per-user flood limiter, and the
server-wide cache-miss concurrency 429), which stay in the Express edge that
proxies an already-authorized request here (RUNBOOK_v3 §2.6). The error mapping,
the cache HIT/MISS header, and the res.json-exact serialization are reproduced
1:1.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request, Response

from .. import health
from ..engine.geometry import validate_aoi, validate_analyze_request
from ..engine.pipeline import analyze_aoi
from ..engine.result_cache import (
    get_cached_result,
    put_cached_result,
    result_cache_key,
)
from ..engine.types import GeometryError, ValidatedAoi
from ..models import AnalysisError, AnalysisResponse
from ..serialize import js_dumps

logger = logging.getLogger(__name__)

router = APIRouter()

# analyze.ts:60-61 — the request-structure-check 400 body (verbatim string/code).
INVALID_GEOMETRY_BODY = {
    "error": "request body must be { geometry: GeoJSON Polygon }",
    "code": "INVALID_GEOMETRY",
}
# analyze.ts:72,112 — the catch-all 500 body (never leaks internals).
ANALYSIS_FAILED_BODY = {"error": "Analysis failed"}

CACHE_HEADER = "X-Analysis-Cache"
JSON_MEDIA_TYPE = "application/json"


def _json_response(body: Any, status_code: int = 200, headers: dict | None = None) -> Response:
    """Serialize ``body`` through ``js_dumps`` (Express ``res.json`` parity:
    non-finite -> null, integer-valued floats -> no ``.0``, compact) and return a
    raw Response — NOT FastAPI's JSONResponse, which would emit ``NaN``/``8.0``."""
    return Response(
        content=js_dumps(body),
        status_code=status_code,
        media_type=JSON_MEDIA_TYPE,
        headers=headers,
    )


@router.get("/health")
def health_route(response: Response) -> dict:
    body = health.run_health()
    if body["status"] != "healthy":
        response.status_code = 503
    return body


@router.post(
    "/analyze",
    response_model=AnalysisResponse,
    responses={
        400: {"model": AnalysisError, "description": "Invalid geometry"},
        500: {"model": AnalysisError, "description": "Unexpected analysis fault"},
    },
)
async def analyze_route(request: Request) -> Response:
    """POST /analyze — site screening for a validated AOI (plan §3).

    `async def` to read the raw request body without blocking the event loop, then
    the CPU/IO-heavy ``analyze_aoi`` is dispatched to the threadpool (it is itself
    a synchronous, thread-based pipeline). Read the JSON body manually so a
    malformed/non-JSON body maps to the contract's 400 rather than FastAPI's 422.

    Error contract (analyze.ts:55-113):
      - request-structure check fails  -> 400 {error, code: "INVALID_GEOMETRY"}
      - validate_aoi raises GeometryError -> 400 {error: e.message, code: e.code}
      - any unexpected fault           -> 500 {error: "Analysis failed"} (logged)
    Section failures NEVER reach here — they degrade to "unavailable" inside
    analyze_aoi (plan §2.8). A 500 means an infrastructure fault and the body
    never leaks internals; full context goes to the server log only.
    """
    aoi: ValidatedAoi
    try:
        body = await _read_json_body(request)
        # analyze.ts:57-64 — analyzeRequestSchema.safeParse; on failure, 400.
        if not validate_analyze_request(body):
            return _json_response(INVALID_GEOMETRY_BODY, status_code=400)
        # analyze.ts:65 — validateAoi(parsed.data.geometry).
        aoi = validate_aoi(body["geometry"])
    except GeometryError as err:
        # analyze.ts:66-69 — machine-readable 400.
        return _json_response({"error": err.message, "code": err.code}, status_code=400)
    except Exception:  # noqa: BLE001 — analyze.ts:70-73 geometry validation crash.
        logger.exception("[analyze] geometry validation crashed")
        return _json_response(ANALYSIS_FAILED_BODY, status_code=500)

    try:
        # analyze.ts:77-83 — cache lookup. HIT -> serve cached body + HIT header.
        cache_key = result_cache_key(aoi)
        cached = get_cached_result(cache_key)
        if cached is not None:
            return _json_response(cached, headers={CACHE_HEADER: "HIT"})

        # analyze.ts:85-98 — the server-wide cache-miss concurrency 429 (slot
        # gate) is NOT reproduced here: it stays in the Express edge (RUNBOOK_v3
        # §2.6). This service trusts the proxy to have already throttled.
        response = analyze_aoi(aoi)

        # analyze.ts:105-107 — fire-and-forget cache write; a write failure is
        # logged inside put_cached_result and never delays/fails the response.
        put_cached_result(cache_key, response)
        return _json_response(response, headers={CACHE_HEADER: "MISS"})
    except Exception:  # noqa: BLE001 — analyze.ts:110-113 catch-all.
        logger.exception("[analyze] failed")
        return _json_response(ANALYSIS_FAILED_BODY, status_code=500)


async def _read_json_body(request: Request) -> Any:
    """Read + parse the JSON request body, returning ``None`` for an empty or
    non-JSON body so ``validate_analyze_request`` rejects it into the contract's
    400 (analyze.ts treats a body that fails the zod schema as INVALID_GEOMETRY —
    never a framework 422)."""
    raw = await request.body()
    if not raw:
        return None
    import json

    try:
        return json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return None
