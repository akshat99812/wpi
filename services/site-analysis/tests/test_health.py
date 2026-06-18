"""Phase-2 smoke tests (no DB/raster needed for root + the analyze stub)."""
from fastapi.testclient import TestClient
from app.main import app


def test_root() -> None:
    r = TestClient(app).get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "site-analysis"


def test_analyze_not_implemented() -> None:
    r = TestClient(app).post("/analyze")
    assert r.status_code == 501
