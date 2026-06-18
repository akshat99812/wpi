"""Area-mean Weibull A/k over an AOI, read from the local GWA combined-Weibull
country COGs (250 m grid, float32, NaN nodata, EPSG:4326-by-assumption —
VERIFIED.md §2).

Verbatim port of apps/api/src/services/analysis/weibull.ts. The COGs are fetched
once by ``scripts/fetch-weibull-cogs.ts`` into WEIBULL_COG_DIR; here they resolve
to ``config.WEIBULL_A_PATH`` / ``config.WEIBULL_K_PATH`` under DATA_DIR. When they
are absent or unreadable this module degrades gracefully: ``aoi_weibull_means``
returns None (logged once at first use, not per call) and the resource section
ships without a distribution.

Point-in-ring note: mask.py (foundation, wave 1) targets stitched web-mercator
LayerPatch grids at ANALYSIS_ZOOM (see types.py AoiMask) — its API does not fit
the COGs' plain lon/lat grid, so a tiny LOCAL ray-cast helper (``is_inside_ring``)
is the deliberate DRY tradeoff here. This is the documented dual ray-cast.

The Weibull COGs report ``crs=None``; per the migration contract we treat
``ds.transform`` (an Affine) as a lon/lat DEGREE grid by assumption and do NOT
rely on an embedded CRS. The TS reads ``image.getOrigin()`` / ``getResolution()``
from the GeoTIFF header — the rasterio equivalents are:

    originX     = transform.c   (lon of LEFT edge of pixel column 0)
    originY     = transform.f   (lat of TOP edge of pixel row 0)
    pixelWidth  = transform.a   (degrees/px eastward, > 0)
    pixelHeight = transform.e   (degrees/px southward, < 0 for north-up)
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from app import config

logger = logging.getLogger(__name__)


# ── Paths (shared with scripts/fetch-weibull-cogs.ts and the tests) ────────
#
# The TS resolves these relative to import.meta.url; the Python service pins them
# in config (DATA_DIR / "gwa" / <file>) so monkeypatched paths are honoured in
# tests exactly like indiacdf's INDIA_CDF_PATH. Read through ``config`` at use
# time — never bind the Path at import.

# ── Geotransform / pixel-window math (pure, unit-tested) ───────────────────


@dataclass(frozen=True)
class GeoTransform:
    """North-up affine geotransform of a COG, read from its image metadata."""

    # Lon of the LEFT edge of pixel column 0 (degrees).
    origin_x: float
    # Lat of the TOP edge of pixel row 0 (degrees).
    origin_y: float
    # Degrees per pixel eastward (> 0).
    pixel_width: float
    # Degrees per pixel southward (< 0 for north-up rasters).
    pixel_height: float
    width_px: int
    height_px: int


@dataclass(frozen=True)
class PixelWindow:
    """Half-open pixel window [x0, x1) × [y0, y1) in full-image coordinates."""

    x0: int
    y0: int
    x1: int
    y1: int


# Defensive cap on a single window read. The 2,500 km² AOI cap is ~40k pixels on
# the 250 m grid; anything near this limit signals a bbox bug upstream.
MAX_WINDOW_PIXELS = 4_000_000

TRANSFORM_MATCH_EPSILON_DEG = 1e-9


def bbox_pixel_window(
    transform: GeoTransform,
    bbox: Sequence[float],
) -> Optional[PixelWindow]:
    """Pixel window covering a lon/lat bbox ``[W, S, E, N]`` at native resolution,
    expanded outward to whole pixels and clamped to the image. Returns None when
    the bbox does not overlap the raster; throws when the window would exceed
    MAX_WINDOW_PIXELS (upstream bbox bug, never a data condition).
    (weibull.ts:74-100)
    """
    origin_x = transform.origin_x
    origin_y = transform.origin_y
    pixel_width = transform.pixel_width
    pixel_height = transform.pixel_height
    width_px = transform.width_px
    height_px = transform.height_px
    if not (pixel_width > 0) or not (pixel_height < 0):
        raise ValueError(
            "bboxPixelWindow: expected north-up transform "
            f"(pixelWidth>0, pixelHeight<0), got {pixel_width}/{pixel_height}"
        )
    west, south, east, north = bbox[0], bbox[1], bbox[2], bbox[3]
    x0 = max(0, math.floor((west - origin_x) / pixel_width))
    x1 = min(width_px, math.ceil((east - origin_x) / pixel_width))
    # North (larger lat) maps to the SMALLER row index because pixelHeight < 0.
    y0 = max(0, math.floor((north - origin_y) / pixel_height))
    y1 = min(height_px, math.ceil((south - origin_y) / pixel_height))
    if x1 <= x0 or y1 <= y0:
        return None

    pixel_count = (x1 - x0) * (y1 - y0)
    if pixel_count > MAX_WINDOW_PIXELS:
        bbox_str = ",".join(str(v) for v in bbox)
        raise ValueError(
            f"bboxPixelWindow: window of {pixel_count} px exceeds cap "
            f"{MAX_WINDOW_PIXELS} — bbox bug upstream (bbox={bbox_str})"
        )
    return PixelWindow(x0=x0, y0=y0, x1=x1, y1=y1)


def pixel_center_lng_lat(
    transform: GeoTransform,
    col: int,
    row: int,
) -> tuple[float, float]:
    """Lon/lat of the CENTER of pixel (col, row) in full-image coordinates.
    (weibull.ts:103-112)
    """
    return (
        transform.origin_x + (col + 0.5) * transform.pixel_width,
        transform.origin_y + (row + 0.5) * transform.pixel_height,
    )


# ── Point-in-ring (even-odd ray cast) ───────────────────────────────────────


def is_inside_ring(
    lon: float,
    lat: float,
    ring: Sequence[Sequence[float]],
) -> bool:
    """True when ``[lon, lat]`` falls inside the closed lon/lat ring (even-odd).
    (weibull.ts:117-132)
    """
    is_inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        crosses_ray = (yi > lat) != (yj > lat) and (
            lon < (xj - xi) * (lat - yi) / (yj - yi) + xi
        )
        if crosses_ray:
            is_inside = not is_inside
        j = i
    return is_inside


# ── Gamma (Lanczos g=7) — for the Weibull mean A·Γ(1+1/k) ──────────────────

LANCZOS_G = 7
LANCZOS_COEFFICIENTS = (
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
)


def gamma_fn(x: float) -> float:
    """Gamma function via the Lanczos approximation (g=7, 9 coefficients).
    (weibull.ts:144-156)

    NOTE: present for completeness — it is NOT invoked by ``aoi_weibull_means``
    at request time (the weibull mean A·Γ(1+1/k) is computed downstream / in the
    live test, never here).
    """
    if x < 0.5:
        # Reflection formula for the left half-plane.
        return math.pi / (math.sin(math.pi * x) * gamma_fn(1 - x))
    z = x - 1
    total = LANCZOS_COEFFICIENTS[0]
    for i in range(1, len(LANCZOS_COEFFICIENTS)):
        total += LANCZOS_COEFFICIENTS[i] / (z + i)
    t = z + LANCZOS_G + 0.5
    return math.sqrt(2 * math.pi) * t ** (z + 0.5) * math.exp(-t) * total


# ── COG handles (opened once, lazily; None = degraded mode) ────────────────


@dataclass(frozen=True)
class OpenCog:
    """An opened COG dataset plus its parsed north-up geotransform. ``dataset`` is
    a rasterio DatasetReader (the analogue of geotiff's GeoTIFF/GeoTIFFImage pair);
    keeping it lets the OS file descriptor be closed (tests, graceful shutdown)."""

    dataset: object  # rasterio.io.DatasetReader
    transform: GeoTransform


@dataclass(frozen=True)
class WeibullCogs:
    a: OpenCog
    k: OpenCog


# undefined (not loaded yet) -> _NOT_LOADED; None = attempted and unavailable;
# WeibullCogs = open. Mirrors the TS lazy promise singleton (which never rejects).
_NOT_LOADED = object()
_cogs_cache: object = _NOT_LOADED


def _load_weibull_cogs() -> Optional[WeibullCogs]:
    """Lazy singleton load. The cache must NEVER carry a thrown error — a thrown
    singleton would raise on every subsequent call instead of degrading to None.
    (weibull.ts:174-185 loadWeibullCogs)
    """
    global _cogs_cache
    if _cogs_cache is not _NOT_LOADED:
        return _cogs_cache  # type: ignore[return-value]
    try:
        _cogs_cache = _open_both_cogs()
    except Exception as err:  # noqa: BLE001 — mirror the TS .catch, never throws
        logger.error(
            "[analysis/weibull] unexpected COG load failure — "
            "Weibull means degrade to null: %s",
            err,
        )
        _cogs_cache = None
    return _cogs_cache  # type: ignore[return-value]


def _close_dataset_handles(datasets: Sequence[object]) -> None:
    """Best-effort close of COG file descriptors; logs, never throws.
    (weibull.ts:188-197 closeTiffHandles)
    """
    for dataset in datasets:
        try:
            dataset.close()  # type: ignore[attr-defined]
        except Exception as err:  # noqa: BLE001
            logger.warning("[analysis/weibull] failed to close COG handle: %s", err)


def _open_cog(path) -> OpenCog:
    """Open one COG and parse its north-up geotransform from ``ds.transform``
    (treated as a lon/lat degree grid by assumption — crs is None). Never strands
    the fd when metadata reads fail mid-open. (weibull.ts:199-226 openCog)
    """
    import rasterio

    dataset = rasterio.open(path)
    try:
        affine = dataset.transform
        transform = GeoTransform(
            origin_x=affine.c,
            origin_y=affine.f,
            pixel_width=affine.a,
            pixel_height=affine.e,
            width_px=dataset.width,
            height_px=dataset.height,
        )
        fields = [
            transform.origin_x,
            transform.origin_y,
            transform.pixel_width,
            transform.pixel_height,
        ]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in fields):
            raise ValueError(f"Weibull COG {path}: malformed geotransform")
        return OpenCog(dataset=dataset, transform=transform)
    except Exception:
        # Never strand the fd when metadata reads fail mid-open.
        _close_dataset_handles([dataset])
        raise


def _is_same_grid(a: GeoTransform, b: GeoTransform) -> bool:
    """A and k must share one grid or pixel pairing would silently misalign.
    (weibull.ts:233-242 isSameGrid)
    """
    return (
        a.width_px == b.width_px
        and a.height_px == b.height_px
        and abs(a.origin_x - b.origin_x) < TRANSFORM_MATCH_EPSILON_DEG
        and abs(a.origin_y - b.origin_y) < TRANSFORM_MATCH_EPSILON_DEG
        and abs(a.pixel_width - b.pixel_width) < TRANSFORM_MATCH_EPSILON_DEG
        and abs(a.pixel_height - b.pixel_height) < TRANSFORM_MATCH_EPSILON_DEG
    )


def _open_both_cogs() -> Optional[WeibullCogs]:
    """Open both COGs, refusing to pair pixels unless the grids match. Closes any
    half-open fd on every failure path and degrades to None. (weibull.ts:244-284)
    """
    a_path = config.WEIBULL_A_PATH
    k_path = config.WEIBULL_K_PATH
    has_a = os.path.exists(a_path)
    has_k = os.path.exists(k_path)
    if not has_a or not has_k:
        logger.warning(
            "[analysis/weibull] COG(s) missing under %s "
            "(A: %s, k: %s) — run `bun scripts/fetch-weibull-cogs.ts`. "
            "Weibull means degrade to null.",
            os.path.dirname(str(a_path)),
            has_a,
            has_k,
        )
        return None
    # Open each independently so a half-open pair can be closed — opening both in
    # one try and letting an exception escape would strand the fd of whichever COG
    # opened successfully when the other one failed.
    opened: list[OpenCog] = []
    failed_reason: Optional[BaseException] = None
    for path in (a_path, k_path):
        try:
            opened.append(_open_cog(path))
        except Exception as err:  # noqa: BLE001
            failed_reason = err
    if failed_reason is not None or len(opened) != 2:
        _close_dataset_handles([cog.dataset for cog in opened])
        logger.error(
            "[analysis/weibull] failed to open COGs — "
            "Weibull means degrade to null: %s",
            failed_reason,
        )
        return None
    a, k = opened[0], opened[1]
    if not _is_same_grid(a.transform, k.transform):
        _close_dataset_handles([a.dataset, k.dataset])
        logger.error(
            "[analysis/weibull] A and k COGs have mismatched grids — "
            "refusing to pair pixels; Weibull means degrade to null."
        )
        return None
    return WeibullCogs(a=a, k=k)


def reset_weibull_cogs() -> None:
    """Close both COG file descriptors (if open) and clear the lazy singleton so
    the next ``aoi_weibull_means`` call re-opens from disk. For tests (isolation
    between degraded/live paths) and graceful-shutdown hooks — production request
    paths never call this. (weibull.ts:292-305 resetWeibullCogs)
    """
    global _cogs_cache
    pending = _cogs_cache
    _cogs_cache = _NOT_LOADED
    if pending is _NOT_LOADED or pending is None:
        return
    cogs: Optional[WeibullCogs] = pending  # type: ignore[assignment]
    if cogs is not None:
        _close_dataset_handles([cogs.a.dataset, cogs.k.dataset])


# ── Public API ──────────────────────────────────────────────────────────────


def _read_window_band(dataset, window: PixelWindow) -> np.ndarray:
    """Read band 0 over the half-open pixel window, row-major, as float32 — the
    rasterio analogue of geotiff ``readRasters({window:[x0,y0,x1,y1]})``.
    (weibull.ts:309-321 readWindowBand)
    """
    from rasterio.windows import Window

    band = dataset.read(
        1,
        window=Window(
            window.x0,
            window.y0,
            window.x1 - window.x0,
            window.y1 - window.y0,
        ),
    )
    if band.dtype != np.float32:
        raise ValueError("Weibull COG read returned a non-float32 band")
    return band


def aoi_weibull_means(
    bbox: Sequence[float],
    ring: Sequence[Sequence[float]],
) -> Optional[dict]:
    """Area-mean Weibull A and k over the AOI: native-resolution window read
    covering ``bbox``, then the mean of every finite, positive A/k pixel pair
    whose center falls inside ``ring``. A and k are returned UNROUNDED.

    Returns None when the COGs are unavailable (degraded mode), the bbox misses
    the raster, the read fails, or zero in-ring pixels are valid. Throws only for
    the MAX_WINDOW_PIXELS cap (upstream bbox bug). (weibull.ts:332-377)
    """
    cogs = _load_weibull_cogs()
    if not cogs:
        return None

    # Grids verified identical at load time — one window serves both reads.
    window = bbox_pixel_window(cogs.a.transform, bbox)
    if not window:
        return None

    try:
        a_band = _read_window_band(cogs.a.dataset, window)
        k_band = _read_window_band(cogs.k.dataset, window)
    except Exception as err:  # noqa: BLE001
        logger.error(
            "[analysis/weibull] window read failed — returning null: %s", err
        )
        return None

    # rasterio returns 2-D (rows, cols); index by (row-y0, col-x0) which is the
    # same row-major layout the TS reads as a flat Float32Array.
    sum_a = 0.0
    sum_k = 0.0
    inside_count = 0
    for row in range(window.y0, window.y1):
        for col in range(window.x0, window.x1):
            a_value = float(a_band[row - window.y0, col - window.x0])
            k_value = float(k_band[row - window.y0, col - window.x0])
            is_valid_pair = (
                math.isfinite(a_value)
                and math.isfinite(k_value)
                and a_value > 0
                and k_value > 0
            )
            if not is_valid_pair:
                continue
            lon, lat = pixel_center_lng_lat(cogs.a.transform, col, row)
            if not is_inside_ring(lon, lat, ring):
                continue
            sum_a += a_value
            sum_k += k_value
            inside_count += 1

    if inside_count == 0:
        return None
    return {"A": sum_a / inside_count, "k": sum_k / inside_count}
