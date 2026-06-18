"""GWA float32 tile fetch + decode + stitched patches, disk-cached.

Verbatim port of apps/api/src/services/analysis/tiles.ts.

Fetches raw float32 GeoTIFF XYZ tiles from the GWA TiTiler (VERIFIED.md §1:
EPSG:3857, 256x256, single band, NaN nodata, maxzoom exactly 10), decodes them
with rasterio (MemoryFile, band 1, float32), and stitches the AOI's tile cover
into one row-major Float32Array patch (LayerPatch). row 0 = north, NaN nodata.

Disk cache -- INFINITE TTL, active in dev too:
    GWA layers are a fixed 2008-2017 climatology, so a cached tile can never go
    stale. "Serve cache on upstream failure" therefore needs no special path -- a
    cached tile always wins before the network is touched.

    Layout: {cacheDir}/gwa/{layer}/{z}/{x}/{y}.tif -- RAW tif bytes (bytes are
    canonical; decode on read is fast). Writes are temp-file + rename so a
    concurrent reader never sees a torn body.

Testability: every public function accepts an optional ``fetch_impl`` (the Python
analogue of options.fetchImpl). Tests inject a synthetic fetcher; prod callers
omit it and the module talks to the real tiler with ``urllib``.

ASYNC NOTE: the legacy TS is async (fetch/fs are async in Node). The Python engine
is entirely synchronous (pure functions over local artifacts), so this port is
synchronous too. ``map_with_concurrency`` is preserved by name but runs the work
SEQUENTIALLY in cover order -- order-preserving and behaviourally identical to the
order-preserving async pool (concurrency was an I/O optimisation, not behaviour).
"""
from __future__ import annotations

import math
import os
import time
import urllib.error
import urllib.request
import warnings
from pathlib import Path
from typing import Callable, Optional, Protocol, Sequence

import numpy as np
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile

from app.config import (
    ANALYSIS_ZOOM,
    GWA_TILER_BASE,
    GWA_TILE_TIMEOUT_MS,
)
from app.engine.mercator import (
    TILE_SIZE,
    lat_to_tile_y,
    lng_to_tile_x,
    tile_cover_for_bbox,
)
from app.engine.types import LayerPatch, TileCover

# tiles.ts:45-57
# Max simultaneous upstream tile fetches PER LAYER. In the sync port the pool is
# sequential, so this only bounds nothing -- kept for trace parity.
TILE_FETCH_CONCURRENCY = 4
TILE_PIXELS = TILE_SIZE * TILE_SIZE
TILE_USER_AGENT = "wce-analysis"
CACHE_NAMESPACE = "gwa"
PROD_CACHE_DIR = "/var/cache/tiles"

# apps/api root analogue: the service's data dir is the production cache root in
# the TS (apps/api/.cache/tiles). Here the dev default lives under the service's
# own .cache/tiles so a local run never writes outside the repo.
_SERVICE_ROOT_DIR = Path(__file__).resolve().parents[2]
DEV_CACHE_DIR = _SERVICE_ROOT_DIR / ".cache" / "tiles"


# ── Injectable fetch seam (tiles.ts:59-70) ──────────────────────────────────


class TileResponse(Protocol):
    """The subset of a fetch ``Response`` ``loadTile`` touches: ``status``,
    ``ok`` and ``array_buffer()`` (raw tif bytes). Synthetic fetchers in tests
    mirror exactly the TS ``new Response(...)`` shape."""

    @property
    def status(self) -> int: ...

    @property
    def ok(self) -> bool: ...

    def array_buffer(self) -> bytes: ...


# ``(url, headers, timeout_ms) -> TileResponse``. The TS passes
# ``{ headers, signal }``; the Python seam takes the resolved header dict + the
# timeout in ms so synthetic fetchers can assert the User-Agent without an
# AbortSignal analogue.
TileFetchImpl = Callable[[str, dict[str, str], int], TileResponse]


# ── Real-network fetcher (prod default; never exercised by the ported tests) ──


