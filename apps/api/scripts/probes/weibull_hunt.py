#!/usr/bin/env python3
"""Phase 0 probe: are GWA Weibull A/k for India @100m programmatically obtainable?

Avenues probed (all read-only, no production code touched):
  1. tiles-stag.ramtt.xyz TiTiler mounts (gwa3/gwa4/gwa4_3857/newa) - layer enums.
  2. NEWA micro_ltm a_tot/k_tot bounds - confirm Europe-only (excludes India).
  3. GWA GIS country-download API -> CloudFront COGs for combined-Weibull-A/k.
  4. Remote per-point sampling of those COGs via rasterio /vsicurl.
  5. GWA per-point GWC lib endpoint (generalized climate; needs Referer header).
  6. Consistency check A*Gamma(1+1/k) vs ws_mean_hgt100m at the same point.
  7. Fallback solver validation: k from PD/(0.5*rho*v^3) ratio, A from v.

Run with the repo venv that has rasterio + numpy + scipy:
  /Users/akshatpatel/Desktop/wind/wce/apps/web/scripts/.venv/bin/python3 weibull_hunt.py
"""

import json
import math
import urllib.request

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from scipy.optimize import brentq
from scipy.special import gamma as gamma_fn

TILER_BASE = "https://tiles-stag.ramtt.xyz"
GWA_SITE = "https://globalwindatlas.info"
USER_AGENT = "wce-analysis-probe"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 wce-analysis-probe"
)
COG_URLS = {
    "A": "https://gwa.cdn.nazkamapps.com/country_tifs_v4/IND_combined-Weibull-A_100m.tif",
    "k": "https://gwa.cdn.nazkamapps.com/country_tifs_v4/IND_combined-Weibull-k_100m.tif",
    "ws": "https://gwa.cdn.nazkamapps.com/country_tifs_v4/IND_wind-speed_100m.tif",
}
POINTS = {
    "muppandal": (8.26, 77.55),
    "bhadla": (27.53, 71.92),
}
ANALYSIS_ZOOM = 10
WEB_MERCATOR_RADIUS = 20037508.342789244
SEA_LEVEL_RHO = 1.225
TIMEOUT_S = 90


def http_get(url, headers=None, timeout=TIMEOUT_S):
    base = {"User-Agent": USER_AGENT}
    if headers:
        base = {**base, **headers}
    req = urllib.request.Request(url, headers=base)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def lonlat_to_3857(lon, lat):
    x = lon / 180.0 * WEB_MERCATOR_RADIUS
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / math.pi * WEB_MERCATOR_RADIUS
    return x, y


def sample_tiler_pixel(layer, lat, lon, z=ANALYSIS_ZOOM):
    """Value of the gwa4 tiler pixel containing (lat, lon) at zoom z."""
    tx, ty = lonlat_to_tile(lon, lat, z)
    url = f"{TILER_BASE}/titiler/gwa4/{layer}/tiles/{z}/{tx}/{ty}.tif"
    data = http_get(url)
    with MemoryFile(data) as mf, mf.open() as ds:
        arr = ds.read(1, masked=True).astype("float32").filled(np.nan)
        mx, my = lonlat_to_3857(lon, lat)
        row, col = ds.index(mx, my)
        return float(arr[row, col])


def sample_cog(url, points):
    """Sample a remote COG at [(lat, lon), ...] via /vsicurl range reads."""
    with rasterio.open("/vsicurl/" + url) as ds:
        coords = [(lon, lat) for lat, lon in points]
        vals = [float(v[0]) for v in ds.sample(coords)]
        meta = {
            "size": f"{ds.width}x{ds.height}",
            "dtype": ds.dtypes[0],
            "tiled": bool(ds.profile.get("tiled")),
            "overviews": ds.overviews(1),
            "bounds": [round(b, 4) for b in ds.bounds],
        }
        return vals, meta


def barometric_rho(elevation_m):
    return SEA_LEVEL_RHO * (1.0 - 2.2558e-5 * elevation_m) ** 5.256


