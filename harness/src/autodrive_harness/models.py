from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


RAW_SCENE_ID = re.compile(r"scene-\d{4,}", re.IGNORECASE)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Point3D(StrictModel):
    x: float
    y: float
    z: float = 0.0


class CameraBox(StrictModel):
    x: float
    y: float
    width: float
    height: float
    imageWidth: float
    imageHeight: float
    depth: float


class EgoPose(StrictModel):
    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class PerceptionObject(StrictModel):
    id: str
    label: str
    category: str
    x: float
    y: float
    z: float = 0.0
    width: float
    length: float
    height: float
    yaw: float = 0.0
    risk: Literal["low", "medium", "high"] = "low"
    cameraBox: Optional[CameraBox] = None


class Lane(StrictModel):
    id: str
    points: List[Point3D]


class TelemetryRow(StrictModel):
    time: float = Field(ge=0)
    speedKmh: float
    brake: float
    throttle: float
    steering: float
    accel: float
    scene: Optional[str] = None


class PerceptionRow(StrictModel):
    time: float = Field(ge=0)
    timestampUs: Optional[int] = None
    sampleToken: Optional[str] = None
    sampleDataToken: Optional[str] = None
    imageFile: Optional[str] = None
    ego: EgoPose = Field(default_factory=EgoPose)
    objects: List[PerceptionObject] = Field(default_factory=list)
    lanes: List[Lane] = Field(default_factory=list)
    plannedPath: List[Point3D] = Field(default_factory=list)


class LidarFrame(StrictModel):
    time: float = Field(ge=0)
    timestamp_us: Optional[int] = Field(default=None, alias="timestampUs")
    file: str
    point_count: int = Field(alias="pointCount", ge=0)


class SceneBundle(StrictModel):
    scene_key: str
    scene_name: str
    description: str = ""
    telemetry: List[TelemetryRow]
    perception: List[PerceptionRow]
    metadata: Dict[str, Any]
    lidar_index: Optional[List[LidarFrame]] = None


class DataQualityFinding(StrictModel):
    code: str
    severity: Literal["info", "warning", "error"]
    affected_modules: List[str]
    message: str


class ValidationResult(StrictModel):
    usable: bool
    quality_score: int = Field(ge=0, le=100)
    findings: List[DataQualityFinding]


class TelemetryEvidence(StrictModel):
    value: TelemetryRow
    provenance: Literal["source", "interpolated"]
    source_times: List[float]


class PerceptionEvidence(StrictModel):
    value: PerceptionRow
    provenance: Literal["nearest"]
    source_times: List[float]


class LidarEvidence(StrictModel):
    value: Optional[LidarFrame]
    provenance: Literal["nearest", "unavailable"]
    source_times: List[float]


class TimelineSample(StrictModel):
    time: float = Field(ge=0)
    telemetry: TelemetryEvidence
    perception: PerceptionEvidence
    lidar: LidarEvidence


class SceneFeatures(StrictModel):
    duration: float = Field(ge=0)
    peak_speed: float = Field(ge=0)
    peak_abs_accel: float = Field(ge=0)
    peak_abs_jerk: float = Field(ge=0)
    peak_steering_rate: float = Field(ge=0)
    control_conflict_duration: float = Field(ge=0)
    object_peak: int = Field(ge=0)
    high_risk_object_peak: int = Field(ge=0)
    medium_risk_object_peak: int = Field(ge=0)
    tracking_continuity: float = Field(ge=0, le=1)
    trajectory_deviation: float = Field(ge=0)
    provenance: Dict[str, str] = Field(default_factory=dict)


class EvidenceRef(StrictModel):
    id: str = Field(pattern=r"^ev-\d{4}$")
    source: Literal["camera", "perception", "lidar", "ego_pose", "telemetry", "trajectory"]
    provenance: Literal["real", "real-derived", "estimated", "demo-visualization"]
    start_time: float = Field(ge=0)
    end_time: float = Field(ge=0)
    detail: str

    @model_validator(mode="after")
    def valid_interval(self) -> "EvidenceRef":
        if self.end_time < self.start_time:
            raise ValueError("evidence end_time must not precede start_time")
        return self


class RiskEpisode(StrictModel):
    id: str = Field(pattern=r"^ep-\d{4}$")
    start_time: float = Field(ge=0)
    end_time: float = Field(ge=0)
    peak_time: float = Field(ge=0)
    risk: Literal["medium", "high"]
    summary: str
    evidence_ids: List[str]
    control_conflict: bool = False

    @model_validator(mode="after")
    def valid_times_and_evidence(self) -> "RiskEpisode":
        if not self.start_time <= self.peak_time <= self.end_time:
            raise ValueError("episode peak_time must lie inside its interval")
        if any(re.fullmatch(r"ev-\d{4}", item) is None for item in self.evidence_ids):
            raise ValueError("episode evidence ids must use ev-####")
        return self


class RiskScores(StrictModel):
    perception: int = Field(ge=0, le=100)
    motion: int = Field(ge=0, le=100)
    control: int = Field(ge=0, le=100)
    trajectory: int = Field(ge=0, le=100)
    data_quality: int = Field(ge=0, le=100)
    overall: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)


class Finding(StrictModel):
    id: str = Field(pattern=r"^finding-\d{4}$")
    title: str
    summary: str
    severity: Literal["info", "medium", "high"]
    evidence_ids: List[str]


class AnalysisSection(StrictModel):
    summary: str
    metrics: Dict[str, Any] = Field(default_factory=dict)
    evidence_ids: List[str]


class CausalChain(StrictModel):
    observation: str
    mechanism: str
    possible_impact: str
    evidence_ids: List[str]
    confidence: float = Field(ge=0, le=1)


class Recommendation(StrictModel):
    id: str = Field(pattern=r"^recommendation-\d{4}$")
    priority: Literal["low", "medium", "high"]
    action: str
    rationale: str
    evidence_ids: List[str]


class RegressionRecommendation(StrictModel):
    name: str
    criterion: str
    rationale: str


class DiagnosisReport(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    scene_name: str
    data_version: str
    generation_mode: Literal["local-harness", "model-enhanced"]
    executive_summary: str
    scene_overview: Dict[str, Any]
    data_quality: List[DataQualityFinding]
    scores: RiskScores
    key_findings: List[Finding]
    timeline: List[RiskEpisode]
    perception_analysis: AnalysisSection
    motion_control_analysis: AnalysisSection
    trajectory_analysis: AnalysisSection
    causal_chains: List[CausalChain]
    recommendations: List[Recommendation]
    regression_tests: List[RegressionRecommendation]
    evidence_index: List[EvidenceRef]
    limitations: List[str]

    @model_validator(mode="after")
    def forbids_raw_scene_ids(self) -> "DiagnosisReport":
        serialized = json.dumps(self.model_dump(mode="json"), ensure_ascii=False)
        if RAW_SCENE_ID.search(serialized):
            raise ValueError("diagnosis reports must not expose raw scene ids")
        return self


class DiagnosisProgress(StrictModel):
    stage: Literal[
        "validation", "timeline", "features", "events", "causality", "report",
        "enhancement", "complete",
    ]
    percent: int = Field(ge=0, le=100)


class DiagnosisContext(StrictModel):
    bundle: SceneBundle
    validation: ValidationResult
    samples: List[TimelineSample]
    features: SceneFeatures
    episodes: List[RiskEpisode]
    scores: RiskScores
    data_version: str
