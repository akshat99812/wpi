"""Pydantic v2 response models that DOCUMENT the POST /analyze wire contract.

These exist purely for OpenAPI / `/docs` — they are NOT the wire serializer. The
actual 200 body is assembled as a plain dict by ``app.engine.pipeline.analyze_aoi``
and serialized through ``app.serialize.js_dumps`` (which reproduces Express
``res.json`` exactly: non-finite -> null, integer-valued floats -> no ``.0``,
compact). FastAPI's default JSONResponse would emit ``NaN``/``Infinity`` and
``8.0``, so the route deliberately bypasses these models on the wire and returns a
raw ``fastapi.Response``. We keep the models in lockstep with the camelCase
contract in CURRENT_STATE.md §2 / types.ts so the docs never drift.

Every model uses ``populate_by_name`` + camelCase ``alias`` so the field names
read naturally in Python while the documented JSON keys stay camelCase. Optional
fields default to ``None`` to mirror the ``num | null`` contract.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ── Shared config ────────────────────────────────────────────────────────────

SectionStatus = Literal["ok", "unavailable"]
Confidence = Literal["high", "medium", "low"]
SiteClass = Literal["excellent", "good", "moderate", "marginal"]


class _WireModel(BaseModel):
    """Base: serialize by camelCase alias, accept either name when populating."""

    model_config = ConfigDict(populate_by_name=True)


# ── aoi ──────────────────────────────────────────────────────────────────────


class AoiModel(_WireModel):
    area_km2: float = Field(alias="areaKm2", description="Geodesic area, UNROUNDED.")
    centroid: list[float] = Field(description="[lon, lat], UNROUNDED.")
    is_point_mode: bool = Field(alias="isPointMode")


# ── score ────────────────────────────────────────────────────────────────────


class ScoreComponentModel(_WireModel):
    key: str
    weight: float
    raw: Optional[float] = None
    normalized: float = Field(description="UNROUNDED 0..1.")
    points: float = Field(description="Weighted points, 1 dp.")


class ScoreModel(_WireModel):
    value: int
    confidence: Confidence
    components: list[ScoreComponentModel] = Field(
        description="Exactly 4, in order: resource, cf, grid, terrain."
    )


# ── sections.resource ────────────────────────────────────────────────────────


class WeibullModel(_WireModel):
    A: float
    k: float


class ResourceDataModel(_WireModel):
    mean_speed: float = Field(alias="meanSpeed")
    min_speed: float = Field(alias="minSpeed")
    max_speed: float = Field(alias="maxSpeed")
    p25_speed: float = Field(alias="p25Speed")
    p50_speed: float = Field(alias="p50Speed")
    p75_speed: float = Field(alias="p75Speed")
    area_exceedance90: float = Field(alias="areaExceedance90")
    power_density: Optional[float] = Field(default=None, alias="powerDensity")
    power_density_raw: Optional[float] = Field(default=None, alias="powerDensityRaw")
    air_density: float = Field(alias="airDensity")
    cf_iec3: Optional[float] = Field(default=None, alias="cfIec3")
    cf_iec2: Optional[float] = Field(default=None, alias="cfIec2")
    shear_alpha: float = Field(alias="shearAlpha")
    weibull: Optional[WeibullModel] = None
    india_percentile: Optional[float] = Field(default=None, alias="indiaPercentile")
    site_class: SiteClass = Field(alias="siteClass")


class ResourceSectionModel(_WireModel):
    status: SectionStatus
    data: Optional[ResourceDataModel] = None


# ── sections.climate (unavailable by default) ────────────────────────────────


class ClimateRoseSectorModel(_WireModel):
    sector: int
    freq_pct: float = Field(alias="freqPct")
    mean_speed: float = Field(alias="meanSpeed")


class ClimateDataModel(_WireModel):
    rose: list[ClimateRoseSectorModel] = Field(description="16 sectors.")
    monthly: list[float] = Field(description="12 values.")
    diurnal: list[float] = Field(description="24 values.")


class ClimateSectionModel(_WireModel):
    status: SectionStatus
    data: Optional[ClimateDataModel] = None


# ── sections.validation ──────────────────────────────────────────────────────


class NearestMastModel(_WireModel):
    station: str
    distance_km: float = Field(alias="distanceKm")
    maws: float
    mawpd: Optional[float] = None
    height_m: float = Field(alias="heightM")
    id: str


class ValidationDataModel(_WireModel):
    mast_count_in_aoi: int = Field(alias="mastCountInAoi")
    nearest_mast: Optional[NearestMastModel] = Field(default=None, alias="nearestMast")
    model_delta_pct: Optional[float] = Field(default=None, alias="modelDeltaPct")
    confidence: Confidence


class ValidationSectionModel(_WireModel):
    status: SectionStatus
    data: Optional[ValidationDataModel] = None


# ── sections.grid (nearestEhvKm STRIPPED) ────────────────────────────────────


class NearestSubstationModel(_WireModel):
    name: Optional[str] = None
    voltage_kv: Optional[float] = Field(default=None, alias="voltageKv")
    distance_km: float = Field(alias="distanceKm")


class NearestLineModel(_WireModel):
    voltage_kv: Optional[float] = Field(default=None, alias="voltageKv")
    distance_km: float = Field(alias="distanceKm")


class GridDataModel(_WireModel):
    nearest_substation: Optional[NearestSubstationModel] = Field(
        default=None, alias="nearestSubstation"
    )
    nearest_line: Optional[NearestLineModel] = Field(default=None, alias="nearestLine")
    ehv_within25_km: bool = Field(alias="ehvWithin25Km")
    data_note: str = Field(alias="dataNote")


class GridSectionModel(_WireModel):
    status: SectionStatus
    data: Optional[GridDataModel] = None


# ── sections.context (slope90thDeg STRIPPED) ─────────────────────────────────


class ContextStateModel(_WireModel):
    name: str
    installed_mw: Optional[float] = Field(default=None, alias="installedMw")
    potential_mw: Optional[float] = Field(default=None, alias="potentialMw")


class ContextWindfarmsModel(_WireModel):
    count: int
    overlap_fraction: float = Field(alias="overlapFraction")


class ContextTerrainModel(_WireModel):
    elev_mean: float = Field(alias="elevMean")
    elev_min: float = Field(alias="elevMin")
    elev_max: float = Field(alias="elevMax")
    slope_mean_deg: float = Field(alias="slopeMeanDeg")
    slope_steep10_deg: float = Field(alias="slopeSteep10Deg")


class ContextSizingModel(_WireModel):
    capacity_mw: float = Field(alias="capacityMw")
    energy_gwh: float = Field(alias="energyGwh")
    assumptions: list[str]


class ContextDataModel(_WireModel):
    states: list[ContextStateModel]
    windfarms: ContextWindfarmsModel
    terrain: Optional[ContextTerrainModel] = None
    sizing: ContextSizingModel


class ContextSectionModel(_WireModel):
    status: SectionStatus
    data: Optional[ContextDataModel] = None


# ── top-level envelope ───────────────────────────────────────────────────────


class SectionsModel(_WireModel):
    resource: ResourceSectionModel
    climate: ClimateSectionModel
    validation: ValidationSectionModel
    grid: GridSectionModel
    context: ContextSectionModel


class AnalysisResponse(_WireModel):
    """The full POST /analyze 200 envelope (plan §3 / types.ts AnalysisResponse)."""

    analysis_version: str = Field(alias="analysisVersion")
    aoi: AoiModel
    score: ScoreModel
    sections: SectionsModel


class AnalysisError(_WireModel):
    """The 400 (and 500) error body: ``{ error, code? }``."""

    error: str
    code: Optional[str] = Field(
        default=None,
        description="Machine-readable GeometryErrorCode on 400; absent on 500.",
    )