class _UrllibResponse:
    """Adapts a ``urllib`` response to the TileResponse protocol."""

    def __init__(self, status: int, body: bytes) -> None:
        self._status = status
        self._body = body

    @property
    def status(self) -> int:
        return self._status

    @property
    def ok(self) -> bool:
        return 200 <= self._status < 300

    def array_buffer(self) -> bytes:
        return self._body


def _default_fetch_impl(url: str, headers: dict[str, str], timeout_ms: int) -> TileResponse:
    """Production fetcher: a real GET against the GWA tiler. 404 surfaces as a
    response (loadTile maps it to a missing tile); transport failures raise (the
    TS ``fetchImpl`` rejects, and ``fetchTileBytes`` re-wraps)."""
    request = urllib.request.Request(url, headers=headers, method="GET")
    timeout_s = timeout_ms / 1000
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as resp:
            return _UrllibResponse(resp.status, resp.read())
    except urllib.error.HTTPError as err:
        # HTTP-level error (404/500/...): a response with a status code, no raise.
        return _UrllibResponse(err.code, err.read() if err.fp is not None else b"")


# ── Cache path + I/O (tiles.ts:72-123) ──────────────────────────────────────


def resolve_tile_cache_dir() -> Path:
    """Resolved per call (not at import) so tests can point ``TILE_CACHE_DIR`` at
    a tmp dir after import (tiles.ts:72-78)."""
    from_env = os.environ.get("TILE_CACHE_DIR")
    if from_env:
        return Path(from_env)
    return Path(PROD_CACHE_DIR) if os.environ.get("NODE_ENV") == "production" else DEV_CACHE_DIR


def tile_cache_path(base_dir: Path, layer: str, z: int, x: int, y: int) -> Path:
    return Path(base_dir) / CACHE_NAMESPACE / layer / str(z) / str(x) / f"{y}.tif"


def read_cached_tile_bytes(file_path: Path) -> Optional[bytes]:
    """Cached tif bytes or None. A non-ENOENT read failure is logged and treated
    as a miss (tiles.ts:90-103)."""
    try:
        return Path(file_path).read_bytes()
    except FileNotFoundError:
        return None
    except OSError as err:  # noqa: BLE001 -- mirror the TS catch-all-but-ENOENT
        print(
            "[gwa-tiles] cache read failed; treating as miss",
            {"filePath": str(file_path), "err": str(err)},
        )
        return None


