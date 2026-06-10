#!/usr/bin/env python3
"""
Pre-bake Global Wind Atlas (GWA) wind-resource layers for India into static
artifacts the web app serves with ZERO runtime dependency on any external tile
service. Metric × height is a config matrix (METRICS below) — which heights
exist per metric is config, not code; the frontend discovers everything from
the emitted metadata.json.

Per (metric, height) the bake produces:

  1. apps/web/public/wind-atlas/{subdir}/{height}/{z}/{x}/{y}.png
       Colorized XYZ raster pyramid (EPSG:3857, z3-z9). Speed keeps its legacy
       layout (no subdir: wind-atlas/{height}/...) so existing assets and
       consumers are untouched; density bakes to wind-atlas/pd/{height}/...

  2. apps/web/public/wind-atlas/grids/{grid_name}
       Coarse lat/lng value grid (speed: {h}m.json — legacy name; density:
       pd-{h}m.json) so the cursor readout resolves real GWA values
       synchronously, with no network round-trip.

Plus, independent of which layers were baked this run:

  3. apps/web/public/wind-atlas/metadata.json — the single source of truth the
     frontend imports for units, available heights, tile/grid URL templates,
     value domains, and colour ramps. No hand-mirrored TS constants anywhere.

  4. apps/web/scripts/reports/wind-resource-validation.json — India-wide
     min/max/p50/p90/p99 per existing grid (catches unit/scaling/encoding bugs
     two-point calibration misses).

Output is clipped to the official India land boundary (the same states GeoJSON
the app renders, which INCLUDES Ladakh + Jammu & Kashmir), so oceans and
foreign land are removed — only Indian land is coloured.

Data source — GWA's own TiTiler (the tiler globalwindatlas.info itself uses):
  https://tiles-stag.ramtt.xyz/titiler/gwa4/{layer}/tiles/{z}/{x}/{y}.tif
It serves the GLOBAL GWA v4 250 m COGs as raw float32 GeoTIFF XYZ tiles
(EPSG:3857, CORS-open). Layer enum: ws_mean_hgt{H}m (m/s), pd_mean_hgt{H}m
(W/m²) — both verified live 2026-06-10. Used only at bake time; the baked
tiles are self-hosted, so the staging tiler being a dependency at runtime is
not a concern.

Speed calibration (verified against GWA's authoritative country download):
Kutch 5.56 vs 5.5; Chitradurga 6.97 vs 6.6 — and it HAS data over Jammu &
Kashmir / Ladakh, unlike the clipped country tif.

Power-density physics validation (2026-06-10, exact-point sampling):
  - pd150/pd100 = 1.36 at Kutch — matches (ws150/ws100)³ = 1.357 exactly, so
    the PD layer is the true cube-derived field in consistent units.
  - pd/ws̄³ = 0.83–0.91 at Kutch + Chitradurga, both heights. NOTE: the naive
    Rayleigh estimate PD ≈ 1.17·v̄³ OVER-estimates for India — peninsular
    monsoon winds have high Weibull k (≈2.5–3.5, narrower than Rayleigh's
    k=2) and warm-air density < 1.225 kg/m³. Sanity band: PD/v̄³ ∈ [0.7, 1.3].

GWA data is a fixed 2008-2017 climatology — a pre-baked snapshot never goes
stale; re-run only to refresh.

Run:
    cd apps/web/scripts
    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements-wind.txt
    python build_wind_atlas.py density            # all density heights
    python build_wind_atlas.py density 100        # one metric, one height
    python build_wind_atlas.py speed              # legacy re-bake (all heights)
    python build_wind_atlas.py --metadata-only    # just metadata.json + report

Env: WIND_GRID_ONLY=1 re-bakes only the JSON value grids (fast; reuses cached
source tiles) without rewriting the PNG pyramids.

Dependencies: rasterio (bundles GDAL), numpy, scipy, Pillow.
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import reproject, transform_geom
from scipy import ndimage
from PIL import Image

# ── Paths ────────────────────────────────────────────────────────────────────
HERE      = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT  = os.path.normpath(os.path.join(HERE, ".."))
CACHE_DIR = os.path.join(HERE, ".cache")
TIF_CACHE = os.path.join(CACHE_DIR, "titiler")          # raw .tif tiles, by gwa-layer/z/x/y
GEOJSON_PATH = os.path.join(CACHE_DIR, "india_states.geojson")
TILES_DIR = os.path.join(WEB_ROOT, "public", "wind-atlas")
GRID_DIR  = os.path.join(TILES_DIR, "grids")
METADATA_PATH = os.path.join(TILES_DIR, "metadata.json")
REPORT_DIR = os.path.join(HERE, "reports")
REPORT_PATH = os.path.join(REPORT_DIR, "wind-resource-validation.json")

# Same India states boundary the web app uses (post-2014; incl. J&K + Ladakh).
GEOJSON_URL = (
    "https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/"
    "raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson"
)

# ── TiTiler source ───────────────────────────────────────────────────────────
TITILER = "https://tiles-stag.ramtt.xyz/titiler/gwa4"

# ── Shared colour palette ────────────────────────────────────────────────────
# One palette for every metric so the visual language is constant (cyan-blue =
# poor resource → red = excellent) and the proven satellite-legible bright low
# end is kept (dark-low ramps vanish over dark terrain at 0.8 opacity).
# Fractions map linearly onto each metric's [lo, hi] domain.
PALETTE: list[tuple[float, tuple[int, int, int]]] = [
    (0.0, (0x3d, 0x93, 0xb5)),  # cyan-blue
    (0.2, (0x5a, 0xad, 0x82)),  # sea-green
    (0.4, (0xc8, 0xe0, 0x4a)),  # chartreuse
    (0.6, (0xff, 0xc0, 0x41)),  # amber
    (0.8, (0xff, 0x7a, 0x1a)),  # orange
    (1.0, (0xff, 0x1a, 0x00)),  # red
]

# ── Metric × height matrix ───────────────────────────────────────────────────
# `tile_subdir`/`grid_name` keep speed's legacy paths byte-identical so the
# existing assets, useWindLayer consumers, and lookup.ts keep working without
# a migration. Adding a height (e.g. density @ 50 m) is a config change here +
# a re-run — zero frontend changes (the UI renders metadata.json).
METRICS: dict[str, dict] = {
    "speed": {
        "gwa_layer": "ws_mean_hgt{h}m",
        "label": "Mean wind speed",
        "unit": "m/s",
        "heights": [50, 100, 150],
        "tile_subdir": "",               # legacy: wind-atlas/{h}/{z}/{x}/{y}.png
        "grid_name": "{h}m.json",        # legacy: grids/{h}m.json
        "lo": 4.0, "hi": 9.0,            # palette domain
        "grid_scale": 10,                # store round(v*10) ints
        "source_note": "GWA v4 mean wind speed @{h} m (2008-2017), clipped to India land",
    },
    "density": {
        "gwa_layer": "pd_mean_hgt{h}m",
        "label": "Mean power density",
        "unit": "W/m²",
        "heights": [100, 150],           # modern hub heights; 50 m is legacy —
                                         # add here + re-run to enable it.
        "tile_subdir": "pd",             # wind-atlas/pd/{h}/{z}/{x}/{y}.png
        "grid_name": "pd-{h}m.json",     # grids/pd-{h}m.json
        "lo": 0.0, "hi": 800.0,          # W/m² — p99 over India land ≲ 800
        "grid_scale": 1,                 # whole W/m² ints
        "source_note": "GWA v4 mean wind power density @{h} m (2008-2017), clipped to India land",
    },
}

ATTRIBUTION = "Wind data: © Global Wind Atlas (DTU Wind Energy / World Bank) — CC BY 4.0"

# ── Tiling spec ──────────────────────────────────────────────────────────────
MIN_ZOOM, MAX_ZOOM = 3, 9
GRID_ZOOM = 6              # source zoom used to build the coarse value grid
TILE_SIZE = 256
LNG_MIN, LNG_MAX = 67.0, 98.0
LAT_MIN, LAT_MAX = 6.0, 38.0

# ── Value grid spec (cursor readout / slider) ────────────────────────────────
GRID_STEP  = 0.1          # degrees (~11 km)

# ── Embedded-gulf fill (morphological closing of the land mask) ──────────────
# The India land polygon excludes inlets like the Gulf of Khambhat / Gulf of
# Kutch, which read as holes "inside" Gujarat. A morphological CLOSING fills
# concavities enclosed by the same landmass (gulfs, estuaries, the Rann) while
# leaving the OPEN ocean coastline (Konkan, Bay of Bengal) untouched. We OR only
# the *added* fill regions onto the crisp per-tile vector mask, so real
# coastlines stay sharp at high zoom and the fill (over open water) can be coarse.
MASK_RES  = 0.02          # deg (~2 km) raster for the closing
CLOSE_DEG = 1.0           # closing radius (~110 km) — fills the full Gulf of
                          # Khambhat mouth + Gulf of Kutch; verified not to blob
                          # into the open Arabian Sea / Bay of Bengal.
COAST_DEG = 0.23          # outward coastal dilation (~25 km). Two jobs:
                          # (1) the simplified states GeoJSON undercuts the
                          # TRUE coastline in places (Gujarat inlets, Konkan
                          # estuaries) — over satellite imagery uncovered land
                          # slivers are obvious; (2) a ~20 km nearshore band
                          # of real GWA offshore values, useful context for
                          # coastal sites. Baked into the shared tiles, so it
                          # shows on every basemap.

OS = math.pi * 6378137.0  # web-mercator origin shift


def gwa_layer(metric: str, h: int) -> str:
    return METRICS[metric]["gwa_layer"].format(h=h)


def tiles_dir_for(metric: str, h: int) -> str:
    sub = METRICS[metric]["tile_subdir"]
    return os.path.join(TILES_DIR, sub, str(h)) if sub else os.path.join(TILES_DIR, str(h))


def grid_path_for(metric: str, h: int) -> str:
    return os.path.join(GRID_DIR, METRICS[metric]["grid_name"].format(h=h))


# ── India land mask ──────────────────────────────────────────────────────────
def ensure_geojson() -> None:
    if os.path.exists(GEOJSON_PATH) and os.path.getsize(GEOJSON_PATH) > 1000:
        return
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("Downloading India states GeoJSON (land mask) …")
    req = urllib.request.Request(GEOJSON_URL, headers={"User-Agent": "wce-windatlas-bake"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(GEOJSON_PATH, "wb") as f:
        f.write(resp.read())


def load_india_geoms():
    with open(GEOJSON_PATH) as f:
        gj = json.load(f)
    geoms_4326 = [feat["geometry"] for feat in gj["features"] if feat.get("geometry")]
    geoms_3857 = [transform_geom("EPSG:4326", "EPSG:3857", g) for g in geoms_4326]
    print(f"India land mask: {len(geoms_4326)} polygons (incl. J&K + Ladakh)")
    return geoms_4326, geoms_3857


def build_fill_mask(geoms_4326):
    """Embedded-gulf fill via morphological closing of the land raster.

    Returns (fill, mtf): `fill` is a bool array over [LNG_MIN..LNG_MAX,
    LAT_MIN..LAT_MAX] at MASK_RES (row 0 = LAT_MAX / north), True where closing
    filled water enclosed by the same landmass (Gulf of Khambhat / Kutch, the
    Rann, estuaries). Open coastlines are not extended. `mtf` is its affine."""
    cols = int(round((LNG_MAX - LNG_MIN) / MASK_RES))
    rows = int(round((LAT_MAX - LAT_MIN) / MASK_RES))
    mtf = transform_from_bounds(LNG_MIN, LAT_MIN, LNG_MAX, LAT_MAX, cols, rows)
    base = geometry_mask(geoms_4326, (rows, cols), mtf, invert=True, all_touched=True)
    R = int(round(CLOSE_DEG / MASK_RES))
    yy, xx = np.ogrid[-R:R + 1, -R:R + 1]
    se = (xx * xx + yy * yy) <= R * R
    # Pad so the closing's erosion step can't eat real coastline at array edges.
    pad = np.pad(base, R, mode="constant", constant_values=False)
    closed = ndimage.binary_closing(pad, structure=se)[R:-R, R:-R]
    fill = closed & ~base
    print(f"Gulf fill: closing r={CLOSE_DEG}° added {int(fill.sum())} cells "
          f"(+{100 * fill.sum() / max(1, base.sum()):.1f}% of land)")
    # Coastal dilation: extend coverage outward everywhere so the simplified
    # polygon's coastline error never leaves real land uncovered, plus a
    # nearshore band of real GWA offshore values. CRITICAL: do NOT mask the
    # dilation with `~base` — `base` here is the COARSE (MASK_RES,
    # all_touched) land raster, which overhangs the precise per-tile vector
    # mask by up to a cell (~2 km). Cells in that overhang ring are "land"
    # here but sea in the per-tile mask; excluding them from the fringe left
    # exactly that ring uncovered along the coast. Including base is
    # harmless: the per-tile vector mask already covers true land crisply.
    Rc = int(round(COAST_DEG / MASK_RES))
    yyc, xxc = np.ogrid[-Rc:Rc + 1, -Rc:Rc + 1]
    sec = (xxc * xxc + yyc * yyc) <= Rc * Rc
    coast = ndimage.binary_dilation(base, structure=sec)
    print(f"Coast fringe: dilation r={COAST_DEG}° covers {int(coast.sum())} cells "
          f"(+{int((coast & ~base).sum())} beyond coarse land)")
    fill = fill | coast
    return fill, mtf


def sample_fill_3857(fill, xmin, ymin, xmax, ymax, size):
    """Sample the fill raster (4326, row 0 = north) onto a size² EPSG:3857 tile."""
    ax = xmin + (np.arange(size) + 0.5) / size * (xmax - xmin)   # 3857 x per col
    ay = ymax - (np.arange(size) + 0.5) / size * (ymax - ymin)   # 3857 y per row
    lng = ax / OS * 180.0
    lat = np.degrees(2 * np.arctan(np.exp(ay / 6378137.0)) - math.pi / 2)
    ci = ((lng - LNG_MIN) / MASK_RES).astype(int)
    ri = ((LAT_MAX - lat) / MASK_RES).astype(int)
    vc = (ci >= 0) & (ci < fill.shape[1])
    vr = (ri >= 0) & (ri < fill.shape[0])
    out = fill[np.clip(ri, 0, fill.shape[0] - 1)][:, np.clip(ci, 0, fill.shape[1] - 1)]
    return out & vr[:, None] & vc[None, :]


# ── Web-mercator tile helpers ────────────────────────────────────────────────
def lng_to_tilex(lng, n): return (lng + 180.0) / 360.0 * n
def lat_to_tiley(lat, n):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n

def tile_bounds_3857(x, y, z):
    n = 2 ** z
    return (x / n * 2 * OS - OS, OS - (y + 1) / n * 2 * OS,
            (x + 1) / n * 2 * OS - OS, OS - y / n * 2 * OS)

def india_tile_range(z):
    n = 2 ** z
    x0 = max(0, int(math.floor(lng_to_tilex(LNG_MIN, n))))
    x1 = min(n - 1, int(math.floor(lng_to_tilex(LNG_MAX, n))))
    y0 = max(0, int(math.floor(lat_to_tiley(LAT_MAX, n))))
    y1 = min(n - 1, int(math.floor(lat_to_tiley(LAT_MIN, n))))
    return x0, x1, y0, y1


# ── TiTiler fetch (disk-cached) ──────────────────────────────────────────────
def fetch_tile_bytes(layer_name: str, z: int, x: int, y: int):
    """Raw float32 GeoTIFF tile bytes from the GWA titiler, cached to disk.
    Cache is keyed by the FULL GWA layer name (ws_mean_hgt100m / pd_mean_…) so
    metrics can never collide. (The pre-refactor cache keyed speed tiles by
    bare height — those entries are simply orphaned, not corrupted.)
    Returns None on 404 / empty."""
    cp = os.path.join(TIF_CACHE, layer_name, str(z), str(x), f"{y}.tif")
    if os.path.exists(cp):
        return open(cp, "rb").read() if os.path.getsize(cp) > 0 else None
    url = f"{TITILER}/{layer_name}/tiles/{z}/{x}/{y}.tif"
    os.makedirs(os.path.dirname(cp), exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "wce-windatlas-bake"})
        data = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            open(cp, "wb").close()      # cache the miss
            return None
        raise
    with open(cp, "wb") as f:
        f.write(data)
    return data


def tile_array(data):
    """GeoTIFF bytes -> (float32 HxW with NaN nodata). EPSG:3857."""
    with MemoryFile(data) as mf, mf.open() as ds:
        a = ds.read(1, masked=True).astype("float32").filled(np.nan)
    return a


def prefetch(jobs, desc):
    """Concurrently warm the tile cache for a list of (layer_name,z,x,y)."""
    done = 0
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(fetch_tile_bytes, *j): j for j in jobs}
        for _ in as_completed(futs):
            done += 1
            if done % 100 == 0 or done == len(jobs):
                sys.stdout.write(f"\r  {desc}: fetched {done}/{len(jobs)}   ")
                sys.stdout.flush()
    if jobs:
        sys.stdout.write("\n")


# ── Colour mapping ───────────────────────────────────────────────────────────
def build_lut():
    lut = np.zeros((256, 3), dtype=np.uint8)
    ts = [s[0] for s in PALETTE]; cs = [s[1] for s in PALETTE]
    for i in range(256):
        t = i / 255.0
        for k in range(len(ts) - 1):
            if ts[k] <= t <= ts[k + 1]:
                f = (t - ts[k]) / (ts[k + 1] - ts[k])
                lut[i] = [round(cs[k][j] + (cs[k + 1][j] - cs[k][j]) * f) for j in range(3)]
                break
    return lut

LUT = build_lut()

def colorize(values, valid, lo: float, hi: float):
    safe = np.where(valid, values, lo)
    t = np.clip((safe - lo) / (hi - lo), 0.0, 1.0)
    rgb = LUT[(t * 255).astype(np.uint8)]
    a = np.where(valid, 255, 0).astype(np.uint8)
    return np.dstack([rgb, a])


# ── Tile pyramid (per metric × height) ───────────────────────────────────────
def bake_tiles(metric: str, h: int, geoms_3857, fill):
    cfg = METRICS[metric]
    lname = gwa_layer(metric, h)
    # Build the work-list of tiles that actually intersect India land. The
    # `inside` mask is the crisp per-tile vector polygon OR the coarse gulf-fill.
    work = []          # (z, x, y, tile_transform, inside_mask)
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        x0, x1, y0, y1 = india_tile_range(z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                b = tile_bounds_3857(x, y, z)
                tf = transform_from_bounds(b[0], b[1], b[2], b[3], TILE_SIZE, TILE_SIZE)
                try:
                    base_in = geometry_mask(geoms_3857, (TILE_SIZE, TILE_SIZE), tf,
                                            invert=True, all_touched=True)
                except ValueError:
                    base_in = np.zeros((TILE_SIZE, TILE_SIZE), bool)
                inside = base_in | sample_fill_3857(fill, b[0], b[1], b[2], b[3], TILE_SIZE)
                if inside.any():
                    work.append((z, x, y, tf, inside))
    print(f"  [{metric} {h}m] {len(work)} land tiles to render")
    prefetch([(lname, z, x, y) for (z, x, y, _, _) in work], f"{metric} {h}m tiles")

    written = 0
    for (z, x, y, tf, inside) in work:
        data = fetch_tile_bytes(lname, z, x, y)
        if data is None:
            continue
        arr = tile_array(data)
        valid = np.isfinite(arr) & (arr > 0) & inside
        if not valid.any():
            continue
        rgba = colorize(arr, valid, cfg["lo"], cfg["hi"])
        out_dir = os.path.join(tiles_dir_for(metric, h), str(z), str(x))
        os.makedirs(out_dir, exist_ok=True)
        Image.fromarray(rgba, "RGBA").save(os.path.join(out_dir, f"{y}.png"), optimize=True)
        written += 1
    print(f"  [{metric} {h}m] tiles written: {written}")


# ── Value grid (per metric × height) ─────────────────────────────────────────
def bake_grid(metric: str, h: int, geoms_4326, fill, mtf):
    cfg = METRICS[metric]
    lname = gwa_layer(metric, h)
    scale = cfg["grid_scale"]
    x0, x1, y0, y1 = india_tile_range(GRID_ZOOM)
    prefetch([(lname, GRID_ZOOM, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)],
             f"{metric} {h}m grid src")
    W = (x1 - x0 + 1) * TILE_SIZE
    H = (y1 - y0 + 1) * TILE_SIZE
    mosaic = np.full((H, W), np.nan, dtype="float32")
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            data = fetch_tile_bytes(lname, GRID_ZOOM, x, y)
            if data is None:
                continue
            mosaic[(y - y0) * TILE_SIZE:(y - y0 + 1) * TILE_SIZE,
                   (x - x0) * TILE_SIZE:(x - x0 + 1) * TILE_SIZE] = tile_array(data)
    # Mosaic geo-extent (EPSG:3857).
    xmin = tile_bounds_3857(x0, y0, GRID_ZOOM)[0]
    ymax = tile_bounds_3857(x0, y0, GRID_ZOOM)[3]
    xmax = tile_bounds_3857(x1, y1, GRID_ZOOM)[2]
    ymin = tile_bounds_3857(x1, y1, GRID_ZOOM)[1]
    src_tf = transform_from_bounds(xmin, ymin, xmax, ymax, W, H)

    rows = int(round((LAT_MAX - LAT_MIN) / GRID_STEP)) + 1
    cols = int(round((LNG_MAX - LNG_MIN) / GRID_STEP)) + 1
    # NODE-aligned grid: lookup.ts treats data[r][c] as a POINT sample at exactly
    # (LAT_MIN + r*STEP, LNG_MIN + c*STEP). reproject() samples pixel CENTRES, so
    # pad the destination bounds by half a cell on every side. That makes the
    # pixel pitch exactly STEP and puts pixel centres on the nodes (e.g. row 0
    # centre = LAT_MAX, col 0 centre = LNG_MIN), eliminating the fencepost /
    # half-cell drift (~5 km at the country edges) that a plain edge-to-edge
    # transform_from_bounds(... cols, rows) would introduce.
    half = GRID_STEP / 2.0
    dst_tf = transform_from_bounds(
        LNG_MIN - half, LAT_MIN - half, LNG_MAX + half, LAT_MAX + half, cols, rows)
    assert abs(dst_tf.a - GRID_STEP) < 1e-9 and abs(-dst_tf.e - GRID_STEP) < 1e-9, \
        f"grid pixel pitch {dst_tf.a},{dst_tf.e} != STEP {GRID_STEP}"
    grid = np.full((rows, cols), np.nan, dtype="float32")
    reproject(mosaic, grid,
              src_transform=src_tf, src_crs="EPSG:3857",
              dst_transform=dst_tf, dst_crs="EPSG:4326",
              src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear)

    inside = geometry_mask(geoms_4326, (rows, cols), dst_tf, invert=True, all_touched=True)
    # OR in the gulf-fill regions (resampled from the 4326 fill raster).
    fill_grid = np.zeros((rows, cols), "uint8")
    reproject(fill.astype("uint8"), fill_grid, src_transform=mtf, src_crs="EPSG:4326",
              dst_transform=dst_tf, dst_crs="EPSG:4326", resampling=Resampling.nearest)
    inside = inside | (fill_grid > 0)
    valid = np.isfinite(grid) & (grid > 0) & inside
    grid = np.flipud(grid); valid = np.flipud(valid)   # row 0 = LAT_MIN
    quant = np.where(valid, np.round(grid * scale), 0).astype(int)

    payload = {
        "version": 1, "metric": metric, "height": h,
        "unit": cfg["unit"],
        "source": cfg["source_note"].format(h=h),
        "license": "CC BY 4.0 — Global Wind Atlas (DTU Wind Energy / World Bank)",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "bbox": [LAT_MIN, LNG_MIN, LAT_MAX, LNG_MAX],
        "step": GRID_STEP, "scale": scale, "shape": [rows, cols],
        "data": quant.flatten().tolist(),
    }
    os.makedirs(GRID_DIR, exist_ok=True)
    out = grid_path_for(metric, h)
    with open(out, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    vmax = max((v for v in payload["data"] if v > 0), default=0) / scale
    print(f"  [{metric} {h}m] grid {os.path.getsize(out)//1024} KB · {rows}×{cols} · "
          f"max {vmax:.1f} {cfg['unit']}")


# ── metadata.json — the single source of truth for the frontend ─────────────
def ramp_stops(cfg) -> list[dict]:
    """PALETTE fractions mapped onto the metric's [lo, hi] domain."""
    lo, hi = cfg["lo"], cfg["hi"]
    return [
        {"value": round(lo + f * (hi - lo), 2), "color": "#%02x%02x%02x" % rgb}
        for f, rgb in PALETTE
    ]


