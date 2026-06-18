"""Pipeline orchestrator: ValidatedAoi -> AnalysisResponse (plan §3 envelope).

Verbatim port of apps/api/src/services/analysis/index.ts ``analyzeAoi``.

Concurrency shape (wall-clock-optimal under the 15 s budget):
  t0 ─┬─ grid     (independent: power tiles around the AOI)
      ├─ climate  (independent: flag-gated reanalysis at the centroid;
      │            skipped without a single log line when the flag is off)
      └─ resource (7 GWA patches ∥ Weibull COG means → mask → stats)
           └─ then, on the REMAINING budget:
                ├─ validation (needs the AOI shear α for the mast delta)
                └─ context    (reuses the elevation patch + AOI mask)

Hard rules honored here (plan §2.8/§6): a section that throws or exceeds the
wall-clock budget degrades to ``{"status": "unavailable", "data": None}`` — it
NEVER fails the response; the route always answers 200 with whatever completed.
Validation confidence mirrors into score.confidence but never touches the score
arithmetic.

ASYNC NOTE: the legacy TS races each section against a per-section timeout via
``Promise.race``. The Python engine is synchronous; ``runSection``/``withBudget``
are reproduced with a ``concurrent.futures.ThreadPoolExecutor`` + ``future.result
(timeout=...)`` so the slowFetcher+budgetMs test still degrades to unavailable.
A late failure on the timed-out thread is swallowed (Promise#catch analogue), so
it can never crash the response.

WIRE FORMAT: this module assembles the camelCase response dict (the single point
where the snake_case engine dataclasses map to the camelCase wire contract). It
does NOT serialize — the route serializes the bytes via serialize.js_dumps to
reproduce Express ``res.json`` exactly.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from typing import Callable, Optional, TypeVar

from app.config import (
    ANALYSIS_BUDGET_MS,
    ANALYSIS_VERSION,
    CLIMATE_SECTION_ENABLED,
    GWA_LAYERS,
)
from app.engine.climate import ClimateData, compute_climate
from app.engine.context import compute_context
from app.engine.grid import compute_grid
from app.engine.mask import build_aoi_mask
from app.engine.resource import ResourceData, compute_resource
from app.engine.score import AnalysisScore, ScoreInputs, compute_score
from app.engine.tiles import TileFetchImpl, fetch_layer_patch
from app.engine.types import AoiMask, LayerPatch, ValidatedAoi
from app.engine.validation import compute_validation
from app.engine.weibull import aoi_weibull_means

logger = logging.getLogger(__name__)

T = TypeVar("T")

# index.ts:53-56 — Fallback shear exponent (1/7 power law) used only when section
# A never produced an AOI-fitted α (the rare case where the GWA point fetch
# succeeds while the patch fetch had failed).
SHEAR_ALPHA_FALLBACK = 1 / 7

# index.ts:58-60 — Floor for the post-resource leg so validation/context always
# get at least one chance to run (both are cheap: one SQL + pure math).
MIN_REMAINING_BUDGET_MS = 250


# ── Daemon-thread executor (Promise.race fidelity) ──────────────────────────
#
# The legacy ``Promise.race([work, timeout])`` returns the moment the budget
# elapses and leaves the losing work promise dangling (GC'd later). A vanilla
# ``ThreadPoolExecutor`` instead JOINS every worker at ``shutdown``/``__exit__``,
# so a still-running timed-out section (e.g. the slowFetcher grid search) would
# stall the response until that work finished — breaking the budget contract.
#
# Marking the worker threads daemon lets a timed-out section keep draining in the
# background without blocking the response OR interpreter exit, and avoids the
# atexit-join + excepthook noise. We shut the pool down with ``wait=False`` so the
# response returns as soon as every section has completed-or-timed-out.


class _DaemonThreadPoolExecutor(ThreadPoolExecutor):
    """A ThreadPoolExecutor whose workers are daemon threads, so a timed-out
    section can outlive the response without joining at interpreter shutdown."""

    def _adjust_thread_count(self) -> None:  # type: ignore[override]
        # Reproduce the base bookkeeping but spawn daemon worker threads.
        if len(self._threads) >= self._max_workers:
            return
        thread_name = f"{self._thread_name_prefix or self}_{len(self._threads)}"
        thread = threading.Thread(
            name=thread_name,
            target=_worker_main,
            args=(self,),
            daemon=True,
        )
        thread.start()
        self._threads.add(thread)


def _worker_main(executor: "_DaemonThreadPoolExecutor") -> None:
    """Run the executor's queued work items on a daemon worker thread. A faithful
    copy of ``concurrent.futures.thread._worker`` minus the weakref/idle-semantics
    we do not need (the pool is short-lived, one per request)."""
    try:
        while True:
            work_item = executor._work_queue.get(block=True)
            if work_item is None:
                # Shutdown sentinel: re-enqueue so siblings also stop, then exit.
                executor._work_queue.put(None)
                return
            work_item.run()
            del work_item
    except Exception:  # noqa: BLE001 — a daemon worker must never crash loudly
        logger.exception("[analysis] worker thread crashed")


# ── Section result helpers (index.ts:62-112) ────────────────────────────────


@dataclass(frozen=True)
class Section:
    """``{ status, data }`` — the per-section envelope (types.ts Section<T>)."""

    status: str  # "ok" | "unavailable"
    data: Optional[object]


class SectionTimeoutError(Exception):
    """index.ts:62-67 SectionTimeoutError."""

    def __init__(self, label: str, budget_ms: float) -> None:
        super().__init__(f'section "{label}" exceeded the {budget_ms} ms budget')
        self.name = "SectionTimeoutError"


def unavailable_section() -> Section:
    """index.ts:69 unavailableSection."""
    return Section(status="unavailable", data=None)


def _swallow_future(future: "Future[object]") -> None:
    """Drain a timed-out work future's exception so it is never re-raised — the
    Promise#catch analogue (a late failure must never crash the response)."""
    if future.cancelled():
        return
    try:
        future.exception()
    except Exception:  # noqa: BLE001 — belt-and-suspenders, never propagate
        pass


