#!/usr/bin/env python3
"""
Pre-bake the state Ministry-of-Defence (MoD) wind-clearance KMZ SuperOverlays
into a static XYZ raster tile pyramid the Pro map serves with ZERO runtime
dependency on GDAL or any tile service — mirroring the Global Wind Atlas bake
(build_wind_atlas.py) and the earlier exclusion bake.

INPUT  — apps/api/data/exclusion/*.kmz
  Each .kmz is a GDAL `kmlsuperoverlay` export: a doc.kml describing a multi-
  level LOD pyramid of GroundOverlay image tiles (L1 coarse → L6 finest,
  ~46 m/px), each georeferenced by a <LatLonBox> in WGS84 (EPSG:4326). The
  tiles are 8-bit RGB-palette TIFFs — the official MoD clearance maps rendered
  per state. Seven distinct states: AP, Karnataka, Maharashtra, MP, Rajasthan,
  Tamil Nadu, Telangana. (The byte-identical Karnataka "(1)" duplicate is
  skipped — see SKIP_FILES.)

  The maps mark up to THREE zone categories, hatched over greyscale cartography:
    • "No WTG Zone"            — RED hatch,   black border → hard exclusion
    • "NOC to be obtained"     — YELLOW hatch, cyan border → defence NOC needed
    • "NOC not required from MoD (subject to conditions — refer attached PDF
      provided by MoD)"        — GREEN hatch,  blue border → pre-cleared
  Not every state uses all three (MP / Telangana carry only the green class).

OUTPUT — apps/web/public/mod-zones/
  1. {z}/{x}/{y}.png  — XYZ raster pyramid (EPSG:3857, z{MIN}–z{MAX}) where each
     category is rendered as a CLEAN SOLID FILL in a canonical traffic-light
     colour (red / amber / green), so the overlay reads like the vector
     exclusion layer rather than raw cartographic hatching. Adjacent states
     composite into shared edge tiles.
  2. metadata.json    — the single source of truth the frontend imports for
     bounds, zoom range, attribution, the category legend, per-state coverage,
     and the tile URL template (no hand-mirrored TS constants).

WHY solid fills (not the source hatch): the source renders each zone as sparse
cross-hatch (~20% coverage) over white/pale-yellow background. We classify each
pixel by hue into the three categories, drop all cartography + borders + water,
morphologically close + fill-holes each class into a solid mask (on the full
stitched state image, so blocks that span source tiles fill seamlessly), then
recolour to the canonical palette. The result is faithful to the legend and
visually consistent with the Pro map's other zone overlays.

WHY pure numpy + PIL + scipy (not GDAL): brew's GDAL pulls a huge dep tree; the
KMZ is already a georeferenced tile pyramid, so the reproject-and-retile is done
here directly. numpy / Pillow / scipy are already present.

Idempotent: re-running clears the tile pyramid first, so stale tiles never
linger.

Run:
    python3 apps/web/scripts/build_mod_zones.py
    python3 apps/web/scripts/build_mod_zones.py --max-zoom 11   # deeper (bigger)

Dependencies: numpy, Pillow, scipy (no GDAL, no venv).
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import shutil
import statistics
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None  # the stitched per-state canvases are large

# ── Paths ────────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.normpath(os.path.join(HERE, ".."))
REPO_ROOT = os.path.normpath(os.path.join(WEB_ROOT, "..", ".."))
SRC_DIR = os.path.join(REPO_ROOT, "apps", "api", "data", "exclusion")
OUT_DIR = os.path.join(WEB_ROOT, "public", "mod-zones")
METADATA_PATH = os.path.join(OUT_DIR, "metadata.json")
# State boundaries used to clip each map to its state — this drops the
# cartographic legend / title / scale-bar (drawn in the map margin, OUTSIDE the
# state) whose coloured swatches would otherwise classify as spurious zones.
BOUNDARIES_PATH = os.path.join(WEB_ROOT, "public", "india-states.geojson")

# Byte-identical duplicate of "3_Karnataka state Feb 2024.kmz" — skip it.
SKIP_FILES = {"3_Karnataka state Feb 2024 (1).kmz"}

# KMZ filename token (2nd underscore-field, first word) → ST_NM in the
# boundaries GeoJSON. Used to pick the clip polygon per state.
STATE_NM = {
    "AP": "Andhra Pradesh",
    "Karnataka": "Karnataka",
    "Maharastra": "Maharashtra",
    "MP": "Madhya Pradesh",
    "Rajasthan": "Rajasthan",
    "TamilNadu": "Tamil Nadu",
    "Telangana": "Telangana",
}

# Dilate the state polygon by this many stitched-pixels before clipping (~STITCH
# _SCALE·46 m each ≈ 3.7 km at 40 px) so zones that hug a coarse/simplified
# coastline or border are not shaved off, while the legend — always ≫ this far
# out in the map margin/sea — is still removed.
BOUNDARY_BUFFER_PX = 40

# ── Tiling spec ──────────────────────────────────────────────────────────────
TILE_SIZE = 256
# minzoom 3 so the overlay is visible at the Pro map's opening view (zoom ~4.4,
# minZoom 4) — MapLibre does not draw a raster below its source minzoom.
MIN_ZOOM = 3
# maxzoom 10 is ample for solid fills; MapLibre over-zooms (upscales) past it
# rather than 404ing on deeper tiles.
MAX_ZOOM = 10
VERSION = "1"  # bump after a re-bake so clients refetch (flows into metadata)
ATTRIBUTION = "Ministry of Defence wind-clearance maps — state-wise, 2024"

# Stitch scale: fraction of native LOD resolution used for the per-state canvas.
# 0.5 → ~92 m/px, finer than z10's ~148 m/px near 15°N, so no output detail is
# lost; halves the memory of a full-native stitch.
STITCH_SCALE = 0.5
# Morphological-closing radius (px, at STITCH_SCALE) used to bridge the source
# cross-hatch into a solid mask before fill-holes. Tuned against the ~92 m/px
# canvas; scale it with STITCH_SCALE if that changes.
CLOSE_RADIUS = 6

OS_SHIFT = math.pi * 6378137.0  # web-mercator origin shift
R_EARTH = 6378137.0

# ── Zone categories (canonical, cross-state) ─────────────────────────────────
# Order = draw/legend priority, most-restrictive first. `color` is the solid
# fill baked into the tiles AND surfaced to the frontend legend via metadata,
# so the map and the legend can never drift.
CATEGORIES = [
    {
        "key": "no_wtg",
        "label": "No WTG Zone",
        "desc": "No wind turbines permitted (defence restriction).",
        "color": [220, 38, 38],  # red-600
    },
    {
        "key": "noc_required",
        "label": "NOC to be obtained",
        "desc": "Defence NOC (No Objection Certificate) required before development.",
        "color": [217, 119, 6],  # amber-600
    },
    {
        "key": "noc_not_required",
        "label": "NOC not required from MoD",
        "desc": "No defence NOC required (subject to conditions — refer the MoD PDF).",
        "color": [22, 163, 74],  # green-600
    },
]


def _disk(radius: int) -> np.ndarray:
    """Boolean disk structuring element of the given pixel radius."""
    y, x = np.ogrid[-radius : radius + 1, -radius : radius + 1]
    return (x * x + y * y) <= radius * radius


def classify(rgb: np.ndarray) -> dict[str, np.ndarray]:
    """Hue-classify a stitched RGB state image into the three MoD zone classes.

    Keys the fill colour of each hatched zone (not its border), so cartographic
    line-work, block borders (cyan / blue), water (blue) and both backgrounds
    (white / pale-yellow) all fall through to nothing. Thresholds are grounded
    in the source palette:
      • red    "No WTG"             [240,0,0] / [192,0,0]        → R dominant
      • yellow "NOC to be obtained" [240,240,0..120]            → R,G high, B low
      • green  "NOC not required"   [48,144,0] / [120,192,0]     → G>R, B low
    (cyan border [0,240,192] and blue border/water [0,72,216] are excluded by
    the B ceiling / the R,G floors.)
    """
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    # numpy's in-place temporary-elision optimisation misfires under Python
    # 3.14's refcounting: on large arrays it recycles the buffer of a *live*
    # operand as the output of a binary/unary op, silently corrupting it (e.g.
    # `r - max(g,b)` scribbles over `r`; `~noc_required` inverts itself). We
    # neutralise it two ways: (1) predicates use `a >= b + k` not `a - b >= k`,
    # and (2) every array reused as an operand below is marked READ-ONLY, so
    # numpy is forbidden from ever recycling its buffer.
    for chan in (r, g, b):
        chan.flags.writeable = False
    mx = np.maximum(g, b)
    mx.flags.writeable = False
    no_wtg = (r >= mx + 60) & (r >= 120)
    noc_required = (r >= 170) & (g >= 170) & (b <= 130)
    noc_required.flags.writeable = False  # guards the `~noc_required` below
    noc_not_required = (
        (~noc_required) & (g >= 110) & (g >= r + 25) & (b <= 130) & (g >= b + 40)
    )
    return {
        "no_wtg": no_wtg,
        "noc_required": noc_required,
        "noc_not_required": noc_not_required,
    }


def solidify(mask: np.ndarray) -> np.ndarray:
    """Close the sparse hatch mask and fill enclosed interiors into a solid
    region. Operates on the FULL stitched state image, so a zone spanning
    several source tiles fills without seams (the hatch never touches the image
    border, so fill-holes can only flood a genuinely enclosed block)."""
    closed = ndi.binary_closing(mask, structure=_disk(CLOSE_RADIUS))
    return ndi.binary_fill_holes(closed)


_BOUNDARIES: dict | None = None


def _state_polygons(name: str):
    """Return the named state's boundary as a list of polygons (each a list of
    rings: exterior first, then holes), or None if it isn't in the GeoJSON."""
    global _BOUNDARIES
    if _BOUNDARIES is None:
        with open(BOUNDARIES_PATH) as f:
            _BOUNDARIES = json.load(f)
    for feat in _BOUNDARIES["features"]:
        if feat["properties"].get("ST_NM") == name:
            geom = feat["geometry"]
            return (geom["coordinates"] if geom["type"] == "MultiPolygon"
                    else [geom["coordinates"]])
    return None


