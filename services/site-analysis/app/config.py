"""Configuration — mirrors the legacy engine's pinned constants (apps/api/src/
services/analysis/constants.ts). The TS file is the parity source of truth; the
values here MUST match it, and §7 of RUNBOOK_v3 asks for a startup SHA assertion
of constants.ts + score.ts once the engine is ported.
"""
from __future__ import annotations
import os
from pathlib import Path

# Legacy data dir (apps/api/data), mounted read-only in Docker at /app/data.
DATA_DIR = Path(os.environ.get("ANALYSIS_DATA_DIR", "/app/data"))

ANALYSIS_VERSION = "10.1.0"
ANALYSIS_ZOOM = 10
ANALYSIS_BUDGET_MS = 15_000
MAX_CONCURRENT_ANALYSES = 4

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Staging GWA TiTiler (EPSG:3857 float32 tiles, NaN nodata), sampled at z10.
GWA_TILER_BASE = os.environ.get(
    "GWA_TILER_BASE", "https://tiles-stag.ramtt.xyz/titiler/gwa4"
)
GWA_LAYERS = {
    "cfIec3": "cf_iec3", "cfIec2": "cf_iec2",
    "ws50": "ws_mean_hgt50m", "ws100": "ws_mean_hgt100m", "ws150": "ws_mean_hgt150m",
    "pd100": "pd_mean_hgt100m", "rix": "rix", "elevation": "elevation",
}

WEIBULL_A_PATH = DATA_DIR / "gwa" / "IND_combined-Weibull-A_100m.tif"   # EPSG:4326
WEIBULL_K_PATH = DATA_DIR / "gwa" / "IND_combined-Weibull-k_100m.tif"   # EPSG:4326
INDIA_CDF_PATH = DATA_DIR / "analysis" / "india-ws100-cdf.json"        # 101 quantiles
STATES_GEOJSON_PATH = DATA_DIR / "cache" / "india_states.geojson"      # ST_NM
FARMS_GEOJSON_PATH = DATA_DIR / "private" / "boundaries.geojson"

CLIMATE_SECTION_ENABLED = os.environ.get("CLIMATE_SECTION_ENABLED") == "true"

# Restart-free cutover toggle, read per request (RUNBOOK_v3 §2.7). Express owns
# the real switch; this is the service-side default.
SITE_ANALYSIS_BACKEND = os.environ.get("SITE_ANALYSIS_BACKEND", "legacy")
