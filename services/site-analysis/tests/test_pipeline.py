"""analyze_aoi orchestration tests (pipeline.py).

Ported from apps/api/src/services/analysis/index.test.ts. Verifies the plan §3
envelope shape (camelCase wire keys), score wiring, and the hard degrade rules:
a thrown or over-budget section yields ``{"status": "unavailable", "data": None}``
while the response still resolves.

Offline seam: a synthetic ``fetch_impl`` serves real float32 GeoTIFF tiles
(encoded with rasterio's MemoryFile — the Python analogue of geotiff's
``writeArrayBuffer``); ``TILE_CACHE_DIR`` points at a per-test tmp dir. The
synthetic fetchers mirror the TS ``constantLayerFetcher`` / ``failingFetcher`` /
``slowFetcher``.

CLIMATE_SECTION_ENABLED is off in this environment (VERIFIED.md §3), so the
climate section stays unavailable without ``compute_climate`` ever running —
exactly the flag-off invariant the TS asserts.
"""
from __future__ import annotations

import re
import time
import warnings

import numpy as np
import pytest

from app.config import ANALYSIS_VERSION
from app.engine.geometry import validate_aoi
from app.engine.mercator import TILE_SIZE, square_ring_around
from app.engine.pipeline import analyze_aoi

TILE_PIXELS = TILE_SIZE * TILE_SIZE


# ── Synthetic tile encoding + fetchers (index.test.ts:21-68) ────────────────


def encode_float32_tile(value: float) -> bytes:
    """Encode a constant-value 256×256 float32 GeoTIFF (rasterio analogue of the
    TS ``encodeFloat32Tile`` via geotiff writeArrayBuffer)."""
    from rasterio.errors import NotGeoreferencedWarning
    from rasterio.io import MemoryFile

    arr = np.full((TILE_SIZE, TILE_SIZE), value, dtype=np.float32)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with MemoryFile() as memfile:
            with memfile.open(
                driver="GTiff", width=TILE_SIZE, height=TILE_SIZE, count=1, dtype="float32"
            ) as ds:
                ds.write(arr, 1)
            return memfile.read()


# Constant value served per GWA layer name (plausible good-site numbers).
LAYER_VALUES = {
    "cf_iec3": 0.5,
    "cf_iec2": 0.45,
    "ws_mean_hgt50m": 7.0,
    "ws_mean_hgt100m": 8.0,
    "ws_mean_hgt150m": 8.7,
    "pd_mean_hgt100m": 500,
    "elevation": 100,
}

# Score expected from LAYER_VALUES with the 404-for-power fetcher:
#   resource (8−4.5)/3 = 1.167 → clamp 1 → 45 · cf clamp((0.5−0.12)/0.26)=1
#   → 25 · grid raw null (no power features) → 0 · terrain: flat constant
#   elevation → slope 0° ≤ 5° → normalized 1 → 10 → round(80) = 80.
EXPECTED_SCORE = 80

# GWA tile URL: {base}/gwa4/{layer}/tiles/{z}/{x}/{y}.tif (constants GWA_TILER_BASE
# ends in /gwa4). Match the layer segment between "/" and "/tiles/".
_LAYER_RE = re.compile(r"/([^/]+)/tiles/")


class _FakeResponse:
    """Mirrors the subset of a fetch ``Response`` the tile loader touches."""

    def __init__(self, status: int, body: bytes = b"") -> None:
        self.status = status
        self.ok = 200 <= status < 300
        self._body = body

    def array_buffer(self) -> bytes:
        return self._body


def constant_layer_fetcher(url: str, headers: dict, timeout_ms: int) -> _FakeResponse:
    """Serves the constant LAYER_VALUES tile for whatever layer the URL names.
    Unknown layer → 404 (exercises the all-NaN power path)."""
    match = _LAYER_RE.search(url)
    layer = match.group(1) if match else None
    value = LAYER_VALUES.get(layer) if layer is not None else None
    if value is None:
        return _FakeResponse(404, b"not found")
    return _FakeResponse(200, encode_float32_tile(value))


def failing_fetcher(url: str, headers: dict, timeout_ms: int) -> _FakeResponse:
    return _FakeResponse(503, b"upstream broken")


def slow_fetcher(url: str, headers: dict, timeout_ms: int) -> _FakeResponse:
    """Fetcher slower than the (tiny) test budget."""
    time.sleep(0.25)
    return constant_layer_fetcher(url, headers, timeout_ms)


def muppandal_point_aoi():
    ring = [(lon, lat) for lon, lat in square_ring_around(77.55, 8.26, 5)]
    return validate_aoi({"type": "Polygon", "coordinates": [ring]})


@pytest.fixture(autouse=True)
def _tmp_tile_cache(tmp_path, monkeypatch):
    """Point TILE_CACHE_DIR at a per-test tmp dir (index.test.ts beforeEach)."""
    monkeypatch.setenv("TILE_CACHE_DIR", str(tmp_path))


# ── Tests (index.test.ts:85-207) ────────────────────────────────────────────


