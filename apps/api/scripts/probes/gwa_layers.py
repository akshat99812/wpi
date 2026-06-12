#!/usr/bin/env python3
"""Phase 0 probe — GWA TiTiler layer sampling + ANALYSIS_ZOOM pinning.

Run with the web venv python (has rasterio + numpy):
    /Users/akshatpatel/Desktop/wind/wce/apps/web/scripts/.venv/bin/python3 gwa_layers.py

What it does (Wind Site Analysis v10, plan.md Phase 0 items 1 + 5):
  1. For each needed gwa4 layer: /info (dtype, maxzoom) + exact-pixel z10
     samples at Muppandal (8.26N 77.55E) and Bhadla (27.53N 71.92E).
  2. Cross-checks Muppandal ws_mean_hgt100m against the repo's baked
     0.1-degree grid (apps/web/public/wind-atlas/grids/100m.json).
  3. Shear alpha at Muppandal via ln-ratio least squares over 50/100/150 m.
  4. Valid-pixel counts for a 5x5 km square at z9 vs z10 -> pins ANALYSIS_ZOOM
     (smallest zoom with >=300 valid pixels, capped by min layer maxzoom).
  5. Records the Muppandal cf_iec3 value -> golden-test band (value +/- 0.04).
  6. /statistics for cf_iec3 and rix (global value ranges), best-effort.

Output: single JSON document on stdout. Throwaway but re-runnable; no disk
cache (a run fetches ~20 small tiles). Read-only — touches no product code.
"""

import json
import math
import sys
import urllib.error
import urllib.request

import numpy as np
from rasterio.io import MemoryFile

BASE = "https://tiles-stag.ramtt.xyz/titiler/gwa4"
USER_AGENT = "wce-analysis-probe"
HTTP_TIMEOUT_S = 90

LAYERS = [
    "cf_iec3", "cf_iec2",
    "ws_mean_hgt50m", "ws_mean_hgt100m", "ws_mean_hgt150m",
    "pd_mean_hgt100m", "rix", "elevation",
]
CF_LAYERS = {"cf_iec3", "cf_iec2"}
STATS_LAYERS = ["cf_iec3", "rix"]

MUPPANDAL = {"name": "muppandal", "lat": 8.26, "lon": 77.55}
BHADLA = {"name": "bhadla", "lat": 27.53, "lon": 71.92}
# Rugged Western Ghats reference (Munnar) — checks whether rix is nodata
# everywhere or only over flat terrain.
RIX_RUGGED_REF = {"name": "munnarRugged", "lat": 10.0889, "lon": 77.0595}

GRID_100M_PATH = (
    "/Users/akshatpatel/Desktop/wind/wce/apps/web/public/wind-atlas/grids/100m.json"
)
WS100_GRID_TOLERANCE_MS = 0.3

SQUARE_HALF_SIDE_M = 2500.0          # 5x5 km AOI centered on Muppandal
MIN_VALID_PIXELS = 300
ZOOM_CANDIDATES = (9, 10)
GOLDEN_BAND_HALF_WIDTH = 0.04        # cf fraction units

EARTH_RADIUS_M = 6378137.0
METERS_PER_DEG_LAT = 111320.0


# ── HTTP + mercator helpers ──────────────────────────────────────────────────
def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
        return resp.read()


def get_json(url: str):
    return json.loads(http_get(url))


def lonlat_to_3857(lon: float, lat: float):
    x = math.radians(lon) * EARTH_RADIUS_M
    y = EARTH_RADIUS_M * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def merc_to_lonlat(x: np.ndarray, y: np.ndarray):
    lon = np.degrees(x / EARTH_RADIUS_M)
    lat = np.degrees(2 * np.arctan(np.exp(y / EARTH_RADIUS_M)) - math.pi / 2)
    return lon, lat


def tile_xy(lon: float, lat: float, z: int):
    n = 2 ** z
    xt = int((lon + 180.0) / 360.0 * n)
    r = math.radians(lat)
    yt = int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    return xt, yt


# ── Tile fetch + decode (in-memory cache per run) ────────────────────────────
_TILE_CACHE: dict = {}


