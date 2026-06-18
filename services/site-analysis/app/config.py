"""Configuration + pinned constants — the single home for every value the engine
depends on, mirroring apps/api/src/services/analysis/constants.ts (the parity
source of truth). RUNBOOK_v3 sec 7 asks for a startup SHA assertion of
constants.ts + score.ts once the engine is ported.

NOTE: the score normalization BREAKPOINTS are NOT here — they live in score.ts
(v2 India-calibrated) and are reproduced in app/engine/score.py, exactly as the
legacy splits config across constants.ts (weights/bands) and score.ts (breakpoints).
"""
from __future__ import annotations

import os
from pathlib import Path

# ── Environment-driven runtime settings ─────────────────────────────────────

# Legacy data dir (apps/api/data), mounted read-only in Docker at /app/data.
DATA_DIR = Path(os.environ.get("ANALYSIS_DATA_DIR", "/app/data"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Restart-free cutover toggle, read per request (RUNBOOK_v3 sec 2.7). Express owns
# the real switch; this is the service-side default.
SITE_ANALYSIS_BACKEND = os.environ.get("SITE_ANALYSIS_BACKEND", "legacy")

# ── Version & sampling (constants.ts:12-19) ─────────────────────────────────

ANALYSIS_VERSION = "10.1.0"
ANALYSIS_ZOOM = 10

# ── GWA TiTiler (constants.ts:22-34) ────────────────────────────────────────

GWA_TILER_BASE = os.environ.get(
    "GWA_TILER_BASE", "https://tiles-stag.ramtt.xyz/titiler/gwa4"
)
# camelCase response key -> GWA layer name. Units: cf fractions 0-1 (clamp >=0),
# ws m/s, pd W/m^2, rix ruggedness fraction (NaN over flat -> treat as 0), elev m.
GWA_LAYERS = {
    "cfIec3": "cf_iec3",
    "cfIec2": "cf_iec2",
    "ws50": "ws_mean_hgt50m",
    "ws100": "ws_mean_hgt100m",
    "ws150": "ws_mean_hgt150m",
    "pd100": "pd_mean_hgt100m",
    "rix": "rix",
    "elevation": "elevation",
}

# ── AOI validation caps (constants.ts:38-47) ────────────────────────────────

AOI_MAX_KM2 = 2_500
AOI_MIN_KM2 = 1
AOI_MAX_VERTICES = 100
# India bbox — matches the wind-atlas bake extent. [W, S, E, N].
INDIA_BBOX: tuple[float, float, float, float] = (67.0, 6.0, 98.0, 38.0)
# Point mode: a click becomes this square, built client- AND server-side.
POINT_MODE_SQUARE_KM = 5

# ── Budgets & cache (constants.ts:49-60) ────────────────────────────────────

ANALYSIS_BUDGET_MS = 15_000
GWA_TILE_TIMEOUT_MS = 8_000
# Result-cache geometry canonicalization decimals (~11 cm) before hashing.
GEOMETRY_HASH_DECIMALS = 6

# ── Sizing assumptions (constants.ts:62-70) — echoed in every response ───────

SIZING_MW_PER_KM2 = 5
SIZING_USABLE_LAND_FRACTION = 0.7
SIZING_ASSUMPTIONS = [
    "5 MW/km² density",
    "0.7 usable-land fraction",
    "IEC-III capacity factor",
    "existing wind-farm area excluded",
]

# ── Score weights (constants.ts:72-78) — confidence NEVER feeds the score ────

SCORE_WEIGHTS = {"resource": 45, "cf": 25, "grid": 20, "terrain": 10}

# ── Mast validation distance rules, km (constants.ts:80-83) ─────────────────

MAST_DELTA_MAX_KM = 25
MAST_CONFIDENCE_HIGH_KM = 20
MAST_CONFIDENCE_HIGH_COUNT = 2

# ── Site-class banding on AOI mean speed @100 m (constants.ts:85-90) ────────

SITE_CLASS_BANDS = {"excellent": 8, "good": 7, "moderate": 6}

# ── Concurrency (CURRENT_STATE.md sec 1) ────────────────────────────────────

MAX_CONCURRENT_ANALYSES = 4

# ── Local data artifacts (resolved under DATA_DIR) ──────────────────────────

WEIBULL_COG_DIR = "data/gwa"
WEIBULL_A_FILE = "IND_combined-Weibull-A_100m.tif"   # EPSG:4326-by-assumption
WEIBULL_K_FILE = "IND_combined-Weibull-k_100m.tif"
WEIBULL_A_PATH = DATA_DIR / "gwa" / WEIBULL_A_FILE
WEIBULL_K_PATH = DATA_DIR / "gwa" / WEIBULL_K_FILE
INDIA_CDF_PATH = DATA_DIR / "analysis" / "india-ws100-cdf.json"   # 101 quantiles
STATES_GEOJSON_PATH = DATA_DIR / "cache" / "india_states.geojson"  # ST_NM
FARMS_GEOJSON_PATH = DATA_DIR / "private" / "boundaries.geojson"

# ── Climate section feature flag (constants.ts:101-103) — OFF by default ────

CLIMATE_SECTION_ENABLED = os.environ.get("CLIMATE_SECTION_ENABLED") == "true"