def _section_work(name: str, work: Callable[[], T]) -> Section:
    """Run one section's work INLINE (on the worker thread it was submitted to)
    and wrap the result in a Section. A thrown error degrades to "unavailable"
    (logged), never propagating — the failure half of index.ts runSection. The
    BUDGET/timeout half is applied by ``await_section`` from the caller's side, so
    each section occupies exactly one worker thread (no nested submit)."""
    started_at = time.monotonic()
    try:
        data = work()
        logger.info(
            "[analysis] section=%s ms=%s",
            name,
            round((time.monotonic() - started_at) * 1000),
        )
        return Section(status="ok", data=data)
    except Exception as err:  # noqa: BLE001 — mirror the TS catch-all
        logger.error(
            "[analysis] section=%s ms=%s status=unavailable: %s",
            name,
            round((time.monotonic() - started_at) * 1000),
            err,
        )
        return unavailable_section()


def submit_section(
    executor: ThreadPoolExecutor,
    name: str,
    work: Callable[[], T],
) -> "Future[Section]":
    """Start a section on its own worker thread; the returned future resolves to a
    Section (the work-failure -> unavailable mapping already applied inline)."""
    return executor.submit(_section_work, name, work)


def await_section(future: "Future[Section]", budget_ms: float, name: str) -> Section:
    """Race a running section future against the budget (index.ts:74-112: withBudget
    wrapping runSection). The section already maps its own work failures to
    "unavailable"; here a BUDGET overrun does the same. On timeout the still-running
    work keeps draining in the background (daemon worker) and its eventual result/
    failure is swallowed — never an unhandled rejection."""
    started_at = time.monotonic()
    try:
        section = future.result(timeout=budget_ms / 1000)
        return section
    except FuturesTimeoutError:
        future.add_done_callback(_swallow_future)
        logger.error(
            "[analysis] section=%s ms=%s status=unavailable: %s",
            name,
            round((time.monotonic() - started_at) * 1000),
            SectionTimeoutError(name, budget_ms),
        )
        return unavailable_section()


def run_section(
    name: str,
    budget_ms: float,
    work: Callable[[], T],
    executor: ThreadPoolExecutor,
) -> Section:
    """Run one section group under the budget, end to end (submit + await). Failure
    OR timeout -> "unavailable", never a thrown error (index.ts:95-112 runSection
    composed with withBudget). Used for the resource leg, which the orchestrator
    awaits inline before computing the remaining budget."""
    return await_section(submit_section(executor, name, work), budget_ms, name)


