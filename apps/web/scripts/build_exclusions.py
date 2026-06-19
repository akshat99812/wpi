#!/usr/bin/env python3
"""
Pre-bake the state wind-exclusion KMZ SuperOverlays into a static XYZ raster
tile pyramid the Pro map serves with ZERO runtime dependency on GDAL or any
tile service — mirroring the Global Wind Atlas bake (build_wind_atlas.py).

INPUT  — apps/api/data/exclusion/*.kmz
  Each .kmz is a GDAL `kmlsuperoverlay` export: a doc.kml describing ~313
  GroundOverlay image tiles in a 6-level LOD pyramid (L1 coarse → L6 finest,
  ~46 m/px), each georeferenced by a <LatLonBox> in WGS84 (EPSG:4326). The
  tiles are 8-bit RGB-palette TIFFs — pre-rendered exclusion maps per state,
  fully opaque (no alpha). Seven distinct states: AP, Karnataka, Maharashtra,
  MP, Rajasthan, Tamil Nadu, Telangana. (The byte-identical Karnataka "(1)"
  duplicate is skipped — see SKIP_FILES.)

OUTPUT — apps/web/public/exclusions/
  1. {z}/{x}/{y}.png  — XYZ raster pyramid (EPSG:3857, z5–z11) with the
     background keyed to transparent so only the coloured exclusion features
     overlay the basemap. Adjacent states composite into shared edge tiles.
  2. metadata.json    — the single source of truth the frontend imports for
     bounds, zoom range, attribution, per-state list, and the tile URL
     template (no hand-mirrored TS constants).

WHY pure numpy + PIL (not GDAL): brew's GDAL pulls 124 deps (~5 GB) and the
dev disk was full; the KMZ is already a georeferenced tile pyramid, so the
reproject-and-retile is done here directly. numpy + Pillow are already present.

TRANSPARENCY: the source tiles are opaque rectangles — the out-of-state
background is pale-yellow (255,255,206) and the in-state base is white. Both
(and near-white anti-aliasing) are keyed to alpha 0, leaving only the coloured
features (water blues, greens, boundary blacks/greys). Tune _is_background if
the provider's colour legend differs.

Idempotent: re-running clears z5–z11 first, so stale tiles never linger.

Run:
    python3 apps/web/scripts/build_exclusions.py
    python3 apps/web/scripts/build_exclusions.py --max-zoom 12   # deeper (bigger)

Dependencies: numpy, Pillow (no GDAL, no venv).
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone

import numpy as np
from PIL import Image

# ── Paths ────────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.normpath(os.path.join(HERE, ".."))
REPO_ROOT = os.path.normpath(os.path.join(WEB_ROOT, "..", ".."))
SRC_DIR = os.path.join(REPO_ROOT, "apps", "api", "data", "exclusion")
OUT_DIR = os.path.join(WEB_ROOT, "public", "exclusions")
METADATA_PATH = os.path.join(OUT_DIR, "metadata.json")

# Byte-identical duplicate of "3_Karnataka state Feb 2024.kmz" — skip it.
SKIP_FILES = {"3_Karnataka state Feb 2024 (1).kmz"}

# ── Tiling spec ──────────────────────────────────────────────────────────────
TILE_SIZE = 256
# minzoom 3 so the overlay is visible at the Pro map's opening view (zoom ~4.4,
# minZoom 4) — MapLibre does not draw a raster below its source minzoom.
MIN_ZOOM = 3
MAX_ZOOM = 11               # ~native L6 resolution; MapLibre over-zooms past it
VERSION = "2"               # bump after a re-bake so clients refetch
ATTRIBUTION = "Wind-exclusion zones — state SuperOverlay data (2024)"

# Minimum chroma — max(R,G,B) − min(R,G,B) — for a pixel to be KEPT. The source
# renders the data as SATURATED colour (green zone fills, cyan/red outlines &
# markers) over GREYSCALE cartography: white interior, black state-extent
# rectangles / boundaries / text / legend boxes, plus a near-grey pale-yellow
# out-of-state fill (chroma 49). Keeping only chromatic pixels drops every bit
# of that line-work + both backgrounds, leaving just the marked zones.
CHROMA_MIN = 60

OS_SHIFT = math.pi * 6378137.0  # web-mercator origin shift
R_EARTH = 6378137.0


def _is_data(rgb: np.ndarray) -> np.ndarray:
    """True for chromatic (coloured) pixels — exclusion-zone fills/outlines and
    markers — False for greyscale cartography (white/black/grey line-work) and
    the pale-yellow background, which are keyed to transparent."""
    a = rgb.astype(np.int16)
    return (a.max(axis=2) - a.min(axis=2)) >= CHROMA_MIN


# ── Web-mercator tile helpers (slippy / XYZ) ─────────────────────────────────
def lng_to_tilex(lng: float, n: int) -> float:
    return (lng + 180.0) / 360.0 * n


def lat_to_tiley(lat: float, n: int) -> float:
    r = math.radians(max(min(lat, 85.05112878), -85.05112878))
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def tile_pixel_lnglat(x: int, y: int, z: int):
    """Per-pixel lng (per column) and lat (per row, row0 = north) arrays for a
    TILE_SIZE² XYZ tile in EPSG:3857."""
    n = 2 ** z
    mx0 = x / n * 2 * OS_SHIFT - OS_SHIFT
    mx1 = (x + 1) / n * 2 * OS_SHIFT - OS_SHIFT
    my_north = OS_SHIFT - y / n * 2 * OS_SHIFT
    my_south = OS_SHIFT - (y + 1) / n * 2 * OS_SHIFT
    mx = mx0 + (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE * (mx1 - mx0)
    my = my_north - (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE * (my_north - my_south)
    lng = mx / OS_SHIFT * 180.0
    lat = np.degrees(2 * np.arctan(np.exp(my / R_EARTH)) - math.pi / 2)
    return lng, lat


# ── Source KMZ model ─────────────────────────────────────────────────────────
class StateOverlay:
    """One state's KMZ: parsed doc.kml grouped by LOD level + a small LRU cache
    of decoded, background-keyed RGBA source tiles."""

    def __init__(self, path: str, cache_size: int = 48):
        self.path = path
        self.zf = zipfile.ZipFile(path)
        self.name, self.levels = self._parse()
        # Per-level resolution (px per degree of longitude) from a sample tile.
        self.level_res: dict[int, float] = {}
        for lvl, tiles in self.levels.items():
            href, n, s, e, w = tiles[0]
            tw, _ = self._tile_size(href)
            self.level_res[lvl] = tw / (e - w)
        self.levels_sorted = sorted(self.levels)  # coarse → fine
        # Overall WGS84 bounds (from the finest level, which spans the state).
        finest = self.levels[self.levels_sorted[-1]]
        self.west = min(t[4] for t in finest)
        self.east = max(t[3] for t in finest)
        self.south = min(t[2] for t in finest)
        self.north = max(t[1] for t in finest)
        self._cache: "OrderedDict[str, np.ndarray]" = OrderedDict()
        self._cache_size = cache_size

    def _parse(self):
        kml = self.zf.read("doc.kml").decode("iso-8859-1")
        kml = re.sub(r'\sxmlns="[^"]+"', "", kml, count=1)  # drop default ns
        root = ET.fromstring(kml)
        doc_name = (root.findtext(".//Document/name") or
                    os.path.basename(self.path)).strip()
        levels: dict[int, list] = defaultdict(list)
        for go in root.iter("GroundOverlay"):
            href = go.findtext("./Icon/href")
            box = go.find("LatLonBox")
            if href is None or box is None:
                continue
            n = float(box.findtext("north"))
            s = float(box.findtext("south"))
            e = float(box.findtext("east"))
            w = float(box.findtext("west"))
            m = re.match(r"kml_image_L(\d+)_", href)
            if not m:
                continue
            levels[int(m.group(1))].append((href, n, s, e, w))
        return doc_name, levels

    def _tile_size(self, href: str):
        with Image.open(io.BytesIO(self.zf.read(href))) as im:
            return im.size  # (w, h)

    def load_rgba(self, href: str) -> np.ndarray:
        cached = self._cache.get(href)
        if cached is not None:
            self._cache.move_to_end(href)
            return cached
        with Image.open(io.BytesIO(self.zf.read(href))) as im:
            arr = np.asarray(im.convert("RGB"))  # expands palette → (h, w, 3)
        alpha = np.where(_is_data(arr), 255, 0).astype(np.uint8)
        rgba = np.dstack([arr, alpha])
        self._cache[href] = rgba
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return rgba

    def pick_level(self, out_res_lng: float) -> int:
        """Finest LOD whose resolution is still ≥ the output tile's resolution
        (near-1:1 sampling); falls back to the finest level available."""
        for lvl in self.levels_sorted:           # coarse → fine
            if self.level_res[lvl] >= out_res_lng:
                return lvl
        return self.levels_sorted[-1]


def render_tile(state: StateOverlay, lvl: int, lng: np.ndarray,
                lat: np.ndarray) -> np.ndarray | None:
    """Nearest-sample this state's LOD-`lvl` tiles onto a TILE_SIZE² RGBA tile
    for the given per-column lng / per-row lat. Returns None if nothing covered.
    Tiles within a level partition the state, so each output pixel maps to at
    most one source tile (half-open [W,E) / (S,N] avoids double-write)."""
    out = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)
    touched = False
    lng_lo, lng_hi = lng[0], lng[-1]
    lat_hi, lat_lo = lat[0], lat[-1]  # row 0 = north
    for href, n, s, e, w in state.levels[lvl]:
        if e <= lng_lo or w >= lng_hi or s >= lat_hi or n <= lat_lo:
            continue  # source tile doesn't overlap this output tile
        tile = state.load_rgba(href)
        th, tw = tile.shape[0], tile.shape[1]
        col = ((lng - w) / (e - w) * tw).astype(np.int64)
        row = ((n - lat) / (n - s) * th).astype(np.int64)
        valid_col = (lng >= w) & (lng < e)
        valid_row = (lat <= n) & (lat > s)
        if not valid_col.any() or not valid_row.any():
            continue
        ci = np.clip(col, 0, tw - 1)
        ri = np.clip(row, 0, th - 1)
        sub = tile[np.ix_(ri, ci)]  # (TILE_SIZE, TILE_SIZE, 4)
        mask = valid_row[:, None] & valid_col[None, :] & (sub[..., 3] > 0)
        if mask.any():
            out[mask] = sub[mask]
            touched = True
    return out if touched else None


# ── Bake driver ──────────────────────────────────────────────────────────────
def load_states() -> list[StateOverlay]:
    if not os.path.isdir(SRC_DIR):
        sys.exit(f"source dir not found: {SRC_DIR}")
    files = sorted(
        f for f in os.listdir(SRC_DIR)
        if f.lower().endswith(".kmz") and f not in SKIP_FILES
    )
    if not files:
        sys.exit(f"no .kmz files in {SRC_DIR}")
    states = []
    for f in files:
        st = StateOverlay(os.path.join(SRC_DIR, f))
        states.append(st)
        print(f"  {f} → {st.name}: levels {st.levels_sorted}, "
              f"bbox W{st.west:.3f} S{st.south:.3f} E{st.east:.3f} N{st.north:.3f}")
    return states


def clear_tiles(max_zoom: int) -> None:
    for z in range(MIN_ZOOM, max_zoom + 1):
        d = os.path.join(OUT_DIR, str(z))
        if os.path.isdir(d):
            shutil.rmtree(d)


def composite_save(path: str, tile: np.ndarray) -> None:
    """Write `tile`, alpha-compositing over any existing tile (adjacent state)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fill = tile[..., 3] > 0
    if os.path.exists(path):
        with Image.open(path) as im:
            base = np.asarray(im.convert("RGBA")).copy()
        base[fill] = tile[fill]
        out = base
    else:
        out = tile
    Image.fromarray(out, "RGBA").save(path, optimize=True)