def solve_weibull_from_v_pd(v, pd, rho):
    """Solve (A, k) from mean speed v and power density pd at air density rho.

    v  = A * Gamma(1 + 1/k)
    pd = 0.5 * rho * A^3 * Gamma(1 + 3/k)
    =>  pd / (0.5 * rho * v^3) = Gamma(1 + 3/k) / Gamma(1 + 1/k)^3   (k only)
    """
    target = pd / (0.5 * rho * v ** 3)

    def ratio_minus_target(k):
        g1 = gamma_fn(1.0 + 1.0 / k)
        g3 = gamma_fn(1.0 + 3.0 / k)
        return g3 / g1 ** 3 - target

    k = brentq(ratio_minus_target, 1.05, 10.0, xtol=1e-8)
    a = v / gamma_fn(1.0 + 1.0 / k)
    return a, k


def probe_tiler_enums():
    spec = json.loads(http_get(f"{TILER_BASE}/openapi.json"))
    schemas = spec["components"]["schemas"]
    out = {}
    for name, schema in schemas.items():
        enum = schema.get("enum")
        if not (name.startswith("readers__") and isinstance(enum, list)):
            continue
        weibullish = [l for l in enum if "weib" in l.lower() or "a_tot" in l or "k_tot" in l]
        out[name] = weibullish
    return out


def probe_newa_bounds():
    info = json.loads(http_get(f"{TILER_BASE}/titiler/newa/micro_ltm/a_tot_hgt100m/info"))
    bounds = info["bounds"]  # [w, s, e, n]
    west, south, east, north = bounds
    excludes = {}
    for name, (lat, lon) in POINTS.items():
        inside = west <= lon <= east and south <= lat <= north
        excludes[name] = not inside
    return bounds, excludes


