from __future__ import annotations

from typing import TYPE_CHECKING, Callable, Dict, List, Tuple

from .causality import build_causal_chains
from .models import (
    CausalChain,
    DataQualityFinding,
    DiagnosisContext,
    DiagnosisProgress,
    EvidenceRef,
    Finding,
    Recommendation,
    RegressionRecommendation,
    RiskEpisode,
    TimelineSample,
)

if TYPE_CHECKING:
    from .fact_bundle import FactBundle


STANDARD_LIMITATIONS = [
    "车速、制动、油门与转向来自位姿差分或演示估计，不是原始 CAN 总线信号。",
    "车道引导线与计划路径是演示可视化，不是高精地图或量产规划器真值。",
    "本地规则分析仅用于场景筛查与回归建议，不代替道路安全认证。",
]

ProgressCallback = Callable[[DiagnosisProgress], None]


def _risk_label(value: str) -> str:
    return {"high": "高", "medium": "中"}[value]


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
        evidence_ids.append(_append_evidence(
            evidence, "camera", "real", start_time, end_time,
            f"{label}时间窗内存在真实相机图像样本。",
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
        if any(row.imageFile for row in bundle.perception):
            _append_evidence(
                evidence, "camera", "real", start_time, end_time,
                "原始感知时间窗内存在真实相机图像样本。",
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
    if not context.validation.usable:
        return [Finding(
            id="finding-0001",
            title="跨模态事件挖掘不可评估",
            summary=(
                "因跨模态数据不满足时间对齐条件，未执行风险事件挖掘，"
                "不能将空事件列表解释为无风险结论。"
            ),
            severity="info",
            evidence_ids=baseline_evidence_ids,
        )]
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
    if not context.validation.usable:
        recovery_target = _degraded_recovery_target(context)
        return [Recommendation(
            id="recommendation-0001",
            priority="high",
            action=f"{recovery_target}，恢复跨模态时间对齐后重新运行全场景诊断。",
            rationale=(
                "当前仅能保留存活模态的独立指标，不足以执行事件挖掘与因果分析。"
            ),
            evidence_ids=[item.id for item in evidence],
        )]
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
    if not context.validation.usable:
        recovery_target = _degraded_recovery_target(context)
        return [RegressionRecommendation(
            name="跨模态数据恢复复验",
            criterion=(
                f"{recovery_target}，确认时间对齐可用后重新运行事件挖掘与因果分析。"
            ),
            rationale="只有恢复完整跨模态输入，才能对风险事件和因果链进行有效复验。",
        )]
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


def _degraded_recovery_target(context: DiagnosisContext) -> str:
    codes = {item.code for item in context.validation.findings}
    missing = []
    if "telemetry-missing" in codes:
        missing.append("遥测")
    if "perception-missing" in codes:
        missing.append("感知")
    if missing:
        return f"补齐{'与'.join(missing)}数据"
    if "timeline-skew-excessive" in codes:
        return "校正遥测与感知的时钟偏移"
    return "修复遥测与感知的有效重叠时间窗"


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


def build_deterministic_facts(
    context: DiagnosisContext,
    evidence_index: List[EvidenceRef],
) -> FactBundle:
    from .fact_bundle import build_fact_bundle

    causal_chains = build_causal_chains(context, evidence_index)
    return build_fact_bundle(context, evidence_index, causal_chains)


def report_progress(
    emit: ProgressCallback,
    stage: str,
    percent: int,
) -> None:
    emit(DiagnosisProgress(stage=stage, percent=percent))