def bake(max_zoom: int) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Loading source KMZ …")
    states = load_states()
    print(f"Clearing existing tiles z{MIN_ZOOM}–z{max_zoom} …")
    clear_tiles(max_zoom)

    written = 0
    for z in range(MIN_ZOOM, max_zoom + 1):
        n = 2 ** z
        out_res_lng = TILE_SIZE * n / 360.0  # px per degree lng at this zoom
        z_written = 0
        for st in states:
            lvl = st.pick_level(out_res_lng)
            x0 = max(0, int(math.floor(lng_to_tilex(st.west, n))))
            x1 = min(n - 1, int(math.floor(lng_to_tilex(st.east, n))))
            y0 = max(0, int(math.floor(lat_to_tiley(st.north, n))))
            y1 = min(n - 1, int(math.floor(lat_to_tiley(st.south, n))))
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    lng, lat = tile_pixel_lnglat(x, y, z)
                    tile = render_tile(st, lvl, lng, lat)
                    if tile is None:
                        continue
                    composite_save(
                        os.path.join(OUT_DIR, str(z), str(x), f"{y}.png"), tile)
                    z_written += 1
            st._cache.clear()  # free the level's tile cache between states
        written += z_written
        print(f"  z{z}: {z_written} tiles written")

    write_metadata(states, max_zoom, written)
    print(f"Done — {written} tiles in {OUT_DIR}")