def probe_download_api():
    """GIS download API redirect + CDN range-request support (no full download)."""
    results = {}
    for label, gwa_layer in [("A", "combined-Weibull-A"), ("k", "combined-Weibull-k")]:
        api_url = f"{GWA_SITE}/api/gis/country/IND/{gwa_layer}/100"
        req = urllib.request.Request(api_url, method="HEAD", headers={"User-Agent": BROWSER_UA})

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None

        opener = urllib.request.build_opener(NoRedirect)
        try:
            opener.open(req, timeout=TIMEOUT_S)
            results[label] = {"api_url": api_url, "error": "expected 302, got 200"}
            continue
        except urllib.error.HTTPError as e:
            if e.code != 302:
                results[label] = {"api_url": api_url, "error": f"HTTP {e.code}"}
                continue
            cdn_url = e.headers["Location"]

        head = urllib.request.Request(cdn_url, method="HEAD", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(head, timeout=TIMEOUT_S) as resp:
            results[label] = {
                "api_url": api_url,
                "cdn_url": cdn_url,
                "bytes": int(resp.headers["Content-Length"]),
                "accept_ranges": resp.headers.get("Accept-Ranges"),
            }
    return results


def probe_gwc_lib_endpoint(lat, lon):
    """GWA per-point generalized-wind-climate lib (the map UI's point download).

    Requires a Referer header or nginx replies 400. Returns the header lines:
    sector count, roughness classes, heights. NOTE: values are GENERALIZED
    (per roughness class), not the site-specific combined Weibull fit.
    """
    url = f"{GWA_SITE}/api/gwa/custom/Lib?lat={lat}&long={lon}&areaname=wce_probe"
    try:
        data = http_get(url, headers={"User-Agent": BROWSER_UA, "Referer": f"{GWA_SITE}/en"})
    except urllib.error.HTTPError as e:
        return {"url": url, "error": f"HTTP {e.code}"}
    lines = data.decode("utf-8", "replace").splitlines()
    return {"url": url, "bytes": len(data), "header": lines[:4]}


def main():
    report = {}

    print("== 1. TiTiler layer enums (weibull-ish entries per mount) ==")
    enums = probe_tiler_enums()
    for name, hits in sorted(enums.items()):
        print(f"  {name}: {hits if hits else 'NONE'}")
    report["tiler_weibull_layers"] = enums

    print("\n== 2. NEWA micro_ltm a_tot_hgt100m bounds (Europe-only check) ==")
    newa_bounds, newa_excludes = probe_newa_bounds()
    print(f"  bounds [w,s,e,n] = {newa_bounds}")
    for name, excluded in newa_excludes.items():
        print(f"  excludes {name}: {excluded}")
    report["newa"] = {"bounds": newa_bounds, "excludes_india_points": newa_excludes}

    print("\n== 3. GWA GIS country-download API (IND combined-Weibull A/k @100m) ==")
    downloads = probe_download_api()
    for label, info in downloads.items():
        print(f"  {label}: {json.dumps(info)}")
    report["download_api"] = downloads

    print("\n== 4. Remote COG point samples via /vsicurl ==")
    pts = list(POINTS.values())
    cog = {}
    for label, url in COG_URLS.items():
        vals, meta = sample_cog(url, pts)
        cog[label] = dict(zip(POINTS.keys(), vals))
        print(f"  {label}: {cog[label]}  meta={meta}")
    report["cog_samples"] = cog

    print("\n== 5. GWA per-point GWC lib endpoint (Muppandal) ==")
    lib = probe_gwc_lib_endpoint(*POINTS["muppandal"])
    print(f"  {json.dumps(lib, indent=2)}")
    report["gwc_lib"] = lib

    print("\n== 6. Consistency: A*Gamma(1+1/k) vs ws_mean_hgt100m (same point) ==")
    consistency = {}
    for name, (lat, lon) in POINTS.items():
        a, k = cog["A"][name], cog["k"][name]
        implied = a * gamma_fn(1.0 + 1.0 / k)
        ws_tiler = sample_tiler_pixel("ws_mean_hgt100m", lat, lon)
        ws_cog = cog["ws"][name]
        consistency[name] = {
            "A": round(a, 4),
            "k": round(k, 4),
            "implied_mean": round(implied, 4),
            "ws_tiler_z10": round(ws_tiler, 4),
            "ws_country_cog": round(ws_cog, 4),
            "pct_diff_vs_tiler": round(100.0 * (implied - ws_tiler) / ws_tiler, 2),
            "pct_diff_vs_cog": round(100.0 * (implied - ws_cog) / ws_cog, 2),
        }
        print(f"  {name}: {json.dumps(consistency[name])}")
    report["consistency"] = consistency

    print("\n== 7. Fallback solver: (A,k) from tiler mean speed + power density ==")
    fallback = {}
    for name, (lat, lon) in POINTS.items():
        v = sample_tiler_pixel("ws_mean_hgt100m", lat, lon)
        pd = sample_tiler_pixel("pd_mean_hgt100m", lat, lon)
        elev = sample_tiler_pixel("elevation", lat, lon)
        rho_site = barometric_rho(elev)
        entry = {"v": round(v, 4), "pd": round(pd, 2), "elev": round(elev, 1)}
        for rho_label, rho in [("rho_1.225", SEA_LEVEL_RHO), ("rho_site", rho_site)]:
            try:
                a_s, k_s = solve_weibull_from_v_pd(v, pd, rho)
                entry[rho_label] = {
                    "rho": round(rho, 4),
                    "A": round(a_s, 4),
                    "k": round(k_s, 4),
                    "k_err_vs_cog_pct": round(100.0 * (k_s - cog["k"][name]) / cog["k"][name], 2),
                    "A_err_vs_cog_pct": round(100.0 * (a_s - cog["A"][name]) / cog["A"][name], 2),
                }
            except ValueError as exc:
                entry[rho_label] = {"rho": round(rho, 4), "error": str(exc)}
        fallback[name] = entry
        print(f"  {name}: {json.dumps(entry)}")
    report["fallback_solver"] = fallback

    print("\n== REPORT (json) ==")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