# ── Source KMZ model ─────────────────────────────────────────────────────────
class StateZones:
    """One state's KMZ, stitched + classified into a solid RGBA overlay on a
    regular WGS84 grid, ready to sample into web-mercator XYZ output tiles."""

    def __init__(self, path: str, scale: float = STITCH_SCALE):
        self.path = path
        zf = zipfile.ZipFile(path)
        kml = zf.read("doc.kml").decode("iso-8859-1")
        kml = re.sub(r'\sxmlns="[^"]+"', "", kml, count=1)  # drop default ns
        root = ET.fromstring(kml)
        self.name = (root.findtext(".//Document/name") or
                     os.path.basename(path)).strip()

        overlays: list[tuple[int, str, float, float, float, float]] = []
        for go in root.iter("GroundOverlay"):
            href = go.findtext("./Icon/href")
            box = go.find("LatLonBox")
            m = re.match(r"kml_image_L(\d+)_", href or "")
            if href is None or box is None or not m:
                continue
            overlays.append((
                int(m.group(1)),
                href,
                float(box.findtext("north")),
                float(box.findtext("south")),
                float(box.findtext("east")),
                float(box.findtext("west")),
            ))
        if not overlays:
            raise ValueError(f"no GroundOverlays parsed from {path}")

        level = max(o[0] for o in overlays)          # finest LOD spans the state
        finest = [o for o in overlays if o[0] == level]
        self.north = max(o[2] for o in finest)
        self.south = min(o[3] for o in finest)
        self.east = max(o[4] for o in finest)
        self.west = min(o[5] for o in finest)

        # Native degrees-per-pixel from the finest tiles, then the stitch grid.
        deg_w = statistics.median([(e - w) for (_, _, _, _, e, w) in finest])
        tile_w = Image.open(io.BytesIO(zf.read(finest[0][1]))).size[0]
        deg_per_px = deg_w / tile_w
        self.dpx = deg_per_px / scale                # deg per stitched pixel
        self.width = int(round((self.east - self.west) / self.dpx))
        self.height = int(round((self.north - self.south) / self.dpx))

        canvas = np.full((self.height, self.width, 3), 255, np.uint8)
        for (_, href, n, s, e, w) in finest:
            im = Image.open(io.BytesIO(zf.read(href))).convert("RGB")
            im = im.resize(
                (max(1, int(im.width * scale)), max(1, int(im.height * scale))),
                Image.BILINEAR,
            )
            a = np.asarray(im)
            x = int(round((w - self.west) / self.dpx))
            y = int(round((self.north - n) / self.dpx))
            canvas[y : y + a.shape[0], x : x + a.shape[1]] = (
                a[: self.height - y, : self.width - x]
            )

        # Classify → solidify → recolour to canonical RGBA. Claim pixels in
        # priority order (red, amber, green) so a dilated overlap goes to the
        # more-restrictive class; paint least-priority first so red ends on top.
        masks = classify(canvas)
        inside = self._inside_mask()  # clip to the state; drops the margin legend
        self.rgba = np.zeros((self.height, self.width, 4), np.uint8)
        self.present: dict[str, int] = {}
        solids: dict[str, np.ndarray] = {}
        claimed = np.zeros((self.height, self.width), bool)
        for cat in CATEGORIES:  # red → amber → green
            solid = solidify(masks[cat["key"]])
            solid &= inside  # keep only in-state zones (removes legend swatches)
            # Cede pixels already taken by a higher-priority class. Done by
            # in-place boolean-index masking rather than `solid & ~claimed`:
            # the unary `~claimed` hits the same Python-3.14 numpy elision bug
            # as classify() (it would invert `claimed` in place). See classify.
            solid[claimed] = False
            solids[cat["key"]] = solid
            claimed |= solid
        for cat in reversed(CATEGORIES):  # paint green first, red last (on top)
            solid = solids[cat["key"]]
            self.present[cat["key"]] = int(solid.sum())
            self.rgba[solid] = (*cat["color"], 255)
        del canvas

    def _ring_px(self, ring) -> list[tuple[float, float]]:
        """A WGS84 lng/lat ring → (x, y) pixel tuples on the stitched grid."""
        return [((lon - self.west) / self.dpx, (self.north - lat) / self.dpx)
                for lon, lat in ring]

    def _inside_mask(self) -> np.ndarray:
        """Boolean (height, width) mask — True inside this state's boundary
        (dilated by BOUNDARY_BUFFER_PX). Zones are clipped to it so the map's
        margin cartography (legend swatches, title, scale bar) is dropped. If
        the state has no boundary match, returns an all-True mask (no clip)."""
        token = os.path.basename(self.path).split("_", 1)[-1].split(" ", 1)[0]
        name = STATE_NM.get(token)
        polys = _state_polygons(name) if name else None
        if not polys:
            print(f"    (no boundary match for {token!r} — state clip skipped)")
            return np.ones((self.height, self.width), bool)
        img = Image.new("L", (self.width, self.height), 0)
        draw = ImageDraw.Draw(img)
        for poly in polys:
            draw.polygon(self._ring_px(poly[0]), fill=255)  # exterior
            for hole in poly[1:]:
                draw.polygon(self._ring_px(hole), fill=0)   # holes
        inside = np.asarray(img) > 0
        # Diamond dilation via iterations — far cheaper than a large disk element.
        return ndi.binary_dilation(inside, iterations=BOUNDARY_BUFFER_PX)


