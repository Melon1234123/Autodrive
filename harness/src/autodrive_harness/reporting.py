from __future__ import annotations

import hashlib
import json
from typing import Dict, List, Optional, Tuple

from .catalog import APPROVED_SCENE_NAMES
from .causality import build_causal_chains
from .models import (
    AnalysisSection,
    CausalChain,
    DataQualityFinding,
    DiagnosisContext,
    DiagnosisReport,
    EvidenceRef,
    Finding,
    RAW_SCENE_ID,
    Recommendation,
    RegressionRecommendation,
    RiskEpisode,
    TimelineSample,
)


STANDARD_LIMITATIONS = [
    "车速、制动、油门与转向来自位姿差分或演示估计，不是原始 CAN 总线信号。",
    "车道引导线与计划路径是演示可视化，不是高精地图或量产规划器真值。",
    "本地规则分析仅用于场景筛查与回归建议，不代替道路安全认证。",
]


def _risk_label(value: str) -> str:
    return {"high": "高", "medium": "中"}[value]


def protected_fingerprint(report: DiagnosisReport) -> str:
    encoded = json.dumps(
        report.model_dump(mode="json"),
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _samples_in_window(
    context: DiagnosisContext, start_time: float, end_time: float
) -> List[TimelineSample]:
    return [
        sample for sample in context.samples
        if start_time <= sample.time <= end_time
    ]


def _append_evidence(
    evidence: List[EvidenceRef],
    source: str,
    provenance: str,
    start_time: float,
    end_time: float,
    detail: str,
) -> str:
    evidence_id = f"ev-{len(evidence) + 1:04d}"
    evidence.append(EvidenceRef(
        id=evidence_id,
        source=source,
        provenance=provenance,
        start_time=start_time,
        end_time=end_time,
        detail=detail,
    ))
    return evidence_id


def _evidence_for_window(
    samples: List[TimelineSample],
    start_time: float,
    end_time: float,
    label: str,
    evidence: List[EvidenceRef],
) -> List[str]:
    evidence_ids: List[str] = []
    if any(sample.perception.value.imageFile for sample in samples):
        image_file = next(
            sample.perception.value.imageFile
            for sample in samples
            if sample.perception.value.imageFile
        )
        evidence_ids.append(_append_evidence(
            evidence, "camera", "real", start_time, end_time,
            f"{label}时间窗内存在真实相机图像样本 {image_file}。",
        ))
    if any(sample.perception.value.objects for sample in samples):
        evidence_ids.append(_append_evidence(
            evidence, "perception", "real-derived", start_time, end_time,
            f"{label}时间窗内存在感知目标。",
        ))
    if any(
        sample.perception.value.ego.latitude is not None
        or sample.perception.value.ego.longitude is not None
        or sample.perception.value.ego.x != 0.0
        or sample.perception.value.ego.y != 0.0
        or sample.perception.value.ego.yaw != 0.0
        for sample in samples
    ):
        evidence_ids.append(_append_evidence(
            evidence, "ego_pose", "real", start_time, end_time,
            f"{label}时间窗内存在感知记录的真实自车位姿。",
        ))
    if samples:
        evidence_ids.append(_append_evidence(
            evidence, "telemetry", "estimated", start_time, end_time,
            f"{label}时间窗内存在对齐遥测样本。",
        ))
    if any(sample.perception.value.plannedPath for sample in samples):
        evidence_ids.append(_append_evidence(
            evidence, "trajectory", "demo-visualization", start_time, end_time,
            f"{label}时间窗内存在非空演示计划路径。",
        ))
    if any(sample.lidar.value is not None for sample in samples):
        evidence_ids.append(_append_evidence(
            evidence, "lidar", "real", start_time, end_time,
            f"{label}时间窗内存在 LiDAR 索引帧。",
        ))
    return evidence_ids


def prepare_report_context(
    context: DiagnosisContext,
) -> Tuple[DiagnosisContext, List[EvidenceRef]]:
    if not context.validation.usable and not context.samples:
        return context, _raw_modality_evidence(context)
    evidence: List[EvidenceRef] = []
    episodes: List[RiskEpisode] = []
    for episode in context.episodes:
        samples = _samples_in_window(context, episode.start_time, episode.end_time)
        evidence_ids = _evidence_for_window(
            samples,
            episode.start_time,
            episode.end_time,
            f"{_risk_label(episode.risk)}风险",
            evidence,
        )
        episodes.append(episode.model_copy(update={"evidence_ids": evidence_ids}))

    if not episodes:
        start_time = context.samples[0].time if context.samples else 0.0
        end_time = context.samples[-1].time if context.samples else start_time
        _evidence_for_window(
            context.samples, start_time, end_time, "基线", evidence
        )
    return context.model_copy(update={"episodes": episodes}), evidence


def _raw_modality_evidence(context: DiagnosisContext) -> List[EvidenceRef]:
    bundle = context.bundle
    evidence: List[EvidenceRef] = []

    if bundle.perception:
        start_time = min(row.time for row in bundle.perception)
        end_time = max(row.time for row in bundle.perception)
        image_file = next(
            (row.imageFile for row in bundle.perception if row.imageFile),
            None,
        )
        if image_file:
            _append_evidence(
                evidence, "camera", "real", start_time, end_time,
                f"原始感知序列存在真实相机图像样本 {image_file}。",
            )
        if any(row.objects for row in bundle.perception):
            _append_evidence(
                evidence, "perception", "real-derived", start_time, end_time,
                "原始感知序列存在真实数据推导的目标记录。",
            )
        if any(
            row.ego.latitude is not None
            or row.ego.longitude is not None
            or row.ego.x != 0.0
            or row.ego.y != 0.0
            or row.ego.yaw != 0.0
            for row in bundle.perception
        ):
            _append_evidence(
                evidence, "ego_pose", "real", start_time, end_time,
                "原始感知序列存在真实自车位姿记录。",
            )
        if any(row.plannedPath for row in bundle.perception):
            _append_evidence(
                evidence, "trajectory", "demo-visualization", start_time, end_time,
                "原始感知序列存在非空演示计划路径。",
            )

    if bundle.telemetry:
        _append_evidence(
            evidence, "telemetry", "estimated",
            min(row.time for row in bundle.telemetry),
            max(row.time for row in bundle.telemetry),
            "原始遥测序列可用，运动与控制指标由该序列独立计算。",
        )

    if bundle.lidar_index:
        _append_evidence(
            evidence, "lidar", "real",
            min(row.time for row in bundle.lidar_index),
            max(row.time for row in bundle.lidar_index),
            "原始 LiDAR 索引包含真实点云帧引用。",
        )
    return evidence


def _evidence_ids_by_source(evidence: List[EvidenceRef], source: str) -> List[str]:
    return [item.id for item in evidence if item.source == source]


def _key_findings(
    context: DiagnosisContext, baseline_evidence_ids: List[str]
) -> List[Finding]:
    if not context.episodes:
        return [Finding(
            id="finding-0001",
            title="未检出持续风险事件",
            summary="在当前阈值与可用模态下，未检出超过最短持续时间的风险窗。",
            severity="info",
            evidence_ids=baseline_evidence_ids,
        )]
    return [Finding(
        id=f"finding-{index:04d}",
        title=f"{_risk_label(episode.risk)}风险事件",
        summary=episode.summary,
        severity=episode.risk,
        evidence_ids=episode.evidence_ids,
    ) for index, episode in enumerate(context.episodes, start=1)]


def _recommendations(
    context: DiagnosisContext, evidence: List[EvidenceRef]
) -> List[Recommendation]:
    recommendations: List[Recommendation] = []
    telemetry_ids = _evidence_ids_by_source(evidence, "telemetry")
    perception_ids = _evidence_ids_by_source(evidence, "perception")
    trajectory_ids = _evidence_ids_by_source(evidence, "trajectory")
    if any(episode.control_conflict for episode in context.episodes):
        recommendations.append(Recommendation(
            id=f"recommendation-{len(recommendations) + 1:04d}",
            priority="high",
            action="在制动请求生效时增加油门抑制与控制意图互斥检查。",
            rationale="当前时间窗出现了制动与油门重叠的可观测事实。",
            evidence_ids=telemetry_ids,
        ))
    if any(episode.risk == "high" for episode in context.episodes) and perception_ids:
        recommendations.append(Recommendation(
            id=f"recommendation-{len(recommendations) + 1:04d}",
            priority="high",
            action="扩充高风险目标时间窗的减速与避让回归用例。",
            rationale="高风险目标在连续帧中持续存在，需验证决策的时序稳定性。",
            evidence_ids=perception_ids + trajectory_ids,
        ))
    if not recommendations:
        recommendations.append(Recommendation(
            id="recommendation-0001",
            priority="medium",
            action="保留当前场景作为无持续风险的基线回归用例。",
            rationale="基线场景可用于监测规则阈值调整后的误报。",
            evidence_ids=[item.id for item in evidence],
        ))
    return recommendations


def _regression_tests(context: DiagnosisContext) -> List[RegressionRecommendation]:
    tests = [RegressionRecommendation(
        name="风险时间窗稳定性",
        criterion=(
            f"在相同数据版本上保持 {len(context.episodes)} 个事件，"
            "峰值时间偏差不超过 0.1 秒。"
        ),
        rationale="防止时间对齐或滞回规则变更造成事件漂移。",
    )]
    if any(episode.control_conflict for episode in context.episodes):
        tests.append(RegressionRecommendation(
            name="制动油门互斥",
            criterion="制动大于 0.4 时，油门大于 0.2 的重叠时长不得增加。",
            rationale="直接覆盖本场景已观测的控制冲突。",
        ))
    return tests


def _data_quality(
    context: DiagnosisContext, available_sources: set
) -> List[DataQualityFinding]:
    findings = list(context.validation.findings)
    existing_codes = {item.code for item in findings}
    missing = [
        ("perception", "perception-objects-unavailable", ["perception"],
         "事件窗内缺少感知目标，感知风险不可评估。"),
        ("telemetry", "telemetry-unavailable", ["telemetry", "motion", "control"],
         "事件窗内缺少遥测样本，运动与控制不可评估。"),
        ("trajectory", "trajectory-unavailable", ["trajectory"],
         "事件窗内缺少非空计划路径，轨迹偏移不可评估。"),
    ]
    for source, code, modules, message in missing:
        if source not in available_sources and code not in existing_codes:
            findings.append(DataQualityFinding(
                code=code,
                severity="info",
                affected_modules=modules,
                message=message,
            ))
    return findings


def _limitations(available_sources: set) -> List[str]:
    limitations = list(STANDARD_LIMITATIONS)
    unavailable = {
        "perception": "事件窗内缺少感知目标，感知风险不可评估。",
        "telemetry": "事件窗内缺少遥测样本，运动与控制不可评估。",
        "trajectory": "事件窗内缺少非空计划路径，轨迹偏移不可评估。",
    }
    limitations.extend(
        text for source, text in unavailable.items() if source not in available_sources
    )
    return limitations


def _unavailable_section(source: str, metric_names: List[str]) -> AnalysisSection:
    labels = {
        "perception": "感知目标",
        "telemetry": "运动与控制",
        "trajectory": "轨迹偏移",
    }
    return AnalysisSection(
        summary=f"事件窗内缺少可用证据，{labels[source]}不可评估。",
        metrics={name: None for name in metric_names},
        evidence_ids=[],
    )


def _referenced_evidence_ids(report: DiagnosisReport) -> List[str]:
    references: List[str] = []
    for episode in report.timeline:
        references.extend(episode.evidence_ids)
    for episode in report.historical_risk_events:
        references.extend(episode.evidence_ids)
    for finding in report.key_findings:
        references.extend(finding.evidence_ids)
    for section in (
        report.perception_analysis,
        report.motion_control_analysis,
        report.trajectory_analysis,
    ):
        references.extend(section.evidence_ids)
    for chain in report.causal_chains:
        references.extend(chain.evidence_ids)
    for recommendation in report.recommendations:
        references.extend(recommendation.evidence_ids)
    return references


def validate_report_contract(report: DiagnosisReport) -> DiagnosisReport:
    if report.scene_name not in set(APPROVED_SCENE_NAMES.values()):
        raise ValueError("report scene_name is not an approved Chinese scene name")
    if RAW_SCENE_ID.search(report.model_dump_json()):
        raise ValueError("diagnosis reports must not expose raw scene ids")

    finding_ids = [item.id for item in report.key_findings]
    recommendation_ids = [item.id for item in report.recommendations]
    if len(finding_ids) != len(set(finding_ids)):
        raise ValueError("finding ids must be unique")
    if len(recommendation_ids) != len(set(recommendation_ids)):
        raise ValueError("recommendation ids must be unique")

    evidence = {item.id: item for item in report.evidence_index}
    if len(evidence) != len(report.evidence_index):
        raise ValueError("evidence ids must be unique")
    references = set(_referenced_evidence_ids(report))
    dangling = references - set(evidence)
    if dangling:
        raise ValueError(f"dangling evidence ids: {sorted(dangling)}")
    orphaned = set(evidence) - references
    if orphaned:
        raise ValueError(f"orphaned evidence ids: {sorted(orphaned)}")

    canonical_provenance = {
        "camera": "real",
        "perception": "real-derived",
        "lidar": "real",
        "ego_pose": "real",
        "telemetry": "estimated",
        "trajectory": "demo-visualization",
    }
    for item in report.evidence_index:
        if item.provenance != canonical_provenance[item.source]:
            raise ValueError(f"invalid provenance for {item.source}: {item.id}")

    section_contracts = [
        (report.perception_analysis, "perception", "real-derived"),
        (report.motion_control_analysis, "telemetry", "estimated"),
        (report.trajectory_analysis, "trajectory", "demo-visualization"),
    ]
    for section, source, provenance in section_contracts:
        if not section.evidence_ids:
            if "不可评估" not in section.summary:
                raise ValueError(f"{source} analysis without evidence must be unavailable")
            if any(value is not None for value in section.metrics.values()):
                raise ValueError(f"{source} unavailable metrics must be null")
            continue
        for evidence_id in section.evidence_ids:
            item = evidence[evidence_id]
            if item.source != source or item.provenance != provenance:
                raise ValueError(f"{source} analysis references mismatched evidence")
    return report


def assemble_report(
    context: DiagnosisContext,
    causal_chains: Optional[List[CausalChain]] = None,
    evidence_index: Optional[List[EvidenceRef]] = None,
) -> DiagnosisReport:
    if evidence_index is None:
        context, evidence_index = prepare_report_context(context)
    evidence_ids = [item.id for item in evidence_index]
    available_sources = {item.source for item in evidence_index}
    perception_ids = _evidence_ids_by_source(evidence_index, "perception")
    telemetry_ids = _evidence_ids_by_source(evidence_index, "telemetry")
    trajectory_ids = _evidence_ids_by_source(evidence_index, "trajectory")
    if causal_chains is None:
        causal_chains = build_causal_chains(context, evidence_index)

    perception_analysis = (
        AnalysisSection(
            summary=(
                f"单帧最多 {context.features.object_peak} 个目标，"
                f"高风险目标峰值 {context.features.high_risk_object_peak} 个。"
            ),
            metrics={
                "object_peak": context.features.object_peak,
                "high_risk_object_peak": context.features.high_risk_object_peak,
                "tracking_continuity": context.features.tracking_continuity,
            },
            evidence_ids=perception_ids,
        ) if perception_ids else _unavailable_section(
            "perception", ["object_peak", "high_risk_object_peak", "tracking_continuity"]
        )
    )
    motion_analysis = (
        AnalysisSection(
            summary=(
                f"峰值车速 {context.features.peak_speed:.2f} km/h，"
                f"制动油门重叠 {context.features.control_conflict_duration:.2f} 秒。"
            ),
            metrics={
                "peak_speed_kmh": context.features.peak_speed,
                "peak_abs_accel": context.features.peak_abs_accel,
                "peak_abs_jerk": context.features.peak_abs_jerk,
                "control_conflict_seconds": context.features.control_conflict_duration,
            },
            evidence_ids=telemetry_ids,
        ) if telemetry_ids else _unavailable_section(
            "telemetry", ["peak_speed_kmh", "peak_abs_accel", "peak_abs_jerk",
                          "control_conflict_seconds"]
        )
    )
    trajectory_analysis = (
        AnalysisSection(
            summary=(
                f"演示计划路径的峰值横向偏移为 "
                f"{context.features.trajectory_deviation:.2f} 米。"
            ),
            metrics={"demo_path_lateral_deviation": context.features.trajectory_deviation},
            evidence_ids=trajectory_ids,
        ) if trajectory_ids else _unavailable_section(
            "trajectory", ["demo_path_lateral_deviation"]
        )
    )

    description = RAW_SCENE_ID.sub("内部场景", context.bundle.description)
    high_count = sum(episode.risk == "high" for episode in context.episodes)
    if context.scores.overall is None:
        executive_summary = (
            "数据未满足跨模态时间对齐条件，综合风险不可评估；"
            "报告保留各存活模态可独立验证的指标与证据。"
        )
    else:
        executive_summary = (
            f"本地确定性分析检出 {len(context.episodes)} 个持续风险事件，"
            f"其中 {high_count} 个为高风险；综合风险分为 {context.scores.overall}。"
        )
    report = DiagnosisReport(
        scene_name=context.bundle.scene_name,
        data_version=context.data_version,
        generation_mode="local-harness",
        executive_summary=executive_summary,
        scene_overview={
            "description": description,
            "duration_seconds": context.features.duration,
            "telemetry_samples": len(context.bundle.telemetry),
            "perception_samples": len(context.bundle.perception),
            "lidar_available": bool(context.bundle.lidar_index),
        },
        data_quality=_data_quality(context, available_sources),
        scores=context.scores,
        key_findings=_key_findings(context, evidence_ids),
        timeline=context.episodes,
        historical_risk_events=context.episodes,
        perception_analysis=perception_analysis,
        motion_control_analysis=motion_analysis,
        trajectory_analysis=trajectory_analysis,
        causal_chains=causal_chains,
        recommendations=_recommendations(context, evidence_index),
        regression_tests=_regression_tests(context),
        evidence_index=evidence_index,
        limitations=_limitations(available_sources),
    )
    return validate_report_contract(report)
