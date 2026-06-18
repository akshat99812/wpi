"""climate.py tests — NO network, ever: CLIMATE_SECTION_ENABLED is off in this
environment by design (VERIFIED.md §3), so compute_climate must raise before any
fetch. Everything network-shaped is exercised through the pure exports (gate,
aggregators, response validation, cache key, disk cache).

Faithful port of apps/api/src/services/analysis/climate.test.ts. The TS test
injects a synthetic fetch spy (counter) and points TILE_CACHE_DIR at a tmp dir;
those seams are mirrored here as a Python callable + monkeypatched env var.

Parity note on the disabled-path test: the legacy reads CLIMATE_SECTION_ENABLED
and OPEN_METEO_API_KEY at call time via the module constant / process.env. The
Python port resolves CLIMATE_SECTION_ENABLED at import; this test patches the
module constant directly so the "flag off" path is exercised deterministically
regardless of the ambient env.
"""
from __future__ import annotations

import json
import os

import pytest

from app import config
from app.engine import climate
from app.engine.climate import (
    ClimateDisabledError,
    ClimateGateInput,
    ClimateHourSample,
    ROSE_SECTOR_NAMES,
    aggregate_climate,
    aggregate_diurnal,
    aggregate_monthly,
    aggregate_rose,
    assert_climate_enabled,
    climate_cache_key,
    compute_climate,
    get_cached_climate,
    parse_hourly_samples,
    put_cached_climate,
    round_coord_to_bucket,
    sector_index_for,
)

MD5_HEX_LENGTH = 32
HOURS_IN_2024 = 8784  # leap year
DAYS_IN_MONTH_2024 = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def build_year_samples(make) -> list[ClimateHourSample]:
    """Build a full synthetic 2024 of hourly samples (8784) without Date math.
    ``make(hour_index, month_idx, hour) -> (speed, direction)``."""
    samples: list[ClimateHourSample] = []
    hour_index = 0
    for month_idx, days in enumerate(DAYS_IN_MONTH_2024):
        mm = f"{month_idx + 1:02d}"
        for day in range(1, days + 1):
            dd = f"{day:02d}"
            for hour in range(24):
                hh = f"{hour:02d}"
                speed, direction = make(hour_index, month_idx, hour)
                samples.append(
                    ClimateHourSample(
                        time=f"2024-{mm}-{dd}T{hh}:00",
                        speed=speed,
                        direction=direction,
                    )
                )
                hour_index += 1
    return samples


def sample_at(speed, direction, time="2024-06-15T12:00") -> ClimateHourSample:
    """Tiny hand-built sample with a fixed timestamp (aggregator unit cases)."""
    return ClimateHourSample(time=time, speed=speed, direction=direction)


def payload_from_samples(samples) -> dict:
    """Open-Meteo-shaped payload from a sample array (parse round-trip tests)."""
    return {
        "latitude": 8.25,
        "longitude": 77.55,
        "timezone": "Asia/Kolkata",
        "hourly": {
            "time": [s.time for s in samples],
            "wind_speed_100m": [s.speed for s in samples],
            "wind_direction_100m": [s.direction for s in samples],
        },
    }


# ── Gating ──────────────────────────────────────────────────────────────────


def test_environment_precondition_flag_off():
    # The whole no-network test strategy rests on this (VERIFIED.md §3).
    assert config.CLIMATE_SECTION_ENABLED is False
    assert climate.CLIMATE_SECTION_ENABLED is False


def test_compute_climate_raises_disabled_and_never_calls_fetch_when_flag_off(monkeypatch):
    # Arrange — guarantee the flag-off path regardless of ambient env.
    monkeypatch.setattr(climate, "CLIMATE_SECTION_ENABLED", False)
    fetch_calls = {"n": 0}

    def fetch_spy(url, headers):
        fetch_calls["n"] += 1

        class _R:
            ok = True
            status = 200

            @staticmethod
            def json():
                return {}

        return _R()

    # Act / Assert
    with pytest.raises(ClimateDisabledError):
        compute_climate([77.55, 8.26], fetch_impl=fetch_spy)
    assert fetch_calls["n"] == 0


def test_assert_climate_enabled_throws_when_flag_off():
    with pytest.raises(ClimateDisabledError):
        assert_climate_enabled(ClimateGateInput(is_flag_enabled=False, api_key="key-present"))


def test_assert_climate_enabled_throws_when_flag_on_but_key_missing():
    with pytest.raises(ClimateDisabledError):
        assert_climate_enabled(ClimateGateInput(is_flag_enabled=True, api_key=None))


def test_assert_climate_enabled_treats_empty_key_as_missing():
    with pytest.raises(ClimateDisabledError):
        assert_climate_enabled(ClimateGateInput(is_flag_enabled=True, api_key=""))