# ── Web-mercator tile helpers (slippy / XYZ) ─────────────────────────────────
def lng_to_tilex(lng: float, n: int) -> float:
    return (lng + 180.0) / 360.0 * n


def lat_to_tiley(lat: float, n: int) -> float:
    r = math.radians(max(min(lat, 85.05112878), -85.05112878))
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def tile_pixel_lnglat(x: int, y: int, z: int):
    """Per-column lng and per-row lat (row0 = north) arrays for a TILE_SIZE²
    XYZ tile in EPSG:3857."""
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


def render_tile(st: StateZones, lng: np.ndarray, lat: np.ndarray) -> np.ndarray | None:
    """Nearest-sample a state's solid RGBA overlay onto a TILE_SIZE² XYZ tile
    for the given per-column lng / per-row lat. Returns None if the tile covers
    no zone pixels."""
    col = np.round((lng - st.west) / st.dpx).astype(np.int64)
    row = np.round((st.north - lat) / st.dpx).astype(np.int64)
    valid_col = (col >= 0) & (col < st.width)
    valid_row = (row >= 0) & (row < st.height)
    if not valid_col.any() or not valid_row.any():
        return None
    ci = np.clip(col, 0, st.width - 1)
    ri = np.clip(row, 0, st.height - 1)
    sub = st.rgba[np.ix_(ri, ci)]  # (TILE_SIZE, TILE_SIZE, 4)
    in_bounds = valid_row[:, None] & valid_col[None, :]
    keep = in_bounds & (sub[..., 3] > 0)
    if not keep.any():
        return None
    out = np.zeros((TILE_SIZE, TILE_SIZE, 4), np.uint8)
    out[keep] = sub[keep]
    return out