def test_returns_full_envelope_climate_stays_flag_off_unavailable():
    # Arrange
    aoi = muppandal_point_aoi()

    # Act
    response = analyze_aoi(aoi, fetch_impl=constant_layer_fetcher)

    # Assert — envelope
    assert response["analysisVersion"] == ANALYSIS_VERSION
    assert response["aoi"] == {
        "areaKm2": aoi.area_km2,
        "centroid": list(aoi.centroid),
        "isPointMode": True,
    }
    assert sorted(response["sections"].keys()) == [
        "climate",
        "context",
        "grid",
        "resource",
        "validation",
    ]
    # CLIMATE_SECTION_ENABLED is off in this environment (VERIFIED.md §3).
    assert response["sections"]["climate"] == {"status": "unavailable", "data": None}
    # The injected fetcher 404s every power-tile URL → grid completes with the
    # all-null degraded shape (an "ok" section: the search ran, found nothing).
    assert response["sections"]["grid"]["status"] == "ok"
    assert response["sections"]["grid"]["data"]["nearestSubstation"] is None
    assert response["sections"]["grid"]["data"]["nearestLine"] is None
    assert response["sections"]["grid"]["data"]["ehvWithin25Km"] is False
    # nearestEhvKm is STRIPPED from the wire grid section (score-only extra).
    assert "nearestEhvKm" not in response["sections"]["grid"]["data"]
    # Validation (live DB) and context (gist/DB loaders degrade internally)
    # depend on the environment — assert shape, not availability.
    assert response["sections"]["validation"]["status"] in ("ok", "unavailable")
    assert response["sections"]["context"]["status"] in ("ok", "unavailable")
    if response["sections"]["context"]["status"] == "ok":
        # Flat constant elevation → terrain present with zero slope.
        assert response["sections"]["context"]["data"]["terrain"]["slopeMeanDeg"] == 0
        assert len(response["sections"]["context"]["data"]["sizing"]["assumptions"]) > 0
        # slope90thDeg is STRIPPED from the wire context section (score-only extra).
        assert "slope90thDeg" not in response["sections"]["context"]["data"]


def test_computes_resource_stats_from_constant_layers():
    # Arrange
    aoi = muppandal_point_aoi()

    # Act
    response = analyze_aoi(aoi, fetch_impl=constant_layer_fetcher)

    # Assert
    assert response["sections"]["resource"]["status"] == "ok"
    data = response["sections"]["resource"]["data"]
    assert data is not None
    assert data["meanSpeed"] == LAYER_VALUES["ws_mean_hgt100m"]
    assert data["minSpeed"] == data["maxSpeed"]  # constant field
    assert data["cfIec3"] == LAYER_VALUES["cf_iec3"]
    assert data["cfIec2"] == LAYER_VALUES["cf_iec2"]
    assert data["siteClass"] == "excellent"


def test_wires_resource_grid_terrain_into_score_confidence_mirrors_validation():
    # Arrange
    aoi = muppandal_point_aoi()

    # Act
    response = analyze_aoi(aoi, fetch_impl=constant_layer_fetcher)

    # Assert — deterministic components first.
    by_key = {c["key"]: c for c in response["score"]["components"]}
    assert by_key["resource"]["raw"] == 8
    assert by_key["resource"]["points"] == pytest.approx(45, abs=0.05)  # (8−4.5)/3 clamps to 1
    assert by_key["cf"]["raw"] == 0.5
    assert by_key["cf"]["points"] == 25
    # 404-everywhere power fetcher → no EHV anywhere → conservative 0.
    assert by_key["grid"] == {
        "key": "grid",
        "weight": 20,
        "raw": None,
        "normalized": 0,
        "points": 0,
    }
    # Terrain depends on the context section completing (env loaders degrade
    # internally but never throw): flat elevation → slope 0 → full points.
    if response["sections"]["context"]["status"] == "ok":
        assert by_key["terrain"] == {
            "key": "terrain",
            "weight": 10,
            "raw": 0,
            "normalized": 1,
            "points": 10,
        }
        assert response["score"]["value"] == EXPECTED_SCORE
    else:
        assert by_key["terrain"]["raw"] is None
    # Confidence mirrors the validation badge (or "low" when unavailable) and
    # NEVER feeds the arithmetic (plan §6).
    expected_confidence = (
        response["sections"]["validation"]["data"]["confidence"]
        if response["sections"]["validation"]["status"] == "ok"
        else "low"
    )
    assert response["score"]["confidence"] == expected_confidence


def test_degrades_resource_to_unavailable_when_every_fetch_fails():
    # Arrange
    aoi = muppandal_point_aoi()

    # Act
    response = analyze_aoi(aoi, fetch_impl=failing_fetcher)

    # Assert — section degraded, response intact, score conservatively null-fed.
    assert response["sections"]["resource"] == {"status": "unavailable", "data": None}
    assert response["score"]["value"] == 0
    assert all(c["raw"] is None for c in response["score"]["components"])


def test_degrades_resource_to_unavailable_when_section_exceeds_budget():
    # Arrange: fetcher slower than the (tiny) test budget.
    aoi = muppandal_point_aoi()

    # Act
    response = analyze_aoi(aoi, fetch_impl=slow_fetcher, budget_ms=20)

    # Assert
    assert response["sections"]["resource"] == {"status": "unavailable", "data": None}
    assert response["score"]["value"] == 0