def test_assert_climate_enabled_returns_key_when_flag_on_and_key_present():
    assert assert_climate_enabled(
        ClimateGateInput(is_flag_enabled=True, api_key="om-key")
    ) == "om-key"


# ── Sector convention ───────────────────────────────────────────────────────


def test_rose_sector_names_is_the_exact_16_wind_compass_in_order():
    assert list(ROSE_SECTOR_NAMES) == [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ]


def test_sector_index_for_centers_sectors_with_half_up_edges():
    # N spans 348.75-11.25; JS Math.round(.5) rounds UP, so the upper edge of
    # every sector belongs to the NEXT sector.
    assert sector_index_for(0) == 0  # N center
    assert sector_index_for(11.24) == 0  # just under the edge -> N
    assert sector_index_for(11.25) == 1  # edge itself -> NNE (round half up)
    assert sector_index_for(348.74) == 15  # NNW side of the wrap
    assert sector_index_for(348.75) == 0  # wraps via % 16 -> N
    assert sector_index_for(360) == 0
    assert sector_index_for(270) == 12  # W center
    assert sector_index_for(281.24) == 12  # W upper interior
    assert sector_index_for(281.25) == 13  # -> WNW


def test_sector_index_for_normalizes_out_of_range_defensively():
    assert sector_index_for(-90) == 12  # -90 ≡ 270 -> W
    assert sector_index_for(630) == 12  # 630 ≡ 270 -> W


# ── aggregate_rose ──────────────────────────────────────────────────────────


def test_full_year_all_from_270_at_8ms_gives_west_100_pct():
    # Arrange
    samples = build_year_samples(lambda *_: (8, 270))
    assert len(samples) == HOURS_IN_2024

    # Act
    rose = aggregate_rose(samples)

    # Assert
    assert len(rose) == 16
    west = rose[12]
    assert west.sector == "W"
    assert west.freqPct == 100
    assert west.meanSpeed == 8
    for i, sector in enumerate(rose):
        if i == 12:
            continue
        assert sector.freqPct == 0
        assert sector.meanSpeed == 0


def test_two_lobed_year_splits_50_50_with_per_sector_means():
    # Arrange: alternate E @ 4 m/s and W @ 8 m/s (bimodal monsoon shape).
    samples = build_year_samples(
        lambda i, *_: (4, 90) if i % 2 == 0 else (8, 270)
    )

    # Act
    rose = aggregate_rose(samples)

    # Assert
    assert rose[4].sector == "E"
    assert rose[4].freqPct == 50
    assert rose[4].meanSpeed == 4
    assert rose[12].freqPct == 50
    assert rose[12].meanSpeed == 8


def test_freq_pct_is_relative_to_valid_hours():
    # Arrange: 2 valid N hours + 1 null-speed + 1 null-direction.
    samples = [
        sample_at(5, 0),
        sample_at(7, 359),
        sample_at(None, 0),
        sample_at(6, None),
    ]

    # Act
    rose = aggregate_rose(samples)

    # Assert: denominator is 2, not 4.
    assert rose[0].freqPct == 100
    assert rose[0].meanSpeed == 6


def test_freq_pct_rounds_1dp_and_mean_speed_2dp():
    # Arrange: speeds 1, 2, 2 in N + one E.
    samples = [sample_at(1, 0), sample_at(2, 0), sample_at(2, 0), sample_at(9, 90)]

    # Act
    rose = aggregate_rose(samples)

    # Assert: 3/4 = 75%, 1/4 = 25%; mean (1+2+2)/3 = 1.6667 -> 1.67.
    assert rose[0].freqPct == 75
    assert rose[0].meanSpeed == 1.67
    assert rose[4].freqPct == 25
    # Thirds case for freqPct 1 dp: 2 of 3 valid hours -> 66.7.
    thirds = aggregate_rose([sample_at(5, 0), sample_at(5, 0), sample_at(5, 90)])
    assert thirds[0].freqPct == 66.7
    assert thirds[4].freqPct == 33.3


def test_all_invalid_input_yields_all_zero_rose_never_nan():
    rose = aggregate_rose([sample_at(None, None), sample_at(float("nan"), 10)])
    for sector in rose:
        assert sector.freqPct == 0
        assert sector.meanSpeed == 0


# ── aggregate_monthly / aggregate_diurnal ───────────────────────────────────


def test_monthly_means_follow_the_month_of_the_local_timestamp():
    # Arrange: speed = month_index + 1 for every hour of that month.
    samples = build_year_samples(lambda _i, month_idx, _h: (month_idx + 1, 270))

    # Act / Assert
    assert aggregate_monthly(samples) == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]