def fetch_decoded_tile(layer: str, z: int, x: int, y: int):
    """-> (float32 array with NaN nodata, affine transform) or None on 404."""
    key = (layer, z, x, y)
    if key in _TILE_CACHE:
        return _TILE_CACHE[key]
    url = f"{BASE}/{layer}/tiles/{z}/{x}/{y}.tif"
    try:
        data = http_get(url)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            _TILE_CACHE[key] = None
            return None
        raise RuntimeError(f"tile fetch failed {url}: HTTP {err.code}") from err
    with MemoryFile(data) as mf, mf.open() as ds:
        arr = ds.read(1, masked=True).astype("float32").filled(np.nan)
        decoded = (arr, ds.transform)
    _TILE_CACHE[key] = decoded
    return decoded


def sample_pixel(layer: str, z: int, lon: float, lat: float):
    """Exact pixel value containing (lon, lat) at zoom z; None if nodata/404."""
    xt, yt = tile_xy(lon, lat, z)
    decoded = fetch_decoded_tile(layer, z, xt, yt)
    if decoded is None:
        return None
    arr, tf = decoded
    mx, my = lonlat_to_3857(lon, lat)
    col = int((mx - tf.c) / tf.a)
    row = int((my - tf.f) / tf.e)
    if not (0 <= row < arr.shape[0] and 0 <= col < arr.shape[1]):
        return None
    val = float(arr[row, col])
    return None if math.isnan(val) else val


# ── Task 1: layer info + point samples ───────────────────────────────────────
def probe_layers():
    layer_info, samples = [], {p["name"]: {} for p in (MUPPANDAL, BHADLA)}
    for layer in LAYERS:
        info = get_json(f"{BASE}/{layer}/info")
        entry = {
            "name": layer,
            "dtype": str(info.get("dtype")),
            "maxzoom": info.get("maxzoom"),
            "bounds": info.get("bounds"),
        }
        for point in (MUPPANDAL, BHADLA):
            val = sample_pixel(layer, 10, point["lon"], point["lat"])
            samples[point["name"]][layer] = val
        if layer in CF_LAYERS:
            entry["cfUnitsEmpirical"] = classify_cf_units(
                [samples[p["name"]][layer] for p in (MUPPANDAL, BHADLA)]
            )
        layer_info.append(entry)
    return layer_info, samples


def classify_cf_units(values) -> str:
    finite = [v for v in values if v is not None]
    if not finite:
        return "indeterminate (no finite samples)"
    if all(0.0 <= v <= 1.0 for v in finite):
        return "fraction 0-1"
    if all(0.0 <= v <= 100.0 for v in finite):
        return "percent 0-100"
    return f"indeterminate (values {finite})"


# ── Task 2: baked-grid cross-check ───────────────────────────────────────────
def baked_grid_value(path: str, lat: float, lon: float):
    """Nearest-node + bilinear reads of the repo's 0.1-deg baked grid.
    Payload: bbox [latMin, lngMin, latMax, lngMax], row 0 = latMin, row-major,
    value = int / scale, 0 = invalid."""
    with open(path) as f:
        g = json.load(f)
    lat_min, lng_min = g["bbox"][0], g["bbox"][1]
    step, scale = g["step"], g["scale"]
    rows, cols = g["shape"]
    data = g["data"]

    def node(r: int, c: int):
        if not (0 <= r < rows and 0 <= c < cols):
            return None
        raw = data[r * cols + c]
        return raw / scale if raw > 0 else None

    rf, cf = (lat - lat_min) / step, (lon - lng_min) / step
    nearest = node(round(rf), round(cf))
    r0, c0 = int(math.floor(rf)), int(math.floor(cf))
    corners = [node(r0, c0), node(r0, c0 + 1), node(r0 + 1, c0), node(r0 + 1, c0 + 1)]
    bilinear = None
    if all(v is not None for v in corners):
        fr, fc = rf - r0, cf - c0
        top = corners[0] * (1 - fc) + corners[1] * fc
        bot = corners[2] * (1 - fc) + corners[3] * fc
        bilinear = top * (1 - fr) + bot * fr
    return {"nearestNode": nearest, "bilinear": bilinear, "unit": g.get("unit")}


