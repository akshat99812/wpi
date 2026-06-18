"""App smoke tests (root + the analyze route wiring).

The Phase-2 ``/analyze`` 501 stub is gone — the engine port (Phase 3) replaced it.
This now smoke-tests that the route is wired and rejects an empty body with the
contract 400 (analyze.ts: a body that fails the request-structure check ->
INVALID_GEOMETRY). Full route behaviour lives in tests/test_analyze_route.py.
"""
from fastapi.testclient import TestClient
from app.main import app


def test_root() -> None:
    r = TestClient(app).get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "site-analysis"


def test_analyze_route_is_wired_and_rejects_empty_body() -> None:
    r = TestClient(app).post("/analyze")
    assert r.status_code == 400
    assert r.json()["code"] == "INVALID_GEOMETRY"
