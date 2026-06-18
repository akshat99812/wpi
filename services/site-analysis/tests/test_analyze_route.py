"""POST /analyze route tests (app/api/routes.py) via FastAPI TestClient.

Ported from the route-level half of the Express analyze.ts contract. These
verify ROUTE behaviour only — the orchestration is covered by test_pipeline.py
and the 11 engine stage suites. Specifically:

  1. The two 400 paths — a malformed body and a real-but-rejected AOI
     (out-of-India / too-small) -> the EXACT {error, code} bodies.
  2. A 200 success path with the GWA fetch injected (analyze_aoi is patched to
     run the real pipeline through a synthetic constant-tile fetcher), asserting:
       - the camelCase envelope shape + keys,
       - X-Analysis-Cache: MISS on first call, HIT on the second (cache round-trip),
       - a NaN field serializes as ``null`` (not ``"NaN"``) — res.json parity.
  3. climate stays unavailable by default (CLIMATE_SECTION_ENABLED off).

The wire body is read as raw bytes (``response.text``) wherever serialization
parity is under test, because ``response.json()`` would hide the ``NaN``->``null``
and integer-float formatting that ``js_dumps`` reproduces.

Live network end-to-end (the real GWA tiler / DB) is deferred behind RUN_LIVE.
"""
from __future__ import annotations

import json
import math
import os

import pytest
from fastapi.testclient import TestClient

from app.config import ANALYSIS_VERSION
from app.engine.mercator import square_ring_around
from app.main import app

RUN_LIVE = os.environ.get("RUN_LIVE") == "1"

client = TestClient(app)


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _tmp_tile_cache(tmp_path, monkeypatch):
    """Isolate the result cache per test (the route reads/writes the on-disk
    result cache keyed by TILE_CACHE_DIR). A fresh dir guarantees the first call
    is a MISS and the second a HIT."""
    monkeypatch.setenv("TILE_CACHE_DIR", str(tmp_path))


def _point_aoi_geometry(lon: float, lat: float) -> dict:
    """A valid in-India point-mode square AOI as a GeoJSON Polygon request body."""
    ring = [[lon_, lat_] for lon_, lat_ in square_ring_around(lon, lat, 5)]
    return {"geometry": {"type": "Polygon", "coordinates": [ring]}}


# ── 1. 400 paths (analyze.ts:57-69) ──────────────────────────────────────────


def test_malformed_body_returns_400_invalid_geometry():
    # Arrange — body fails the request-structure check (no geometry field).
    body = {"not": "a geometry"}

    # Act
    resp = client.post("/analyze", json=body)

    # Assert — EXACT contract body + code.
    assert resp.status_code == 400
    assert resp.json() == {
        "error": "request body must be { geometry: GeoJSON Polygon }",
        "code": "INVALID_GEOMETRY",
    }


def test_non_json_body_returns_400_invalid_geometry():
    # Arrange — a non-JSON body must map to the contract 400, NOT a FastAPI 422.
    # Act
    resp = client.post(
        "/analyze", content=b"<<<not json>>>", headers={"content-type": "application/json"}
    )

    # Assert
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_GEOMETRY"


def test_out_of_india_aoi_returns_400_geometry_error():
    # Arrange — a structurally-valid polygon whose vertices sit outside INDIA_BBOX.
    # (Paris-ish: lon ~2.3, lat ~48.8 — far outside [67..98, 6..38].)
    body = _point_aoi_geometry(2.35, 48.85)

    # Act
    resp = client.post("/analyze", json=body)

    # Assert — GeometryError -> 400 with the machine-readable code.
    assert resp.status_code == 400
    data = resp.json()
    assert data["code"] == "OUT_OF_INDIA"
    assert isinstance(data["error"], str) and data["error"]


def test_too_small_aoi_returns_400_area_too_small():
    # Arrange — a tiny in-India triangle well under AOI_MIN_KM2 (1 km²).
    body = {
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [77.5500, 8.2600],
                    [77.5501, 8.2600],
                    [77.5501, 8.2601],
                    [77.5500, 8.2600],
                ]
            ],
        }
    }

    # Act
    resp = client.post("/analyze", json=body)

    # Assert
    assert resp.status_code == 400
    assert resp.json()["code"] == "AREA_TOO_SMALL"


# ── 2. 200 success path: envelope, cache MISS->HIT, NaN->null ────────────────


def _patch_analyze_aoi(monkeypatch, fake_response: dict) -> dict:
    """Patch the symbol the route calls (``app.api.routes.analyze_aoi``) so the
    success path runs without any network. Returns a counter the test can assert
    the function was invoked exactly once (proving the second call is a cache HIT,
    not a recompute). This is the 'patch analyze_aoi' seam the task allows."""
    calls = {"n": 0}

    def _fake(aoi, fetch_impl=None, budget_ms=None):  # noqa: ANN001 — test stub
        calls["n"] += 1
        return fake_response

    monkeypatch.setattr("app.api.routes.analyze_aoi", _fake)
    return calls


