#!/usr/bin/env python3
"""Phase 0 probe (Task C): ERA5-family climate normals at Muppandal.

Fetches one calendar year of hourly 100 m wind speed + direction from the
Open-Meteo historical/archive API and computes a 16-sector wind rose,
monthly means, diurnal means, and an annual mean. Also attributes which
underlying model the keyless `best_match` endpoint actually serves for
wind_speed_100m, and quantifies the pure-ERA5 (0.25 deg) gap.

LICENSING: the keyless Open-Meteo tier is NON-COMMERCIAL. This script is a
one-off dev probe only. The production climate section stays feature-flagged
off (CLIMATE_SECTION_ENABLED=false) until a commercial key is provisioned.

Run with the web venv python (has numpy):
  /Users/akshatpatel/Desktop/wind/wce/apps/web/scripts/.venv/bin/python3 era5_rose.py

Responses are cached under /tmp/wce-probes so re-runs do not re-hit the API.
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

SITE_NAME = "Muppandal"
LAT = 8.26
LON = 77.55
YEAR = 2024
ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive"
USER_AGENT = "wce-analysis-probe"
LOCAL_TIMEZONE = "Asia/Kolkata"  # diurnal pattern is computed in local time
CACHE_DIR = Path("/tmp/wce-probes")
REQUEST_TIMEOUT_S = 120

SECTOR_NAMES = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]
SECTOR_WIDTH_DEG = 360.0 / len(SECTOR_NAMES)
SW_FAMILY = ("SW", "WSW", "W")
SW_FAMILY_THRESHOLD_PCT = 40.0
EXPECTED_ANNUAL_MEAN_RANGE_MS = (6.0, 10.0)
GWA_EXPECTED_RANGE_MS = (7.0, 9.0)  # GWA ws_mean_hgt100m ballpark at this site
MODEL_MATCH_TOLERANCE_MS = 0.05


def fetch_json(params: dict) -> dict:
    """GET ARCHIVE_BASE with params; cache the JSON response on disk."""
    query = urllib.parse.urlencode(sorted(params.items()))
    cache_key = hashlib.sha1(query.encode()).hexdigest()[:16]
    cache_file = CACHE_DIR / f"openmeteo_{cache_key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    url = f"{ARCHIVE_BASE}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
        body = response.read().decode()
    payload = json.loads(body)
    if "error" in payload and payload.get("error"):
        raise RuntimeError(f"Open-Meteo error: {payload.get('reason', body[:200])}")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(body)
    return payload


def base_params() -> dict:
    return {
        "latitude": LAT,
        "longitude": LON,
        "start_date": f"{YEAR}-01-01",
        "end_date": f"{YEAR}-12-31",
        "wind_speed_unit": "ms",
    }


def fetch_year_default() -> dict:
    """Full-year hourly speed+direction, default (best_match) model, local tz."""
    params = base_params() | {
        "hourly": "wind_speed_100m,wind_direction_100m",
        "timezone": LOCAL_TIMEZONE,
    }
    return fetch_json(params)


def fetch_year_pure_era5_speeds() -> np.ndarray:
    """Full-year hourly speed from the pure ERA5 0.25-degree model (UTC)."""
    params = base_params() | {"hourly": "wind_speed_100m", "models": "era5"}
    payload = fetch_json(params)
    return np.array(payload["hourly"]["wind_speed_100m"], dtype=float)


def attribute_best_match_model() -> str:
    """Empirically identify which model best_match serves for wind_speed_100m.

    The keyless response metadata names no model, so compare one UTC day of
    best_match output against explicitly-requested model series.
    """
    day_params = {
        "latitude": LAT,
        "longitude": LON,
        "start_date": f"{YEAR}-01-01",
        "end_date": f"{YEAR}-01-01",
        "hourly": "wind_speed_100m",
        "wind_speed_unit": "ms",
    }
    default_day = fetch_json(day_params)
    suffixed_day = fetch_json(day_params | {"models": "era5,era5_land,ecmwf_ifs"})

    default_series = np.array(default_day["hourly"]["wind_speed_100m"], dtype=float)
    hourly = suffixed_day["hourly"]
    for model in ("era5", "era5_land", "ecmwf_ifs"):
        series = np.array(
            [np.nan if v is None else v for v in hourly[f"wind_speed_100m_{model}"]],
            dtype=float,
        )
        if np.all(np.isnan(series)):
            continue
        if np.nanmax(np.abs(series - default_series)) <= MODEL_MATCH_TOLERANCE_MS:
            return model
    return "unattributed"


def sector_index(direction_deg: np.ndarray) -> np.ndarray:
    """Compass-convention sector index: N centered on 0, 22.5-deg sectors."""
    half_width = SECTOR_WIDTH_DEG / 2.0
    shifted = np.mod(direction_deg + half_width, 360.0)
    return (shifted // SECTOR_WIDTH_DEG).astype(int) % len(SECTOR_NAMES)


def compute_rose(speeds: np.ndarray, directions: np.ndarray) -> list[dict]:
    indices = sector_index(directions)
    total = len(speeds)
    rose = []
    for i, name in enumerate(SECTOR_NAMES):
        mask = indices == i
        count = int(mask.sum())
        mean_speed = float(speeds[mask].mean()) if count else 0.0
        rose.append({
            "sector": name,
            "freqPct": round(100.0 * count / total, 2),
            "meanSpeed": round(mean_speed, 2),
        })
    return rose


def group_means(speeds: np.ndarray, keys: np.ndarray, n_groups: int) -> list[float]:
    return [round(float(speeds[keys == g].mean()), 2) for g in range(n_groups)]


def main() -> None:
    payload = fetch_year_default()
    hourly = payload["hourly"]
    times = hourly["time"]
    raw_speeds = hourly["wind_speed_100m"]
    raw_dirs = hourly["wind_direction_100m"]
    if len(times) != len(raw_speeds) or len(times) != len(raw_dirs):
        raise RuntimeError("hourly array length mismatch")

    speeds_all = np.array([np.nan if v is None else v for v in raw_speeds], dtype=float)
    dirs_all = np.array([np.nan if v is None else v for v in raw_dirs], dtype=float)
    valid = ~np.isnan(speeds_all) & ~np.isnan(dirs_all)
    speeds = speeds_all[valid]
    directions = dirs_all[valid]
    months = np.array([int(t[5:7]) - 1 for t in times])[valid]
    hours = np.array([int(t[11:13]) for t in times])[valid]

    rose = compute_rose(speeds, directions)
    top_sector = max(rose, key=lambda s: s["freqPct"])
    sw_family_pct = round(sum(s["freqPct"] for s in rose if s["sector"] in SW_FAMILY), 2)
    is_sw_dominant = top_sector["sector"] in SW_FAMILY or sw_family_pct > SW_FAMILY_THRESHOLD_PCT

    annual_mean = round(float(speeds.mean()), 2)
    era5_speeds = fetch_year_pure_era5_speeds()
    era5_annual_mean = round(float(np.nanmean(era5_speeds)), 2)
    lo, hi = EXPECTED_ANNUAL_MEAN_RANGE_MS
    is_mean_in_band = lo <= annual_mean <= hi

    result = {
        "site": {"name": SITE_NAME, "lat": LAT, "lon": LON, "year": YEAR},
        "endpoint": ARCHIVE_BASE,
        "responseMeta": {
            "gridLat": payload["latitude"],
            "gridLon": payload["longitude"],
            "elevationM": payload["elevation"],
            "timezone": payload["timezone"],
            "units": payload["hourly_units"],
            "bestMatchModelAttribution": attribute_best_match_model(),
        },
        "sample": {
            "hoursRequested": len(times),
            "hoursValid": int(valid.sum()),
            "annualMeanMs": annual_mean,
            "maxMs": round(float(speeds.max()), 2),
            "isAnnualMeanInExpectedBand": is_mean_in_band,
            "expectedBandMs": list(EXPECTED_ANNUAL_MEAN_RANGE_MS),
        },
        "pureEra5Comparison": {
            "annualMeanMs": era5_annual_mean,
            "gapVsBestMatchMs": round(annual_mean - era5_annual_mean, 2),
            "gwaExpectedRangeMs": list(GWA_EXPECTED_RANGE_MS),
        },
        "rose": rose,
        "topSector": top_sector,
        "swFamilyPct": sw_family_pct,
        "isSwDominant": is_sw_dominant,
        "monthlyMeansMs": group_means(speeds, months, 12),
        "diurnalMeansMs": group_means(speeds, hours, 24),
    }
    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