def test_monthly_means_skip_null_speed_and_report_0_for_empty_month():
    # Arrange: February entirely null; March mixes 4 and null (null skipped).
    def make(i, month_idx, _h):
        if month_idx == 1:
            return (None, 270)
        if month_idx == 2:
            return (4 if i % 2 == 0 else None, 270)
        return (6, 270)

    samples = build_year_samples(make)

    # Act
    monthly = aggregate_monthly(samples)

    # Assert
    assert monthly[0] == 6
    assert monthly[1] == 0  # empty slot convention — never NaN
    assert monthly[2] == 4  # nulls skipped, not averaged as zeros


def test_monthly_means_round_to_2dp():
    # Arrange: January hours alternate 1 and 2 with one extra 1 (odd count).
    samples = [
        sample_at(1, 0, "2024-01-01T00:00"),
        sample_at(1, 0, "2024-01-01T01:00"),
        sample_at(2, 0, "2024-01-01T02:00"),
    ]

    # Act / Assert: (1+1+2)/3 = 1.3333 -> 1.33.
    assert aggregate_monthly(samples)[0] == 1.33


def test_diurnal_means_group_by_the_local_hour_of_the_timestamp():
    # Arrange: speed = hour × 0.5 (diurnal ramp).
    samples = build_year_samples(lambda _i, _m, hour: (hour * 0.5, 180))

    # Act
    diurnal = aggregate_diurnal(samples)

    # Assert
    assert len(diurnal) == 24
    for hour, mean in enumerate(diurnal):
        assert mean == hour * 0.5


def test_aggregate_climate_composes_rose16_monthly12_diurnal24():
    # Arrange
    samples = build_year_samples(lambda *_: (8, 270))

    # Act
    data = aggregate_climate(samples)

    # Assert
    assert len(data.rose) == 16
    assert len(data.monthly) == 12
    assert len(data.diurnal) == 24
    assert data.rose[12].freqPct == 100
    assert all(m == 8 for m in data.monthly)
    assert all(h == 8 for h in data.diurnal)


# ── parse_hourly_samples (strict response validation) ───────────────────────


def test_parses_a_healthy_full_year_payload_preserving_nulls():
    # Arrange
    source = build_year_samples(
        lambda i, *_: (None, None) if i == 100 else (7.5, 250)
    )

    # Act
    samples = parse_hourly_samples(payload_from_samples(source))

    # Assert
    assert len(samples) == HOURS_IN_2024
    assert samples[100].speed is None
    assert samples[100].direction is None
    assert samples[0].speed == 7.5
    assert samples[0].time == "2024-01-01T00:00"


def test_throws_on_the_open_meteo_error_envelope_surfacing_the_reason():
    with pytest.raises(ValueError, match="API key invalid"):
        parse_hourly_samples({"error": True, "reason": "API key invalid"})


def test_throws_when_the_hourly_block_is_missing():
    with pytest.raises(ValueError, match="hourly"):
        parse_hourly_samples({"latitude": 8.25})


def test_throws_on_hourly_array_length_mismatch():
    # Arrange
    source = build_year_samples(lambda *_: (7, 200))
    payload = payload_from_samples(source)
    truncated = {
        **payload,
        "hourly": {
            **payload["hourly"],
            "wind_speed_100m": payload["hourly"]["wind_speed_100m"][:-1],
        },
    }

    # Act / Assert
    with pytest.raises(ValueError, match="length mismatch"):
        parse_hourly_samples(truncated)


def test_throws_when_the_year_is_short_of_8760_hours():
    short = build_year_samples(lambda *_: (7, 200))[:8000]
    with pytest.raises(ValueError, match="full year"):
        parse_hourly_samples(payload_from_samples(short))


def test_throws_on_non_finite_or_non_numeric_values():
    # Arrange
    source = build_year_samples(lambda *_: (7, 200))
    base = payload_from_samples(source)
    with_string = {
        "hourly": {
            **base["hourly"],
            "wind_speed_100m": ["7.0", *base["hourly"]["wind_speed_100m"][1:]],
        }
    }
    with_infinity = {
        "hourly": {
            **base["hourly"],
            "wind_direction_100m": [
                float("inf"),
                *base["hourly"]["wind_direction_100m"][1:],
            ],
        }
    }

    # Act / Assert
    with pytest.raises(ValueError, match="finite-or-null"):
        parse_hourly_samples(with_string)
    with pytest.raises(ValueError, match="finite-or-null"):
        parse_hourly_samples(with_infinity)