def emit_metadata():
    meta = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "attribution": ATTRIBUTION,
        # [lngMin, latMin, lngMax, latMax] — MapLibre raster-source `bounds`.
        "bounds": [LNG_MIN, LAT_MIN, LNG_MAX, LAT_MAX],
        "minzoom": MIN_ZOOM,
        "maxzoom": MAX_ZOOM,
        "metrics": {
            name: {
                "label": cfg["label"],
                "unit": cfg["unit"],
                "heights": cfg["heights"],
                "tilePath": (f"/wind-atlas/{cfg['tile_subdir']}/{{height}}/{{z}}/{{x}}/{{y}}.png"
                             if cfg["tile_subdir"]
                             else "/wind-atlas/{height}/{z}/{x}/{y}.png"),
                "gridPath": "/wind-atlas/grids/" + cfg["grid_name"].format(h="{height}"),
                "domain": [cfg["lo"], cfg["hi"]],
                "ramp": ramp_stops(cfg),
            }
            for name, cfg in METRICS.items()
        },
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"metadata.json written ({os.path.getsize(METADATA_PATH)} B)")


# ── Validation report — India-wide stats per existing grid ───────────────────
def emit_report():
    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "grids": {}}
    for metric, cfg in METRICS.items():
        for h in cfg["heights"]:
            p = grid_path_for(metric, h)
            if not os.path.exists(p):
                report["grids"][f"{metric}@{h}m"] = {"status": "missing"}
                continue
            with open(p) as f:
                g = json.load(f)
            vals = np.array([v for v in g["data"] if v > 0], dtype="float64") / g.get("scale", 1)
            if vals.size == 0:
                report["grids"][f"{metric}@{h}m"] = {"status": "empty"}
                continue
            report["grids"][f"{metric}@{h}m"] = {
                "status": "ok",
                "unit": cfg["unit"],
                "validCells": int(vals.size),
                "min": round(float(vals.min()), 2),
                "p50": round(float(np.percentile(vals, 50)), 2),
                "p90": round(float(np.percentile(vals, 90)), 2),
                "p99": round(float(np.percentile(vals, 99)), 2),
                "max": round(float(vals.max()), 2),
                "fileKB": os.path.getsize(p) // 1024,
            }
    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"validation report → {os.path.relpath(REPORT_PATH, WEB_ROOT)}")
    for k, v in report["grids"].items():
        print(f"  {k}: {v}")


