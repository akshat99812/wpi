#!/usr/bin/env python3
"""Build the district-level wind-farm GeoJSON the Pro map's zoom-out circles use.

PROVENANCE
  Input  : data/windProjectData.json  — WT-MARUT (NIWE/MNRE) district installed-
           capacity records {state, district, financialYear, weg, capacity}. This
           data is dirty: ~172 district spellings collapse to ~70 real districts
           (e.g. "Anantapur" appears 8 ways), some rows carry the WRONG state, and
           some are multi-district combos ("Amreli&Rajkot"). It has NO coordinates
           and NO capacity-factor field.
  Lookup : authoritative GADM v2 India district polygons (NAME_1 state, NAME_2
           district, VARNAME_2 aliases) → area-weighted centroid per district.
  Output : data/wind-projects.districts.geojson — one Point per real district with
           summed capacityMW + turbine count (weg), positioned at the GADM centroid.
           (Used by the zoom-out circle layer.)
  Output²: data/wind-farm-districts.geojson — the SAME matched districts as
           Polygon/MultiPolygon (the GADM district boundary) + display name/state,
           so an individual OSM turbine can be point-in-polygon attributed to the
           WT-MARUT wind-farm cluster it sits in (ingested to PostGIS →
           wind_farm_districts, joined per-click by /api/turbine/:id).

CORRECTNESS RULES (the map must not show a wrong value)
  • Spelling variants are merged via normalisation + a curated alias table.
  • A row's district NAME wins over a mislabelled state field.
  • Multi-district combos and anything not confidently matched are DROPPED and
    reported — never positioned by guess.
  • capacity / weg are summed exactly from the source.
  • A polygon is emitted only where we have the district's TRUE GADM boundary;
    homonym overrides (CENTROID_OVERRIDE) get a circle but NO polygon, so a
    turbine is never wrongly attributed to a same-named district in another state.

Run:  python3 apps/api/scripts/build-wind-farms.py
"""
import json, re, difflib, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
SRC = os.path.join(DATA, "windProjectData.json")
OUT = os.path.join(DATA, "wind-projects.districts.geojson")
OUT_POLY = os.path.join(DATA, "wind-farm-districts.geojson")
GADM_CACHE = os.path.join(DATA, "cache", "gadm_india_districts.geojson")
GADM_URL = "https://raw.githubusercontent.com/geohacker/india/master/district/india_district.geojson"


def norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def ensure_gadm():
    if os.path.exists(GADM_CACHE) and os.path.getsize(GADM_CACHE) > 1_000_000:
        return
    os.makedirs(os.path.dirname(GADM_CACHE), exist_ok=True)
    print(f"downloading GADM districts → {GADM_CACHE}")
    req = urllib.request.Request(GADM_URL, headers={"User-Agent": "wce-build"})
    with urllib.request.urlopen(req, timeout=120) as r, open(GADM_CACHE, "wb") as f:
        f.write(r.read())


def ring_centroid(ring):
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[i + 1][0], ring[i + 1][1]
        cr = x0 * y1 - x1 * y0
        a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr
    if abs(a) < 1e-12:
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        return [sum(xs) / len(xs), sum(ys) / len(ys)]
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)]