# ── Section A patch fetch + cover assertion (index.ts:114-171) ──────────────


def assert_identical_covers(patches: dict) -> None:
    """All patches must share one cover/grid or the single mask would misalign
    (index.ts:115-132 assertIdenticalCovers)."""
    reference: LayerPatch = patches["ws100"]
    for key, patch in patches.items():
        matches_reference = (
            patch.zoom == reference.zoom
            and patch.min_tile_x == reference.min_tile_x
            and patch.min_tile_y == reference.min_tile_y
            and patch.width_px == reference.width_px
            and patch.height_px == reference.height_px
        )
        if not matches_reference:
            raise ValueError(
                f'analyzeAoi: layer patch "{key}" cover mismatch — '
                f"{patch.width_px}×{patch.height_px}@"
                f"({patch.min_tile_x},{patch.min_tile_y},z{patch.zoom}) vs "
                f"ws100 {reference.width_px}×{reference.height_px}@"
                f"({reference.min_tile_x},{reference.min_tile_y},z{reference.zoom})"
            )


@dataclass(frozen=True)
class ResourceArtifacts:
    """Section A artifacts that downstream sections reuse (index.ts:134-138)."""

    elevation: LayerPatch
    mask: AoiMask


def compute_resource_data(
    aoi: ValidatedAoi,
    fetch_impl: Optional[TileFetchImpl],
    on_artifacts: Callable[[ResourceArtifacts], None],
) -> ResourceData:
    """Section A: concurrent 7-layer fetch ∥ Weibull COG means → mask → stats
    (index.ts:140-171 computeResourceData).

    The TS fetches all seven patches with ``Promise.all`` in parallel with the
    Weibull COG read. In the sync port they run sequentially in the SAME order
    (the order-preserving analogue used across the engine — concurrency was an
    I/O optimization, not behaviour). Both the patch fetch and the Weibull read
    must complete before the mask/stats step, exactly as the TS ``Promise.all``.
    """
    patches = {
        "cfIec3": fetch_layer_patch(GWA_LAYERS["cfIec3"], aoi.bbox, fetch_impl),
        "cfIec2": fetch_layer_patch(GWA_LAYERS["cfIec2"], aoi.bbox, fetch_impl),
        "ws50": fetch_layer_patch(GWA_LAYERS["ws50"], aoi.bbox, fetch_impl),
        "ws100": fetch_layer_patch(GWA_LAYERS["ws100"], aoi.bbox, fetch_impl),
        "ws150": fetch_layer_patch(GWA_LAYERS["ws150"], aoi.bbox, fetch_impl),
        "pd100": fetch_layer_patch(GWA_LAYERS["pd100"], aoi.bbox, fetch_impl),
        "elevation": fetch_layer_patch(GWA_LAYERS["elevation"], aoi.bbox, fetch_impl),
    }
    weibull = aoi_weibull_means(aoi.bbox, aoi.ring)

    assert_identical_covers(patches)
    mask = build_aoi_mask(aoi.ring, patches["ws100"])
    on_artifacts(ResourceArtifacts(elevation=patches["elevation"], mask=mask))
    return compute_resource(patches, mask, weibull)


# ── snake_case dataclass -> camelCase wire mapping (THE WIRE CONTRACT) ───────


def _resource_to_wire(data: ResourceData) -> dict:
    """ResourceData (snake_case) -> the resource section wire dict (camelCase,
    plan §3). powerDensity/cfIec3/cfIec2/indiaPercentile may be None."""
    return {
        "meanSpeed": data.mean_speed,
        "minSpeed": data.min_speed,
        "maxSpeed": data.max_speed,
        "p25Speed": data.p25_speed,
        "p50Speed": data.p50_speed,
        "p75Speed": data.p75_speed,
        "areaExceedance90": data.area_exceedance90,
        "powerDensity": data.power_density,
        "powerDensityRaw": data.power_density_raw,
        "airDensity": data.air_density,
        "cfIec3": data.cf_iec3,
        "cfIec2": data.cf_iec2,
        "shearAlpha": data.shear_alpha,
        "weibull": None if data.weibull is None else {"A": data.weibull["A"], "k": data.weibull["k"]},
        "indiaPercentile": data.india_percentile,
        "siteClass": data.site_class,
    }


