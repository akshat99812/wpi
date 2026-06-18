"""Disk cache for finished AnalysisResponse payloads.

Verbatim port of apps/api/src/services/analysis/resultCache.ts.

Key: md5(canonical_geometry_string(aoi) + ANALYSIS_VERSION) — the geometry is
already canonical (6-dp rounded, deduped, closed) by the time it reaches here,
satisfying the plan's "never hash unrounded geometry" hard rule, and
ANALYSIS_VERSION in the key means a version bump invalidates everything. No TTL
for the same reason — entries can only become wrong via an algorithm change,
which changes the key.

Dir resolution mirrors tiles.py (TILE_CACHE_DIR env -> /var/cache/tiles in
production) with the analysis namespace, except dev gets a real default dir
instead of a passthrough: results are version-keyed, so dev staleness cannot
happen.

Layout: {base}/analysis/{key[0:2]}/{key}.json
Writes are temp-file + rename (no torn reads); a corrupt entry is treated as a
miss and deleted.

Disk-growth guard: the geometry key space is effectively unbounded (any unique
6-dp polygon inside India), so a hostile Pro user could mint cache entries
forever. Writes are refused (loudly logged) once the namespace directory exceeds
RESULT_CACHE_MAX_MB (default 500). The size ledger is seeded by one recursive
scan per process and advanced per write — an approximation, but the failure mode
is only a slightly early/late cutoff.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import time
from pathlib import Path
from typing import Any, Optional

from app.config import ANALYSIS_VERSION
from app.engine.geometry import canonical_geometry_string
from app.engine.types import ValidatedAoi
from app.serialize import js_dumps

CACHE_NAMESPACE = "analysis"
PROD_CACHE_DIR = "/var/cache/tiles"

# Service root analogue of the TS API_ROOT_DIR; dev default lives under the
# service's own .cache/tiles so a local run never writes outside the repo
# (same anchor tiles.py uses for its dev cache).
_SERVICE_ROOT_DIR = Path(__file__).resolve().parents[2]
DEV_CACHE_DIR = _SERVICE_ROOT_DIR / ".cache" / "tiles"

# Shard fanout copied from tiles.py ({key[0:2]}/).
SHARD_PREFIX_LENGTH = 2

# Default cap on the analysis namespace; override via RESULT_CACHE_MAX_MB.
DEFAULT_RESULT_CACHE_MAX_MB = 500
BYTES_PER_MIB = 1024 * 1024


def resolve_cache_base_dir() -> Path:
    """Resolved per call (not at module load) so tests can point TILE_CACHE_DIR
    at a tmp dir after import — same seam as tiles.py."""
    from_env = os.environ.get("TILE_CACHE_DIR")
    if from_env:
        return Path(from_env)
    return Path(PROD_CACHE_DIR) if os.environ.get("NODE_ENV") == "production" else DEV_CACHE_DIR


def result_cache_key(aoi: ValidatedAoi) -> str:
    """Cache key for one validated AOI under the current ANALYSIS_VERSION."""
    return hashlib.md5(
        (canonical_geometry_string(aoi) + ANALYSIS_VERSION).encode("utf-8")
    ).hexdigest()


def resolve_namespace_dir() -> Path:
    return resolve_cache_base_dir() / CACHE_NAMESPACE


def entry_path_for(key: str) -> Path:
    return resolve_namespace_dir() / key[:SHARD_PREFIX_LENGTH] / f"{key}.json"


# ── Namespace size ledger (disk-growth guard) ───────────────────────────────


def resolve_max_cache_bytes() -> float:
    raw = os.environ.get("RESULT_CACHE_MAX_MB")
    if raw is None or raw == "":
        parsed = math.nan
    else:
        try:
            parsed = float(raw)
        except ValueError:
            parsed = math.nan
    max_mb = parsed if (math.isfinite(parsed) and parsed > 0) else DEFAULT_RESULT_CACHE_MAX_MB
    return max_mb * BYTES_PER_MIB


class SizeLedger:
    """Mutable counter holder so concurrent writers share one running total."""

    def __init__(self, num_bytes: int) -> None:
        self.bytes = num_bytes


# One ledger per namespace dir (tests point TILE_CACHE_DIR at tmp dirs).
_size_ledgers: dict[str, SizeLedger] = {}


def shard_size_bytes(shard_dir: Path) -> int:
    total = 0
    for entry in os.scandir(shard_dir):
        if not entry.is_file():
            continue
        try:
            total += os.stat(entry.path).st_size
        except FileNotFoundError:
            # Entry deleted between scandir and stat — fine for an approximation.
            pass
    return total


def scan_namespace_size_bytes(namespace_dir: Path) -> int:
    """Recursive size of {namespace_dir}/{shard}/*.json. Missing dir = 0 bytes."""
    try:
        shards = list(os.scandir(namespace_dir))
    except (FileNotFoundError, NotADirectoryError):
        return 0
    except OSError as err:
        print(
            "[analysis-cache] size scan failed; assuming empty",
            {"namespaceDir": str(namespace_dir), "err": str(err)},
        )
        return 0
    total = 0
    for shard in shards:
        if not shard.is_dir():
            continue
        try:
            total += shard_size_bytes(Path(shard.path))
        except OSError as err:
            print(
                "[analysis-cache] shard size scan failed; undercounting",
                {"shard": shard.name, "err": str(err)},
            )
    return total


def ledger_for(namespace_dir: Path) -> SizeLedger:
    key = str(namespace_dir)
    existing = _size_ledgers.get(key)
    if existing is not None:
        return existing
    created = SizeLedger(scan_namespace_size_bytes(namespace_dir))
    _size_ledgers[key] = created
    return created


def is_analysis_response(value: Any) -> bool:
    """Minimal shape check so a foreign/truncated JSON file can't masquerade as a
    response. Full validity is the producer's job — this guards the disk."""
    if not isinstance(value, dict):
        return False
    return (
        isinstance(value.get("analysisVersion"), str)
        and isinstance(value.get("aoi"), dict)
        and isinstance(value.get("score"), dict)
        and isinstance(value.get("sections"), dict)
    )


def delete_corrupt_entry(entry_path: Path, reason: str) -> None:
    """Best-effort delete of a corrupt entry; never throws."""
    print(
        f"[analysis-cache] corrupt entry treated as miss ({reason})",
        {"entryPath": str(entry_path)},
    )
    try:
        entry_path.unlink()
    except FileNotFoundError:
        pass
    except OSError as err:
        print(
            "[analysis-cache] failed to delete corrupt entry",
            {"entryPath": str(entry_path), "err": str(err)},
        )


def get_cached_result(key: str) -> Optional[dict]:
    """Cached response for ``key``, or None on miss. A corrupt or unparseable file
    is deleted and treated as a miss. Never throws."""
    entry_path = entry_path_for(key)
    try:
        raw = entry_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as err:
        print(
            "[analysis-cache] read failed; treating as miss",
            {"entryPath": str(entry_path), "err": str(err)},
        )
        return None
    try:
        parsed = json.loads(raw)
    except (ValueError, json.JSONDecodeError) as err:
        delete_corrupt_entry(entry_path, f"unparseable JSON: {err}")
        return None
    if not is_analysis_response(parsed):
        delete_corrupt_entry(entry_path, "shape mismatch")
        return None
    return parsed


def put_cached_result(key: str, response: dict) -> None:
    """Best-effort write: persists the response to disk. Failures are logged,
    never thrown — a cache write must never affect the response."""
    try:
        write_entry(key, response)
    except Exception as err:  # noqa: BLE001 — write must never affect response
        print("[analysis-cache] write failed", {"key": key, "err": str(err)})


def write_entry(key: str, response: dict) -> None:
    entry_path = entry_path_for(key)
    body = js_dumps(response)
    incoming_bytes = len(body.encode("utf-8"))

    # Disk-growth guard: refuse new entries once the namespace is full. The route
    # only writes on cache miss, so re-writes of an existing key (which the ledger
    # would double-count) do not occur on the production path.
    ledger = ledger_for(resolve_namespace_dir())
    max_bytes = resolve_max_cache_bytes()
    if ledger.bytes + incoming_bytes > max_bytes:
        print(
            "[analysis-cache] namespace size cap reached; skipping write",
            {
                "key": key,
                "namespaceBytes": ledger.bytes,
                "incomingBytes": incoming_bytes,
                "maxBytes": max_bytes,
            },
        )
        return

    entry_path.parent.mkdir(parents=True, exist_ok=True)
    # Temp-file + rename so a concurrent reader never sees a torn body
    # (pattern copied from tiles.py).
    tmp_path = entry_path.with_name(f"{entry_path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
    tmp_path.write_text(body, encoding="utf-8")
    tmp_path.replace(entry_path)
    ledger.bytes += incoming_bytes