# ── Bake driver ──────────────────────────────────────────────────────────────
def load_states() -> list[StateZones]:
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
        st = StateZones(os.path.join(SRC_DIR, f))
        present = ", ".join(k for k, v in st.present.items() if v) or "none"
        print(f"  {f} → {st.name}: {st.width}×{st.height}px, "
              f"bbox W{st.west:.3f} S{st.south:.3f} E{st.east:.3f} N{st.north:.3f}, "
              f"zones[{present}]")
        states.append(st)
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
    print("Loading + classifying source KMZ …")
    states = load_states()
    print(f"Clearing existing tiles z{MIN_ZOOM}–z{max_zoom} …")
    clear_tiles(max_zoom)

    written = 0
    for z in range(MIN_ZOOM, max_zoom + 1):
        n = 2 ** z
        z_written = 0
        for st in states:
            x0 = max(0, int(math.floor(lng_to_tilex(st.west, n))))
            x1 = min(n - 1, int(math.floor(lng_to_tilex(st.east, n))))
            y0 = max(0, int(math.floor(lat_to_tiley(st.north, n))))
            y1 = min(n - 1, int(math.floor(lat_to_tiley(st.south, n))))
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    lng, lat = tile_pixel_lnglat(x, y, z)
                    tile = render_tile(st, lng, lat)
                    if tile is None:
                        continue
                    composite_save(
                        os.path.join(OUT_DIR, str(z), str(x), f"{y}.png"), tile)
                    z_written += 1
        written += z_written
        print(f"  z{z}: {z_written} tiles written")

    write_metadata(states, max_zoom, written)
    print(f"Done — {written} tiles in {OUT_DIR}")