def feat_centroid(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    best, best_area = None, -1
    for poly in polys:
        ring = poly[0]
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > best_area:
            best_area, best = area, ring
    return ring_centroid(best) if best else None


# Curated aliases: messy-norm -> GADM-norm (each a deliberate, verifiable mapping).
ALIAS = {
    "anantapuram": "anantapur", "ananthapuram": "anantapur", "ananthapuramu": "anantapur",
    "anantpur": "anantapur", "anantpuram": "anantapur", "anantpurum": "anantapur", "anathapuramu": "anantapur",
    "kadappah": "cuddapah", "kodappah": "cuddapah", "ysrkadapa": "cuddapah", "yskadapa": "cuddapah", "kadapa": "cuddapah",
    "bhoynagor": "bhavnagar", "bhuj": "kachchh", "kutch": "kachchh", "devbhumidwarka": "jamnagar", "devbhumidwrk": "jamnagar",
    "devbhoomidwrk": "jamnagar", "dwarka": "jamnagar", "khambaliya": "jamnagar",
    "kariyana": "rajkot", "kalawad": "jamnagar", "babra": "amreli", "porbander": "porbandar",
    "surendemagar": "surendranagar", "surendernagar": "surendranagar",
    "dharampur": "valsad", "morbi": "rajkot", "botad": "bhavnagar",
    "godag": "gadag", "tumkar": "tumkur", "belgavi": "belgaum", "belagavi": "belgaum", "ballari": "bellary",
    "vijayapura": "bijapur", "vijayapr": "bijapur", "vijayanagar": "bellary",
    "vijayanagara": "bellary", "vijaynagar": "bellary", "kopal": "koppal", "kopol": "koppal",
    "davengere": "davangere", "darwad": "dharwad", "gulburga": "gulbarga",
    "kalaburagi": "gulbarga", "sandur": "bellary",
    "dhajpur": "shajapur", "jaora": "ratlam",
    "dharashiv": "osmanabad", "yavotmal": "yavatmal", "sanghli": "sangli",
    "jaiselmer": "jaisalmer",
    "tuticorin": "thoothukudi", "thoothukkudi": "thoothukudi", "thoolthukudi": "thoothukudi",
    "tirunelveli": "tirunelvelikattabo", "tiruneveli": "tirunelvelikattabo", "tirupur": "coimbatore",
    "thirupur": "coimbatore", "tiruppur": "coimbatore", "tirupu": "coimbatore", "udumalpet": "coimbatore",
    "ramnad": "ramanathapuram", "muppandal": "kanniyakumari",
    "kayathor": "thoothukudi", "tenkasi": "tirunelvelikattabo", "dharampuri": "dharmapuri",
    "rangareddi": "rangareddy",
    "kerala": "palakkad", "kerla": "palakkad",
}
COMBO = re.compile(r"[&/,]| and |\+")

# Explicit centroid overrides [lon, lat] for districts GADM v2 lacks or whose
# only GADM entry is a same-name district in the WRONG state (homonyms). Verified
# by hand against the source's state so a circle never lands in the wrong region.
CENTROID_OVERRIDE = {
    # GADM v2 has only UP's Pratapgarh; the source is Rajasthan's Pratapgarh
    # (carved from Chittorgarh in 2008), which sits in S Rajasthan near the MP border.
    "pratapgarh": [74.62, 24.20],
}

# GADM v2 predates the 2014 Telangana bifurcation, so it labels these districts
# "Andhra Pradesh" — factually wrong today. Correct the DISPLAY state only (the
# geometry + capacity aggregation are untouched, and the source rows already say
# Telangana). Applied to the polygon output the turbine card reads from.
DISPLAY_STATE_OVERRIDE = {
    "medak": "Telangana",
    "rangareddy": "Telangana",
}


def main():
    ensure_gadm()
    gadm = json.load(open(GADM_CACHE))
    # Each GADM key → list of candidate districts. We keep the district's proper
    # NAME_2 + boundary geometry alongside the centroid so the polygon output can
    # reuse the EXACT same match a circle uses (one source of truth, no drift).
    lookup = {}
    for f in gadm["features"]:
        p = f["properties"]; c = feat_centroid(f["geometry"])
        if not c:
            continue
        cand = {
            "state": p.get("NAME_1"),
            "name": p.get("NAME_2"),
            "centroid": c,
            "geometry": f["geometry"],
        }
        names = [p.get("NAME_2")]
        if p.get("VARNAME_2"):
            names += re.split(r"[|/]", p["VARNAME_2"])
        for nm in names:
            k = norm(nm)
            if k:
                lookup.setdefault(k, []).append(cand)
    gadm_keys = list(lookup.keys())

    def resolve(state, district):
        raw = district or ""
        if COMBO.search(raw):
            return None, "combo"
        nk = norm(raw)
        if not nk:
            return None, "empty"
        cand = ALIAS.get(nk, nk)
        if cand in lookup:
            return cand, ("alias" if cand != nk else "exact")
        m = difflib.get_close_matches(cand, gadm_keys, n=1, cutoff=0.9)
        if m:
            return m[0], "fuzzy"
        return None, "unmatched"

    src = json.load(open(SRC))
    agg, dropped = {}, []
    for p in src["projects"]:
        key, how = resolve(p["state"], p["district"])
        cap = p.get("capacity", 0) or 0; weg = p.get("weg", 0) or 0
        if not key:
            dropped.append((p["state"], p["district"], cap, how)); continue
        cands = lookup[key]
        chosen = cands[0]
        for c in cands:
            if norm(c["state"]) == norm(p["state"]):
                chosen = c; break
        a = agg.setdefault(key, {
            "lon": chosen["centroid"][0], "lat": chosen["centroid"][1],
            "name": chosen["name"], "state": chosen["state"],
            "geometry": chosen["geometry"], "cap": 0, "weg": 0, "variants": set(),
        })
        a["cap"] += cap; a["weg"] += weg; a["variants"].add(p["district"])

    total = sum((x.get("capacity", 0) or 0) for x in src["projects"])
    matched = sum(a["cap"] for a in agg.values())
    drop_mw = sum(c for _, _, c, _ in dropped)
    print(f"matched {matched:.1f}/{total:.1f} MW ({100*matched/total:.1f}%) across {len(agg)} districts; "
          f"dropped {len(dropped)} rows ({drop_mw:.1f} MW)")
    for s, d, c, h in sorted(dropped, key=lambda x: -x[2]):
        if c > 20:
            print(f"  dropped >20MW: {s} | {d}  {c:.1f} MW [{h}]")

    features = []
    for k, a in agg.items():
        lon, lat = CENTROID_OVERRIDE.get(k, [a["lon"], a["lat"]])
        features.append({
            "type": "Feature",
            "properties": {"district": k, "capacityMW": round(a["cap"], 3), "weg": a["weg"], "variants": sorted(a["variants"])},
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        })
    fc = {"type": "FeatureCollection", "name": "wind_projects_districts",
          "attribution": "Source: WT-MARUT (NIWE/MNRE); district centroids: GADM",
          "features": features}
    json.dump(fc, open(OUT, "w"))
    print(f"wrote {OUT}: {len(features)} farm points")

    # ── Polygon output: the SAME matched districts as GADM boundaries, so a
    #    turbine can be point-in-polygon attributed to its wind-farm cluster.
    #    Skip homonym overrides — we lack their true boundary (would mis-attribute).
    #    Coordinates are trimmed to 5 dp (~1 m) — far finer than the boundary
    #    matters for containment, and it roughly halves the on-disk GeoJSON.
    def round_coords(o):
        if isinstance(o, float):
            return round(o, 5)
        if isinstance(o, list):
            return [round_coords(x) for x in o]
        return o

    poly_features, skipped_poly = [], []
    for k, a in agg.items():
        if k in CENTROID_OVERRIDE:
            skipped_poly.append((k, round(a["cap"], 1)))
            continue
        geom = {"type": a["geometry"]["type"],
                "coordinates": round_coords(a["geometry"]["coordinates"])}
        poly_features.append({
            "type": "Feature",
            "properties": {
                "district": k,
                "name": a["name"],
                "state": DISPLAY_STATE_OVERRIDE.get(k, a["state"]),
                "capacityMW": round(a["cap"], 3),
                "weg": a["weg"],
                "variants": sorted(a["variants"]),
            },
            "geometry": geom,
        })
    poly_fc = {"type": "FeatureCollection", "name": "wind_farm_districts",
               "attribution": "Source: WT-MARUT (NIWE/MNRE); district boundaries: GADM",
               "features": poly_features}
    json.dump(poly_fc, open(OUT_POLY, "w"))
    poly_mw = sum(f["properties"]["capacityMW"] for f in poly_features)
    print(f"wrote {OUT_POLY}: {len(poly_features)} farm polygons "
          f"({poly_mw:.1f} MW attributable)")
    for k, c in sorted(skipped_poly, key=lambda x: -x[1]):
        print(f"  no polygon (homonym override): {k}  {c:.1f} MW")


if __name__ == "__main__":
    main()