def write_metadata(states: list[StateOverlay], max_zoom: int, written: int) -> None:
    west = min(st.west for st in states)
    south = min(st.south for st in states)
    east = max(st.east for st in states)
    north = max(st.north for st in states)
    meta = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "attribution": ATTRIBUTION,
        # [lngMin, latMin, lngMax, latMax] — MapLibre raster-source `bounds`.
        "bounds": [round(west, 6), round(south, 6), round(east, 6), round(north, 6)],
        "minzoom": MIN_ZOOM,
        "maxzoom": max_zoom,
        "tilePath": "/exclusions/{z}/{x}/{y}.png",
        "tileVersion": VERSION,
        "tileCount": written,
        "states": [
            {
                "name": st.name,
                "bounds": [round(st.west, 6), round(st.south, 6),
                           round(st.east, 6), round(st.north, 6)],
            }
            for st in states
        ],
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"metadata.json written ({os.path.getsize(METADATA_PATH)} B) — "
          f"{len(states)} states, bounds {meta['bounds']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Bake exclusion KMZ → XYZ tiles")
    ap.add_argument("--max-zoom", type=int, default=MAX_ZOOM,
                    help=f"deepest zoom to bake (default {MAX_ZOOM})")
    args = ap.parse_args()
    bake(args.max_zoom)


if __name__ == "__main__":
    main()