def test_throws_on_malformed_timestamps():
    source = build_year_samples(lambda *_: (7, 200))
    base = payload_from_samples(source)
    bad_time = {
        "hourly": {
            **base["hourly"],
            "time": ["2024-13-01T00:00", *base["hourly"]["time"][1:]],
        }
    }
    with pytest.raises(ValueError, match="local-time stamp"):
        parse_hourly_samples(bad_time)


def test_throws_when_the_body_is_not_an_object():
    with pytest.raises(ValueError, match="not a JSON object"):
        parse_hourly_samples("nope")


# ── Cache key (0.05° bucketing) ─────────────────────────────────────────────


def test_round_coord_to_bucket_snaps_to_nearest_005_with_stable_2dp_strings():
    # 77.5499 and 77.5501 both sit within ±0.025 of 77.55 -> SAME bucket.
    assert round_coord_to_bucket(77.5499) == "77.55"
    assert round_coord_to_bucket(77.5501) == "77.55"
    # Bucket edge is at 77.575: below stays at 77.55, at/above goes to 77.60.
    assert round_coord_to_bucket(77.5749) == "77.55"
    assert round_coord_to_bucket(77.575) == "77.60"  # half-up at the edge
    assert round_coord_to_bucket(77.5751) == "77.60"
    assert round_coord_to_bucket(8.26) == "8.25"


def test_climate_cache_key_identical_for_same_bucket():
    # Arrange / Act
    key_a = climate_cache_key([77.5499, 8.26])
    key_b = climate_cache_key([77.5501, 8.26])

    # Assert: stable md5 hex, equal across the bucket.
    assert key_a == key_b
    assert len(key_a) == MD5_HEX_LENGTH
    assert all(c in "0123456789abcdef" for c in key_a)
    assert climate_cache_key([77.5499, 8.26]) == key_a  # deterministic


def test_climate_cache_key_differs_across_bucket_edges_and_between_lon_lat():
    assert climate_cache_key([77.5749, 8.26]) != climate_cache_key([77.5751, 8.26])
    assert climate_cache_key([77.55, 8.25]) != climate_cache_key([8.25, 77.55])


# ── Disk cache (forever, namespace "climate") ───────────────────────────────


@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    """Point TILE_CACHE_DIR at a fresh tmp dir for the disk-cache cases (the seam
    the legacy test exercises via process.env.TILE_CACHE_DIR)."""
    d = tmp_path / "climate-cache-test"
    d.mkdir()
    monkeypatch.setenv("TILE_CACHE_DIR", str(d))
    return d


def _make_data():
    return aggregate_climate(build_year_samples(lambda *_: (8, 270)))


def test_cold_miss_returns_none(cache_dir):
    assert get_cached_climate(climate_cache_key([77.55, 8.25])) is None


def test_round_trips_aggregated_climate_data_through_put_plus_get(cache_dir):
    # Arrange
    key = climate_cache_key([77.55, 8.25])
    data = _make_data()

    # Act
    put_cached_climate(key, data)
    cached = get_cached_climate(key)

    # Assert
    assert cached == data


def test_treats_unparseable_json_as_a_miss_and_deletes_the_file(cache_dir):
    # Arrange: hand-plant garbage where the entry would live.
    key = climate_cache_key([77.55, 8.25])
    entry_dir = cache_dir / "climate" / key[:2]
    entry_dir.mkdir(parents=True, exist_ok=True)
    (entry_dir / f"{key}.json").write_text("{ not json", encoding="utf-8")

    # Act
    cached = get_cached_climate(key)

    # Assert: miss, and the corrupt file is gone.
    assert cached is None
    assert os.listdir(entry_dir) == []


def test_treats_valid_json_with_wrong_shape_as_a_miss_and_deletes_it(cache_dir):
    # Arrange
    key = climate_cache_key([77.55, 8.25])
    entry_dir = cache_dir / "climate" / key[:2]
    entry_dir.mkdir(parents=True, exist_ok=True)
    (entry_dir / f"{key}.json").write_text(
        json.dumps({"rose": [], "monthly": [], "diurnal": []}), encoding="utf-8"
    )

    # Act
    cached = get_cached_climate(key)

    # Assert
    assert cached is None
    assert os.listdir(entry_dir) == []


def test_put_cached_climate_never_raises_even_when_cache_dir_unwritable(
    cache_dir, monkeypatch
):
    # Arrange: point the cache at a path that is a FILE, so makedirs fails.
    blocker_path = cache_dir / "blocker"
    blocker_path.write_text("x", encoding="utf-8")
    monkeypatch.setenv("TILE_CACHE_DIR", str(blocker_path))

    # Act / Assert: returns (logged internally), never raises.
    assert put_cached_climate(climate_cache_key([77.55, 8.25]), _make_data()) is None