def main():
    args = [a for a in sys.argv[1:]]
    metadata_only = "--metadata-only" in args
    args = [a for a in args if a != "--metadata-only"]

    # CLI: [metric] [heights…]. Bare heights (legacy invocation) imply speed.
    metrics = [a for a in args if a in METRICS]
    heights = [int(a) for a in args if a.isdigit()]
    if not metrics:
        metrics = ["speed"] if heights else list(METRICS)

    if metadata_only:
        emit_metadata()
        emit_report()
        return

    grid_only = os.environ.get("WIND_GRID_ONLY") == "1"
    ensure_geojson()
    geoms_4326, geoms_3857 = load_india_geoms()
    fill, mtf = build_fill_mask(geoms_4326)
    for metric in metrics:
        hs = heights or METRICS[metric]["heights"]
        for h in hs:
            assert h in METRICS[metric]["heights"], \
                f"height {h} not configured for {metric} (have {METRICS[metric]['heights']})"
            print(f"── {metric} @ {h} m{' (grid only)' if grid_only else ''} ──")
            bake_grid(metric, h, geoms_4326, fill, mtf)
            if not grid_only:
                bake_tiles(metric, h, geoms_3857, fill)
    emit_metadata()
    emit_report()
    print("Done.")


if __name__ == "__main__":
    main()