def write_cached_tile_bytes(file_path: Path, data: bytes) -> None:
    """Temp-file + rename so a concurrent reader never sees a torn tif. A failed
    cache write must never fail the analysis -- log and continue (tiles.ts:105-123)."""
    file_path = Path(file_path)
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = file_path.with_name(f"{file_path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
        tmp_path.write_bytes(data)
        tmp_path.replace(file_path)
    except OSError as err:  # noqa: BLE001
        print("[gwa-tiles] cache write failed", {"filePath": str(file_path), "err": str(err)})


# ── Decode (tiles.ts:132-154) ───────────────────────────────────────────────


def decode_tile(data: bytes, context: str) -> np.ndarray:
    """Decode one GWA tile: single-band 256x256 float32 (VERIFIED.md §1) as a
    flat row-major float32 array (length TILE_PIXELS). NaN nodata survives only
    in float output, so the band is cast to float32 if it is not already.

    rasterio's MemoryFile is the Python analogue of geotiff's ``fromArrayBuffer``;
    ``ds.read(1)`` returns the first band as a 2-D ``(height, width)`` array.
    """
    with warnings.catch_warnings():
        # GWA tiles carry a 3857 geotransform; the test fixtures do not (we sample
        # by pixel index, never by CRS), so silence the no-georeference warning.
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with MemoryFile(data) as memfile:
            with memfile.open() as ds:
                width = ds.width
                height = ds.height
                count = ds.count
                if width != TILE_SIZE or height != TILE_SIZE or count < 1:
                    raise ValueError(
                        f"GWA tile decode failed for {context}: expected "
                        f"{TILE_SIZE}x{TILE_SIZE} single-band raster, got "
                        f"{width}x{height}, band count {count}"
                    )
                band = ds.read(1)
    band = np.ascontiguousarray(band, dtype=np.float32).reshape(-1)
    if band.shape[0] != TILE_PIXELS:
        raise ValueError(
            f"GWA tile decode failed for {context}: expected {TILE_SIZE}x{TILE_SIZE} "
            f"single-band raster, band length {band.shape[0]}"
        )
    return band


# ── Fetch one tile (tiles.ts:156-186) ───────────────────────────────────────


def fetch_tile_bytes(
    layer: str, x: int, y: int, fetch_impl: TileFetchImpl
) -> Optional[bytes]:
    """Fetch one tile from the tiler. 404 -> None (GWA serves global coverage, so
    a missing tile is rare and means "no data here", not an error). Any other
    failure raises -- callers reach here only after a cache miss, so there is no
    stale copy to fall back on (tiles.ts:160-186)."""
    url = f"{GWA_TILER_BASE}/{layer}/tiles/{ANALYSIS_ZOOM}/{x}/{y}.tif"
    try:
        res = fetch_impl(url, {"User-Agent": TILE_USER_AGENT}, GWA_TILE_TIMEOUT_MS)
    except Exception as err:  # noqa: BLE001 -- mirror the TS try/catch around fetch
        raise RuntimeError(
            f"GWA tile fetch failed for {url} with no cached copy: {err}"
        ) from err
    if res.status == 404:
        return None
    if not res.ok:
        raise RuntimeError(
            f"GWA tile fetch for {url} returned HTTP {res.status} with no cached copy"
        )
    return res.array_buffer()


# ── One tile through the cache (tiles.ts:188-217) ───────────────────────────


def load_tile(
    layer: str, x: int, y: int, fetch_impl: TileFetchImpl
) -> Optional[np.ndarray]:
    """One tile through the cache: cached bytes always win (infinite TTL); a
    corrupt cached file is logged and refetched; freshly fetched bytes are cached
    only after they decode cleanly. None = 404 (all-NaN tile)."""
    cache_path = tile_cache_path(resolve_tile_cache_dir(), layer, ANALYSIS_ZOOM, x, y)
    cached = read_cached_tile_bytes(cache_path)
    if cached:
        try:
            return decode_tile(cached, f"{layer}/{ANALYSIS_ZOOM}/{x}/{y} (cached)")
        except Exception as err:  # noqa: BLE001
            print(
                "[gwa-tiles] cached tile corrupt; refetching",
                {"cachePath": str(cache_path), "err": str(err)},
            )
    data = fetch_tile_bytes(layer, x, y, fetch_impl)
    if data is None:
        return None
    decoded = decode_tile(data, f"{layer}/{ANALYSIS_ZOOM}/{x}/{y}")
    write_cached_tile_bytes(cache_path, data)
    return decoded


def map_with_concurrency(
    items: Sequence[object], limit: int, fn: Callable[[object], object]
) -> list[object]:
    """Run ``fn`` over ``items`` order-preserving. Synchronous port of the
    order-preserving async pool (tiles.ts:220-237): in a sync world the work runs
    sequentially in input order, which is exactly the order the async version
    writes its results array in. ``limit`` is accepted for trace parity."""
    results: list[object] = [None] * len(items)
    for i in range(len(items)):
        results[i] = fn(items[i])
    return results


# ── Pure stitcher (tiles.ts:239-281) ────────────────────────────────────────


def stitch_tiles(
    cover: TileCover, tiles: Sequence[Optional[np.ndarray]]
) -> LayerPatch:
    """Pure stitcher: tiles (row-major over the cover, None = missing/404) -> one
    LayerPatch. Missing tiles stay NaN. Never mutates its input tiles."""
    tiles_x = cover.max_x - cover.min_x + 1
    tiles_y = cover.max_y - cover.min_y + 1
    expected_count = tiles_x * tiles_y
    if len(tiles) != expected_count:
        raise ValueError(
            f"stitchTiles: cover needs {expected_count} tiles "
            f"({tiles_x}x{tiles_y}), got {len(tiles)}"
        )
    width_px = tiles_x * TILE_SIZE
    height_px = tiles_y * TILE_SIZE
    data = np.full(width_px * height_px, np.nan, dtype=np.float32)
    for i, tile in enumerate(tiles):
        if tile is None:
            continue
        if tile.shape[0] != TILE_PIXELS:
            raise ValueError(
                f"stitchTiles: tile {i} has length {tile.shape[0]}, expected {TILE_PIXELS}"
            )
        tile_col = i % tiles_x
        tile_row = i // tiles_x
        for row in range(TILE_SIZE):
            src = tile[row * TILE_SIZE : (row + 1) * TILE_SIZE]
            dest_offset = (tile_row * TILE_SIZE + row) * width_px + tile_col * TILE_SIZE
            data[dest_offset : dest_offset + TILE_SIZE] = src
    return LayerPatch(
        zoom=cover.z,
        min_tile_x=cover.min_x,
        min_tile_y=cover.min_y,
        width_px=width_px,
        height_px=height_px,
        data=data,
    )


# ── Public fetch entrypoints (tiles.ts:283-335) ─────────────────────────────


def fetch_layer_patch(
    layer: str,
    bbox: tuple[float, float, float, float],
    fetch_impl: Optional[TileFetchImpl] = None,
) -> LayerPatch:
    """Fetch + decode + stitch every tile covering ``bbox`` ([W, S, E, N]) at
    ANALYSIS_ZOOM into one LayerPatch. 404 tiles become all-NaN regions; any other
    upstream failure on an uncached tile raises (the section layer above maps that
    to status "unavailable")."""
    impl = fetch_impl if fetch_impl is not None else _default_fetch_impl
    cover = tile_cover_for_bbox(bbox, ANALYSIS_ZOOM)
    coords: list[tuple[int, int]] = []
    for y in range(cover.min_y, cover.max_y + 1):
        for x in range(cover.min_x, cover.max_x + 1):
            coords.append((x, y))
    tiles = map_with_concurrency(
        coords, TILE_FETCH_CONCURRENCY, lambda c: load_tile(layer, c[0], c[1], impl)
    )
    return stitch_tiles(cover, tiles)


def fetch_point_value(
    layer: str,
    lon: float,
    lat: float,
    fetch_impl: Optional[TileFetchImpl] = None,
) -> Optional[float]:
    """Single-pixel convenience (Phase 2 mast validation): the exact pixel value
    of ``layer`` at [lon, lat] through the same tile cache. None when the pixel is
    nodata (NaN) or its tile is missing (404). VALIDATION DEPENDS ON THIS."""
    if not math.isfinite(lon) or not math.isfinite(lat):
        raise ValueError(f"fetchPointValue: non-finite coordinates lon={lon} lat={lat}")
    impl = fetch_impl if fetch_impl is not None else _default_fetch_impl
    max_tile_index = 2**ANALYSIS_ZOOM - 1
    x_cont = lng_to_tile_x(lon, ANALYSIS_ZOOM)
    y_cont = lat_to_tile_y(lat, ANALYSIS_ZOOM)
    tile_x = min(max_tile_index, max(0, math.floor(x_cont)))
    tile_y = min(max_tile_index, max(0, math.floor(y_cont)))
    tile = load_tile(layer, tile_x, tile_y, impl)
    if tile is None:
        return None
    last_pixel = TILE_SIZE - 1
    px = min(last_pixel, max(0, math.floor((x_cont - tile_x) * TILE_SIZE)))
    py = min(last_pixel, max(0, math.floor((y_cont - tile_y) * TILE_SIZE)))
    value = float(tile[py * TILE_SIZE + px])
    return value if math.isfinite(value) else None