def write_metadata(states: list[StateZones], max_zoom: int, written: int) -> None:
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
        "tilePath": "/mod-zones/{z}/{x}/{y}.png",
        "tileVersion": VERSION,
        "tileCount": written,
        # Canonical legend — the frontend renders straight from this.
        "categories": [
            {
                "key": c["key"],
                "label": c["label"],
                "desc": c["desc"],
                # hex the frontend can drop into a swatch.
                "color": "#%02x%02x%02x" % tuple(c["color"]),
            }
            for c in CATEGORIES
        ],
        "states": [
            {
                "name": st.name,
                "bounds": [round(st.west, 6), round(st.south, 6),
                           round(st.east, 6), round(st.north, 6)],
                # which categories actually appear in this state.
                "categories": [k for k, v in st.present.items() if v],
            }
            for st in states
        ],
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"metadata.json written ({os.path.getsize(METADATA_PATH)} B) — "
          f"{len(states)} states, bounds {meta['bounds']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Bake MoD wind-clearance KMZ → XYZ tiles")
    ap.add_argument("--max-zoom", type=int, default=MAX_ZOOM,
                    help=f"deepest zoom to bake (default {MAX_ZOOM})")
    args = ap.parse_args()
    bake(args.max_zoom)


if __name__ == "__main__":
    main()
