"""GET /health checks (RUNBOOK_v3 §2.4): DB reachable, Weibull COGs open read-only
as the expected ~0.0025 deg lon/lat grid over India, India CDF parses to 101
quantiles. Each check is reported individually; overall healthy iff all critical
checks pass. Raster handles are opened per-call (never shared across threads —
rasterio Dataset is not thread-safe).

NOTE: the Weibull COGs carry NO embedded CRS (rasterio reports crs=None); the
legacy engine treats their geotransform as lon/lat degrees by assumption
(VERIFIED.md / weibull.ts), so we validate the degree grid + bounds, not a CRS tag.
"""
from __future__ import annotations
import json
from . import config, db

EXPECTED_QUANTILES = 101


def _check_db() -> tuple[bool, str]:
    if not db.db_available():
        return False, "DATABASE_URL not set"
    try:
        with db.get_pool().connection() as conn:
            n = conn.execute("SELECT count(*) FROM windmills").fetchone()[0]
        return True, f"windmills={n}"
    except Exception as e:  # noqa: BLE001 - health surfaces any failure
        return False, f"db error: {e}"


def _check_cog(path, label: str) -> tuple[bool, str]:
    try:
        import rasterio
        if not path.exists():
            return False, f"{label} missing at {path}"
        with rasterio.open(path) as ds:
            res = ds.res          # (x, y) pixel size in CRS units; degrees here
            b = ds.bounds         # left, bottom, right, top
            crs = str(ds.crs)     # None — engine assumes lon/lat degrees
        is_degree_grid = 0.0001 < res[0] < 0.01
        in_india = 60 <= b.left <= 100 and 0 <= b.bottom <= 40 and b.right <= 100 and b.top <= 40
        ok = is_degree_grid and in_india
        return ok, (
            f"{label} res={res[0]:.4f}deg "
            f"bounds=({b.left:.2f},{b.bottom:.2f},{b.right:.2f},{b.top:.2f}) crs={crs}"
        )
    except Exception as e:  # noqa: BLE001
        return False, f"{label} error: {e}"


def _check_cdf() -> tuple[bool, str]:
    try:
        q = json.loads(config.INDIA_CDF_PATH.read_text()).get("quantiles")
        ok = isinstance(q, list) and len(q) == EXPECTED_QUANTILES
        return ok, f"quantiles={len(q) if isinstance(q, list) else 'n/a'}"
    except Exception as e:  # noqa: BLE001
        return False, f"cdf error: {e}"


def run_health() -> dict:
    checks = {
        "db": _check_db(),
        "weibull_a": _check_cog(config.WEIBULL_A_PATH, "weibull_a"),
        "weibull_k": _check_cog(config.WEIBULL_K_PATH, "weibull_k"),
        "india_cdf": _check_cdf(),
    }
    healthy = all(ok for ok, _ in checks.values())
    return {
        "status": "healthy" if healthy else "unhealthy",
        "analysisVersion": config.ANALYSIS_VERSION,
        "backend": config.SITE_ANALYSIS_BACKEND,
        "checks": {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()},
    }
