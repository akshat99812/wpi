"""result_cache.py tests — key determinism, round-trip, corrupt-entry
self-healing, and best-effort write resilience. Verbatim port of
apps/api/src/services/analysis/resultCache.test.ts.

Each test runs against an isolated tmp TILE_CACHE_DIR (same seam test_tiles.py
uses), pointed via monkeypatch after import.
"""
from __future__ import annotations

import re

import pytest

from app.config import ANALYSIS_VERSION
from app.engine.result_cache import (
    get_cached_result,
    put_cached_result,
    result_cache_key,
)
from app.engine.types import ValidatedAoi

MD5_HEX_LENGTH = 32
_MD5_HEX_RE = re.compile(rf"^[0-9a-f]{{{MD5_HEX_LENGTH}}}$")


def make_aoi(**overrides) -> ValidatedAoi:
    """Mirror of resultCache.test.ts ``makeAoi``: a ValidatedAoi built directly
    (the ring is already 6-dp canonical, so it hashes verbatim)."""
    fields = {
        "ring": [
            (77.5, 8.2),
            (77.6, 8.2),
            (77.6, 8.3),
            (77.5, 8.3),
            (77.5, 8.2),
        ],
        "area_km2": 25.0,
        "centroid": (77.55, 8.25),
        "bbox": (77.5, 8.2, 77.6, 8.3),
        "is_point_mode": False,
    }
    fields.update(overrides)
    return ValidatedAoi(**fields)


def make_response() -> dict:
    """Mirror of resultCache.test.ts ``makeResponse`` — the camelCase wire dict."""
    return {
        "analysisVersion": ANALYSIS_VERSION,
        "aoi": {"areaKm2": 25, "centroid": [77.55, 8.25], "isPointMode": False},
        "score": {"value": 0, "confidence": "low", "components": []},
        "sections": {
            "resource": {"status": "unavailable", "data": None},
            "climate": {"status": "unavailable", "data": None},
            "validation": {"status": "unavailable", "data": None},
            "grid": {"status": "unavailable", "data": None},
            "context": {"status": "unavailable", "data": None},
        },
    }


@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    """Per-test tmp cache dir, exported via TILE_CACHE_DIR (resolve_cache_base_dir
    reads it per call). RESULT_CACHE_MAX_MB is restored automatically by
    monkeypatch teardown."""
    d = tmp_path / "analysis-cache-test"
    d.mkdir()
    monkeypatch.setenv("TILE_CACHE_DIR", str(d))
    monkeypatch.delenv("RESULT_CACHE_MAX_MB", raising=False)
    return d


def test_result_cache_key_is_stable_md5_hex_for_identical_aois(cache_dir):
    # Arrange
    aoi_a = make_aoi()
    aoi_b = make_aoi()

    # Act
    key_a = result_cache_key(aoi_a)
    key_b = result_cache_key(aoi_b)

    # Assert
    assert key_a == key_b
    assert _MD5_HEX_RE.match(key_a)


def test_result_cache_key_changes_when_the_ring_changes(cache_dir):
    # Arrange
    base = make_aoi()
    shifted = make_aoi(ring=[(lon + 0.01, lat) for (lon, lat) in base.ring])

    # Act / Assert
    assert result_cache_key(shifted) != result_cache_key(base)


def test_returns_none_on_a_cold_miss(cache_dir):
    # Arrange
    key = result_cache_key(make_aoi())

    # Act / Assert
    assert get_cached_result(key) is None


def test_round_trips_a_response_through_put_and_get(cache_dir):
    # Arrange
    key = result_cache_key(make_aoi())
    response = make_response()

    # Act
    put_cached_result(key, response)
    cached = get_cached_result(key)

    # Assert
    assert cached == response


def test_treats_unparseable_json_as_a_miss_and_deletes_the_file(cache_dir):
    # Arrange: hand-plant garbage where the entry would live.
    key = result_cache_key(make_aoi())
    entry_dir = cache_dir / "analysis" / key[:2]
    entry_path = entry_dir / f"{key}.json"
    entry_dir.mkdir(parents=True, exist_ok=True)
    entry_path.write_text("{ not json", encoding="utf-8")

    # Act
    cached = get_cached_result(key)

    # Assert: miss, and the corrupt file is gone.
    assert cached is None
    assert list(entry_dir.iterdir()) == []


def test_treats_valid_json_with_the_wrong_shape_as_a_miss_and_deletes_it(cache_dir):
    # Arrange
    import json

    key = result_cache_key(make_aoi())
    entry_dir = cache_dir / "analysis" / key[:2]
    entry_path = entry_dir / f"{key}.json"
    entry_dir.mkdir(parents=True, exist_ok=True)
    entry_path.write_text(json.dumps({"hello": "world"}), encoding="utf-8")

    # Act
    cached = get_cached_result(key)

    # Assert
    assert cached is None
    assert list(entry_dir.iterdir()) == []


def test_refuses_new_writes_when_the_namespace_size_cap_is_already_exceeded(
    cache_dir, monkeypatch
):
    # Arrange — cap (~105 bytes) smaller than any serialized response
    monkeypatch.setenv("RESULT_CACHE_MAX_MB", "0.0001")
    key = result_cache_key(make_aoi())

    # Act
    put_cached_result(key, make_response())

    # Assert — write skipped, so the entry never lands on disk
    assert get_cached_result(key) is None


def test_counts_pre_existing_entries_on_disk_toward_the_size_cap(cache_dir, monkeypatch):
    # Arrange — cap ~1049 bytes; pre-plant a 1000-byte foreign entry so the
    # seeding scan pushes the ledger near the cap before the first write.
    monkeypatch.setenv("RESULT_CACHE_MAX_MB", "0.001")
    planted_dir = cache_dir / "analysis" / "aa"
    planted_dir.mkdir(parents=True, exist_ok=True)
    (planted_dir / "planted.json").write_text("x" * 1000, encoding="utf-8")
    key = result_cache_key(make_aoi())

    # Act
    put_cached_result(key, make_response())

    # Assert
    assert get_cached_result(key) is None


def test_writes_normally_when_the_namespace_is_under_the_size_cap(cache_dir, monkeypatch):
    # Arrange — generous cap
    monkeypatch.setenv("RESULT_CACHE_MAX_MB", "10")
    key = result_cache_key(make_aoi())
    response = make_response()

    # Act
    put_cached_result(key, response)

    # Assert
    assert get_cached_result(key) == response


def test_put_cached_result_never_raises_even_when_the_cache_dir_is_unwritable(
    cache_dir, monkeypatch
):
    # Arrange: point the cache at a path that is a FILE, so mkdir fails.
    blocker_path = cache_dir / "blocker"
    blocker_path.write_text("x", encoding="utf-8")
    monkeypatch.setenv("TILE_CACHE_DIR", str(blocker_path))

    # Act / Assert: returns None (logged internally), never raises.
    assert put_cached_result(result_cache_key(make_aoi()), make_response()) is None
