"""Phase 4 parity harness (RUNBOOK_v3 sec 4).

Runs the ported FastAPI engine IN-PROCESS against every MIGRATION/golden/<name>/
fixture and diffs the result against the frozen response.json under the sec-4.2
conditional-tolerance rules. The HTTP route is a thin wrapper; the decisive gate
is the engine (analyze_aoi) + the serializer (js_jsonify), both exercised here.

Live inputs (same as when the golden was captured): GWA staging tiler (network),
local Weibull COGs, PostGIS windmills. Set DATABASE_URL + ANALYSIS_DATA_DIR.

Usage:
  cd services/site-analysis
  DATABASE_URL=... ANALYSIS_DATA_DIR=.../apps/api/data \
    ./.venv/bin/python ../../MIGRATION/parity/run.py [fixture_name ...]
"""
from __future__ import annotations

import json
import math
import ssl
import sys
from pathlib import Path

# The GWA STAGING tiler (tiles-stag.ramtt.xyz) serves a self-signed cert that the
# legacy Node env accepted when the golden was captured. Reproduce that here so
# the parity gate measures ENGINE behaviour, not TLS config. Harness-scoped only;
# production TLS for the tiler is a deploy concern (DEFERRED, not a parity item).
ssl._create_default_https_context = ssl._create_unverified_context  # noqa: S323

from app.engine.geometry import validate_aoi
from app.engine.pipeline import analyze_aoi
from app.engine.types import GeometryError
from app.serialize import js_jsonify

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "golden"

# sec 4.2 tolerances. Default float rule is abs<=1e-6 OR rel<=1e-6; specific
# JSON paths override. score.value carries +-0.5 documented rounding slack.
ABS_TOL = 1e-6
REL_TOL = 1e-6
SCORE_VALUE_SLACK = 0.5
# Anything matching only within tol but beyond this is worth eyeballing.
NOTABLE_TOL = 1e-9


def _leaf_path_kind(path: str) -> str:
    if path.endswith("score.value"):
        return "score_value"
    return "default"


def _num_ok(path: str, exp: float, got: float) -> tuple[bool, bool]:
    """(ok, notable) for two numbers under the path's tolerance rule."""
    if exp == got:
        return True, False
    if not (math.isfinite(exp) and math.isfinite(got)):
        return False, True
    delta = abs(exp - got)
    if _leaf_path_kind(path) == "score_value":
        return delta <= SCORE_VALUE_SLACK, delta > NOTABLE_TOL
    tol = max(ABS_TOL, REL_TOL * abs(exp))
    return delta <= tol, delta > NOTABLE_TOL


def compare(path: str, exp, got, diverged: list, notable: list) -> None:
    # bool must be checked before int (bool is an int subclass).
    if isinstance(exp, bool) or isinstance(got, bool):
        if exp != got:
            diverged.append((path, exp, got))
        return
    if isinstance(exp, dict):
        if not isinstance(got, dict):
            diverged.append((path, exp, got))
            return
        for k in exp:
            compare(f"{path}.{k}", exp[k], got.get(k, "<MISSING>"), diverged, notable)
        for k in got:
            if k not in exp:
                diverged.append((f"{path}.{k}", "<ABSENT>", got[k]))
        return
    if isinstance(exp, list):
        if not isinstance(got, list) or len(exp) != len(got):
            diverged.append((f"{path} (len)", _len(exp), _len(got)))
            return
        for i, (e, g) in enumerate(zip(exp, got)):
            compare(f"{path}[{i}]", e, g, diverged, notable)
        return
    if isinstance(exp, (int, float)) and isinstance(got, (int, float)):
        ok, note = _num_ok(path, exp, got)
        if not ok:
            diverged.append((path, exp, got))
        elif note:
            notable.append((path, exp, got))
        return
    if exp != got:
        diverged.append((path, exp, got))


def _len(v):
    return len(v) if isinstance(v, list) else f"<{type(v).__name__}>"


def run_fixture(name: str) -> dict:
    fixture = GOLDEN_DIR / name
    request = json.loads((fixture / "request.json").read_text())
    golden = json.loads((fixture / "response.json").read_text())

    try:
        aoi = validate_aoi(request["geometry"])
    except GeometryError as err:
        got = js_jsonify({"error": err.message, "code": err.code})
        diverged, notable = [], []
        compare(name, golden, got, diverged, notable)
        return {"name": name, "kind": "error", "diverged": diverged, "notable": notable}

    # Generous budget: the port fetches the 7 GWA layers SEQUENTIALLY (vs the
    # legacy's parallel Promise.all) so a cold staging-tiler run blows the 15 s
    # wall budget. Timing does not change the OUTPUT, so a large budget isolates
    # the parity question (the seq-fetch perf gap is a deferred optimisation).
    response = analyze_aoi(aoi, budget_ms=600_000)
    got = js_jsonify(response)
    diverged, notable = [], []
    compare(name, golden, got, diverged, notable)
    return {"name": name, "kind": "ok", "diverged": diverged, "notable": notable}


def main(argv: list[str]) -> int:
    names = argv or sorted(p.name for p in GOLDEN_DIR.iterdir() if p.is_dir())
    results = []
    for name in names:
        print(f"\n=== {name} ===", flush=True)
        try:
            r = run_fixture(name)
        except Exception as exc:  # noqa: BLE001 — a crash IS a parity failure
            print(f"  CRASH: {type(exc).__name__}: {exc}")
            results.append({"name": name, "diverged": [("<crash>", "", str(exc))], "notable": []})
            continue
        results.append(r)
        if not r["diverged"]:
            print(f"  PARITY OK ({r['kind']})" + (f"; {len(r['notable'])} within-tol float diffs" if r["notable"] else ""))
            for p, e, g in r["notable"][:5]:
                print(f"    ~ {p}: exp={e!r} got={g!r}")
        else:
            print(f"  DIVERGED ({len(r['diverged'])}):")
            for p, e, g in r["diverged"][:25]:
                print(f"    x {p}: exp={e!r} got={g!r}")

    passed = [r for r in results if not r["diverged"]]
    print(f"\n========== PARITY SUMMARY: {len(passed)}/{len(results)} fixtures match ==========")
    for r in results:
        flag = "OK " if not r["diverged"] else "XX "
        print(f"  {flag} {r['name']}  (diverged={len(r['diverged'])}, notable={len(r.get('notable', []))})")
    return 0 if len(passed) == len(results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