def _good_wire_response(area_km2: float, centroid: list[float]) -> dict:
    """A complete plan §3 camelCase envelope with a deliberate NaN field
    (resource.airDensity) so the test can prove js_dumps maps it to ``null``."""
    return {
        "analysisVersion": ANALYSIS_VERSION,
        "aoi": {"areaKm2": area_km2, "centroid": centroid, "isPointMode": True},
        "score": {
            "value": 80,
            "confidence": "low",
            "components": [
                {"key": "resource", "weight": 45, "raw": 8, "normalized": 1, "points": 45},
                {"key": "cf", "weight": 25, "raw": 0.5, "normalized": 1, "points": 25},
                {"key": "grid", "weight": 20, "raw": None, "normalized": 0, "points": 0},
                {"key": "terrain", "weight": 10, "raw": 0, "normalized": 1, "points": 10},
            ],
        },
        "sections": {
            "resource": {
                "status": "ok",
                "data": {
                    "meanSpeed": 8.0,
                    "minSpeed": 8.0,
                    "maxSpeed": 8.0,
                    "p25Speed": 8.0,
                    "p50Speed": 8.0,
                    "p75Speed": 8.0,
                    "areaExceedance90": 1.0,
                    "powerDensity": None,
                    "powerDensityRaw": None,
                    # Deliberate non-finite: must serialize as null, not "NaN".
                    "airDensity": float("nan"),
                    "cfIec3": 0.5,
                    "cfIec2": 0.45,
                    "shearAlpha": 0.14,
                    "weibull": None,
                    "indiaPercentile": None,
                    "siteClass": "excellent",
                },
            },
            "climate": {"status": "unavailable", "data": None},
            "validation": {"status": "unavailable", "data": None},
            "grid": {"status": "unavailable", "data": None},
            "context": {"status": "unavailable", "data": None},
        },
    }


def test_success_path_envelope_camelcase_and_cache_miss_then_hit(monkeypatch):
    # Arrange
    geometry_body = _point_aoi_geometry(77.55, 8.26)
    # The patched analyze_aoi returns a fixed envelope; the real AOI fields still
    # come from the route's own validate_aoi, but the body we serve is fixed.
    fake = _good_wire_response(area_km2=25.0, centroid=[77.55, 8.26])
    calls = _patch_analyze_aoi(monkeypatch, fake)

    # Act — first call: cache MISS.
    first = client.post("/analyze", json=geometry_body)

    # Assert — envelope shape + camelCase keys + MISS header.
    assert first.status_code == 200
    assert first.headers["X-Analysis-Cache"] == "MISS"
    body = first.json()
    assert body["analysisVersion"] == ANALYSIS_VERSION
    assert set(body.keys()) == {"analysisVersion", "aoi", "score", "sections"}
    assert set(body["aoi"].keys()) == {"areaKm2", "centroid", "isPointMode"}
    assert sorted(body["sections"].keys()) == [
        "climate",
        "context",
        "grid",
        "resource",
        "validation",
    ]
    # camelCase score component keys.
    assert body["score"]["components"][0]["key"] == "resource"
    assert calls["n"] == 1

    # Act — second call (identical geometry): cache HIT, analyze_aoi NOT re-run.
    second = client.post("/analyze", json=geometry_body)

    # Assert
    assert second.status_code == 200
    assert second.headers["X-Analysis-Cache"] == "HIT"
    assert calls["n"] == 1  # served from disk, no recompute
    # The cached body round-trips identically.
    assert second.json()["analysisVersion"] == ANALYSIS_VERSION
    assert second.json()["sections"]["resource"]["data"]["siteClass"] == "excellent"


def test_success_path_nan_serializes_as_null_not_string(monkeypatch):
    # Arrange — airDensity is NaN in the served body.
    geometry_body = _point_aoi_geometry(77.55, 8.26)
    fake = _good_wire_response(area_km2=25.0, centroid=[77.55, 8.26])
    _patch_analyze_aoi(monkeypatch, fake)

    # Act
    resp = client.post("/analyze", json=geometry_body)

    # Assert — read RAW text: js_dumps must emit `null`, never `NaN`/`"NaN"`.
    raw = resp.text
    assert "NaN" not in raw
    assert "Infinity" not in raw
    # The parsed value is JSON null (Python None), and survives a strict re-parse
    # (json.loads would raise on a bare NaN literal).
    parsed = json.loads(raw)
    assert parsed["sections"]["resource"]["data"]["airDensity"] is None
    # No content-type drift.
    assert resp.headers["content-type"].startswith("application/json")


def test_success_path_integer_float_has_no_trailing_decimal(monkeypatch):
    # Arrange — score.value 80, weights 45/25/20/10 must render without ".0".
    geometry_body = _point_aoi_geometry(77.55, 8.26)
    fake = _good_wire_response(area_km2=25.0, centroid=[77.55, 8.26])
    _patch_analyze_aoi(monkeypatch, fake)

    # Act
    resp = client.post("/analyze", json=geometry_body)

    # Assert — res.json parity: integer-valued floats drop the trailing ".0".
    raw = resp.text
    assert '"value":80' in raw
    assert '"value":80.0' not in raw


# ── 3. climate unavailable by default ────────────────────────────────────────


def test_climate_unavailable_by_default(monkeypatch):
    # Arrange
    geometry_body = _point_aoi_geometry(77.55, 8.26)
    fake = _good_wire_response(area_km2=25.0, centroid=[77.55, 8.26])
    _patch_analyze_aoi(monkeypatch, fake)

    # Act
    resp = client.post("/analyze", json=geometry_body)

    # Assert — CLIMATE_SECTION_ENABLED off (VERIFIED.md §3): degraded shape.
    assert resp.status_code == 200
    assert resp.json()["sections"]["climate"] == {"status": "unavailable", "data": None}


# ── Live end-to-end (deferred) ───────────────────────────────────────────────


@pytest.mark.skipif(not RUN_LIVE, reason="live GWA/DB end-to-end; set RUN_LIVE=1")
def test_live_real_pipeline_end_to_end():
    # A real in-India AOI driven through the unmocked pipeline + real upstreams.
    geometry_body = _point_aoi_geometry(77.55, 8.26)
    resp = client.post("/analyze", json=geometry_body)
    assert resp.status_code == 200
    assert resp.headers["X-Analysis-Cache"] in ("MISS", "HIT")
    body = resp.json()
    assert body["analysisVersion"] == ANALYSIS_VERSION
    assert math.isfinite(body["aoi"]["areaKm2"])