def _climate_to_wire(data: ClimateData) -> dict:
    """ClimateData -> the climate section wire dict (camelCase rose sectors)."""
    return {
        "rose": [
            {"sector": s.sector, "freqPct": s.freqPct, "meanSpeed": s.meanSpeed}
            for s in data.rose
        ],
        "monthly": list(data.monthly),
        "diurnal": list(data.diurnal),
    }


def _score_to_wire(score: AnalysisScore) -> dict:
    """AnalysisScore (dataclass) -> the score wire dict. Components stay in the
    fixed order resource, cf, grid, terrain (compute_score builds them so)."""
    return {
        "value": score.value,
        "confidence": score.confidence,
        "components": [
            {
                "key": c.key,
                "weight": c.weight,
                "raw": c.raw,
                "normalized": c.normalized,
                "points": c.points,
            }
            for c in score.components
        ],
    }


# ── Public entry point (index.ts:173-290) ───────────────────────────────────


def analyze_aoi(
    aoi: ValidatedAoi,
    fetch_impl: Optional[TileFetchImpl] = None,
    budget_ms: Optional[float] = None,
) -> dict:
    """Run the full analysis for a validated AOI. Always returns a complete plan
    §3 envelope (camelCase wire dict) — section failures degrade in place.

    Mirrors AnalyzeOptions{fetchImpl, budgetMs}: ``fetch_impl`` is the tile fetch
    seam (threaded through to every section); ``budget_ms`` overrides the global
    wall-clock budget (tests only). (index.ts:177-290 analyzeAoi)

    Returns a plain dict/list/float/int/str/bool/None tree — NOT serialized here;
    the route serializes via serialize.js_dumps to reproduce Express res.json.
    """
    effective_budget = ANALYSIS_BUDGET_MS if budget_ms is None else budget_ms
    started_at = time.monotonic()

    # One executor for every timed section. max_workers covers the four
    # concurrent sections at peak (grid ∥ climate ∥ validation ∥ context) plus the
    # resource leg, and the timed-out work threads that may still be draining.
    # Daemon workers + a non-blocking shutdown reproduce Promise.race: the
    # response returns the moment every section has completed-or-timed-out, and a
    # timed-out section keeps draining in the background without stalling it.
    executor = _DaemonThreadPoolExecutor(max_workers=8, thread_name_prefix="analysis")
    try:
        # Independent sections start immediately, racing the full budget. Each runs
        # on ONE worker thread (submit_section); the budget is applied at await.
        grid_future = submit_section(
            executor, "grid", lambda: compute_grid(aoi, fetch_impl)
        )
        # Flag off → skip silently (no per-request error noise); when the flag is
        # on, compute_climate still raises ClimateDisabledError without a key —
        # the section maps it to "unavailable" with a server-side log.
        climate_future = (
            submit_section(executor, "climate", lambda: compute_climate(aoi.centroid))
            if CLIMATE_SECTION_ENABLED
            else None
        )

        # Mutable box so the artifacts the section A closure produces survive even
        # when the section later times out (mirrors the TS artifactsRef).
        artifacts_box: dict[str, Optional[ResourceArtifacts]] = {"current": None}

        def _set_artifacts(a: ResourceArtifacts) -> None:
            artifacts_box["current"] = a

        resource = run_section(
            "resource",
            effective_budget,
            lambda: compute_resource_data(aoi, fetch_impl, _set_artifacts),
            executor,
        )
        resource_data: Optional[ResourceData] = resource.data

        # Dependent sections get whatever budget is left (floored so they always
        # make an attempt — both are cheap relative to the tile fetches).
        remaining_ms = max(
            MIN_REMAINING_BUDGET_MS,
            effective_budget - round((time.monotonic() - started_at) * 1000),
        )

        shear_alpha = (
            resource_data.shear_alpha if resource_data is not None else SHEAR_ALPHA_FALLBACK
        )
        validation_future = submit_section(
            executor,
            "validation",
            lambda: compute_validation(aoi, shear_alpha, fetch_impl),
        )

        # Context reuses section A's elevation patch + mask; without them (GWA
        # down) it cannot compute farms/terrain on the shared grid → unavailable.
        resource_artifacts = artifacts_box["current"]
        if resource_artifacts is not None:
            cf_iec3 = resource_data.cf_iec3 if resource_data is not None else None
            context_future = submit_section(
                executor,
                "context",
                lambda: compute_context(
                    aoi,
                    {
                        "elevation": resource_artifacts.elevation,
                        "aoiMask": resource_artifacts.mask,
                        "cfIec3": cf_iec3,
                    },
                ),
            )
        else:
            context_future = None

        # Independent sections raced the full budget FROM t0 (index.ts:187-193):
        # they have already been running during the resource leg, so their
        # remaining deadline is the full budget minus the elapsed time. Dependent
        # ones race the remaining leg. Timeout -> unavailable.
        independent_remaining_ms = max(
            0.0, effective_budget - (time.monotonic() - started_at) * 1000
        )
        grid_section = await_section(grid_future, independent_remaining_ms, "grid")
        climate_section = (
            await_section(climate_future, independent_remaining_ms, "climate")
            if climate_future is not None
            else unavailable_section()
        )
        validation_section = await_section(validation_future, remaining_ms, "validation")
        context_section = (
            await_section(context_future, remaining_ms, "context")
            if context_future is not None
            else unavailable_section()
        )
    finally:
        # Non-blocking: a section that timed out keeps its worker thread draining
        # in the background (daemon) — never join it (the Promise.race contract).
        executor.shutdown(wait=False, cancel_futures=True)

    # ── Strip score-only extras + map snake_case -> camelCase wire (index.ts:234-272)
    grid_data = grid_section.data if grid_section.status == "ok" else None
    grid_wire: Optional[dict] = (
        {
            "nearestSubstation": grid_data["nearestSubstation"],
            "nearestLine": grid_data["nearestLine"],
            "ehvWithin25Km": grid_data["ehvWithin25Km"],
            "dataNote": grid_data["dataNote"],
        }
        if grid_data is not None
        else None
    )

    context_data = context_section.data if context_section.status == "ok" else None
    context_wire: Optional[dict] = (
        {
            "states": context_data["states"],
            "windfarms": context_data["windfarms"],
            "terrain": context_data["terrain"],
            "sizing": context_data["sizing"],
        }
        if context_data is not None
        else None
    )

    validation_data = validation_section.data if validation_section.status == "ok" else None

    # ── Score wiring (index.ts:261-272) ────────────────────────────────────
    # grid's nearestEhvKm and context's slope90thDeg feed the score but are
    # STRIPPED from the response sections above. Both read the RAW section data
    # (even when the stripped wire dict is built), exactly like the TS reads
    # gridSection.data / contextSection.data.
    raw_grid_data = grid_section.data
    raw_context_data = context_section.data
    score = compute_score(
        ScoreInputs(
            mean_speed=resource_data.mean_speed if resource_data is not None else None,
            cf_iec3=resource_data.cf_iec3 if resource_data is not None else None,
            nearest_ehv_km=(
                raw_grid_data.get("nearestEhvKm") if isinstance(raw_grid_data, dict) else None
            ),
            slope_90th_deg=(
                raw_context_data.get("slope90thDeg")
                if isinstance(raw_context_data, dict)
                else None
            ),
        ),
        # Mirrors the mast badge ONLY — never part of the arithmetic (plan §6).
        validation_data["confidence"]
        if isinstance(validation_data, dict) and validation_data.get("confidence") is not None
        else "low",
    )

    return {
        "analysisVersion": ANALYSIS_VERSION,
        "aoi": {
            "areaKm2": aoi.area_km2,
            "centroid": list(aoi.centroid),
            "isPointMode": aoi.is_point_mode,
        },
        "score": _score_to_wire(score),
        "sections": {
            "resource": _section_wire(resource, _resource_to_wire),
            "climate": _section_wire(climate_section, _climate_to_wire),
            "validation": _section_wire(validation_section, lambda d: d),
            "grid": {"status": "ok", "data": grid_wire}
            if grid_wire is not None
            else {"status": "unavailable", "data": None},
            "context": {"status": "ok", "data": context_wire}
            if context_wire is not None
            else {"status": "unavailable", "data": None},
        },
    }


def _section_wire(section: Section, to_wire: Callable[[object], object]) -> dict:
    """``{status, data}`` wire dict for a section whose data needs camelCase
    mapping. An unavailable (or null-data) section serializes to the degraded
    shape; an ok section maps its data through ``to_wire``."""
    if section.status != "ok" or section.data is None:
        return {"status": "unavailable", "data": None}
    return {"status": "ok", "data": to_wire(section.data)}