# ── Task 3: shear alpha (ln-ratio least squares over 50/100/150 m) ──────────
def shear_alpha(speeds_by_height: dict):
    pairs = [(h, v) for h, v in speeds_by_height.items() if v is not None and v > 0]
    if len(pairs) < 2:
        return None
    ln_h = np.log([h for h, _ in pairs])
    ln_v = np.log([v for _, v in pairs])
    dh = ln_h - ln_h.mean()
    return float(np.sum(dh * (ln_v - ln_v.mean())) / np.sum(dh * dh))


# ── Task 4: valid-pixel counts for the 5x5 km square at z9/z10 ───────────────
def square_bounds_deg(lat: float, lon: float, half_side_m: float):
    dlat = half_side_m / METERS_PER_DEG_LAT
    dlon = half_side_m / (METERS_PER_DEG_LAT * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def count_valid_pixels(layer: str, z: int, bounds_deg) -> int:
    """Pixels whose CENTER falls inside the lat/lon-aligned square and whose
    value is finite and > 0, over the actual decoded z tiles."""
    west, south, east, north = bounds_deg
    x0, y0 = tile_xy(west, north, z)   # NW tile
    x1, y1 = tile_xy(east, south, z)   # SE tile
    total = 0
    for xt in range(x0, x1 + 1):
        for yt in range(y0, y1 + 1):
            decoded = fetch_decoded_tile(layer, z, xt, yt)
            if decoded is None:
                continue
            arr, tf = decoded
            h, w = arr.shape
            cols_x = tf.c + (np.arange(w) + 0.5) * tf.a
            rows_y = tf.f + (np.arange(h) + 0.5) * tf.e
            lon_g, lat_g = merc_to_lonlat(
                np.broadcast_to(cols_x, (h, w)),
                np.broadcast_to(rows_y[:, None], (h, w)),
            )
            inside = (
                (lon_g >= west) & (lon_g <= east)
                & (lat_g >= south) & (lat_g <= north)
            )
            total += int(np.sum(inside & np.isfinite(arr) & (arr > 0)))
    return total


def area_mean(layer: str, z: int, bounds_deg):
    """Mean of valid (finite, >0) pixel values whose centers fall in bounds."""
    west, south, east, north = bounds_deg
    x0, y0 = tile_xy(west, north, z)
    x1, y1 = tile_xy(east, south, z)
    acc = []
    for xt in range(x0, x1 + 1):
        for yt in range(y0, y1 + 1):
            decoded = fetch_decoded_tile(layer, z, xt, yt)
            if decoded is None:
                continue
            arr, tf = decoded
            h, w = arr.shape
            cols_x = tf.c + (np.arange(w) + 0.5) * tf.a
            rows_y = tf.f + (np.arange(h) + 0.5) * tf.e
            lon_g, lat_g = merc_to_lonlat(
                np.broadcast_to(cols_x, (h, w)),
                np.broadcast_to(rows_y[:, None], (h, w)),
            )
            inside = (
                (lon_g >= west) & (lon_g <= east)
                & (lat_g >= south) & (lat_g <= north)
            )
            keep = inside & np.isfinite(arr) & (arr > 0)
            acc.extend(arr[keep].tolist())
    return float(np.mean(acc)) if acc else None


def pin_analysis_zoom(counts: dict, min_layer_maxzoom: int):
    eligible = [
        z for z in ZOOM_CANDIDATES
        if counts[z] >= MIN_VALID_PIXELS and z <= min_layer_maxzoom
    ]
    return min(eligible) if eligible else None


# ── Task 6: global statistics (best-effort) ──────────────────────────────────
def fetch_statistics(layer: str):
    try:
        stats = get_json(f"{BASE}/{layer}/statistics")
    except Exception as err:  # noqa: BLE001 — best-effort probe
        return {"error": f"{type(err).__name__}: {err}"}
    flat = stats.get("b1", stats)
    if isinstance(flat, dict):
        keep = {k: flat[k] for k in ("min", "max", "mean", "std") if k in flat}
        return keep or flat
    return stats


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    layer_info, samples = probe_layers()
    mup, bha = samples["muppandal"], samples["bhadla"]

    grid = baked_grid_value(GRID_100M_PATH, MUPPANDAL["lat"], MUPPANDAL["lon"])
    tile_ws100 = mup.get("ws_mean_hgt100m")
    grid_ref = grid["bilinear"] if grid["bilinear"] is not None else grid["nearestNode"]
    ws100_delta = (
        abs(tile_ws100 - grid_ref)
        if tile_ws100 is not None and grid_ref is not None else None
    )
    # Resolution diagnostic: the baked grid was built from z6 tiles (~2.4 km
    # pixels) bilinearly resampled to 0.1-deg nodes, so an exact z10 (~250 m)
    # pixel can legitimately differ in a sharp corridor. If the z6 sample and
    # the 0.1-deg-area z10 mean both land near the grid value, decoding is
    # consistent and any delta is a resolution effect, not a units/decode bug.
    half_cell = 0.05
    cell_bounds = (
        MUPPANDAL["lon"] - half_cell, MUPPANDAL["lat"] - half_cell,
        MUPPANDAL["lon"] + half_cell, MUPPANDAL["lat"] + half_cell,
    )
    # True 0.1-deg grid nodes flanking the point (floor to the node lattice).
    node_lat = math.floor(MUPPANDAL["lat"] * 10) / 10
    node_lon = math.floor(MUPPANDAL["lon"] * 10) / 10
    resolution_diag = {
        "z6PixelValue": sample_pixel(
            "ws_mean_hgt100m", 6, MUPPANDAL["lon"], MUPPANDAL["lat"]
        ),
        "z10MeanOver0p1DegCell": area_mean("ws_mean_hgt100m", 10, cell_bounds),
        "surroundingNodes": [
            {
                "lat": lat, "lon": lon,
                "z10Pixel": sample_pixel("ws_mean_hgt100m", 10, lon, lat),
                "bakedNearestNode": baked_grid_value(
                    GRID_100M_PATH, lat, lon
                )["nearestNode"],
            }
            for lat in (node_lat, round(node_lat + 0.1, 1))
            for lon in (node_lon, round(node_lon + 0.1, 1))
        ],
    }

    alpha = shear_alpha({
        50: mup.get("ws_mean_hgt50m"),
        100: mup.get("ws_mean_hgt100m"),
        150: mup.get("ws_mean_hgt150m"),
    })

    bounds = square_bounds_deg(MUPPANDAL["lat"], MUPPANDAL["lon"], SQUARE_HALF_SIDE_M)
    counts = {z: count_valid_pixels("ws_mean_hgt100m", z, bounds) for z in ZOOM_CANDIDATES}
    maxzooms = [e["maxzoom"] for e in layer_info if isinstance(e["maxzoom"], int)]
    min_maxzoom = min(maxzooms) if maxzooms else None
    pinned = pin_analysis_zoom(counts, min_maxzoom) if min_maxzoom is not None else None

    cf3 = mup.get("cf_iec3")
    golden = None
    if cf3 is not None:
        golden = {
            "muppandalValue": cf3,
            "suggestedBand": f"{cf3 - GOLDEN_BAND_HALF_WIDTH:.4f}"
                             f"-{cf3 + GOLDEN_BAND_HALF_WIDTH:.4f} (fraction)",
        }

    result = {
        "layerInfo": layer_info,
        "samples": samples,
        "ws100GridCheck": {
            "tileValueZ10": tile_ws100,
            "bakedGrid": grid,
            "absDelta": ws100_delta,
            "toleranceMs": WS100_GRID_TOLERANCE_MS,
            "withinTolerance": (
                ws100_delta is not None and ws100_delta <= WS100_GRID_TOLERANCE_MS
            ),
            "resolutionDiagnostic": resolution_diag,
        },
        "rixRuggedReference": {
            "point": RIX_RUGGED_REF,
            "value": sample_pixel(
                "rix", 10, RIX_RUGGED_REF["lon"], RIX_RUGGED_REF["lat"]
            ),
        },
        "shearAlphaMuppandal": alpha,
        "zoom": {
            "validPixels": counts,
            "minLayerMaxzoom": min_maxzoom,
            "analysisZoom": pinned,
        },
        "cfIec3GoldenBand": golden,
        "statistics": {layer: fetch_statistics(layer) for layer in STATS_LAYERS},
    }
    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
