from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Dict, Iterable, List, Optional, Tuple

from .catalog import APPROVED_SCENE_NAMES
from .causality import build_causal_chains
from .models import (
    AnalysisSection,
    CausalChain,
    DiagnosisContext,
    DiagnosisReport,
    EvidenceRef,
    Finding,
    RAW_SCENE_ID,
    Recommendation,
    RegressionRecommendation,
)


STANDARD_LIMITATIONS = [
    "车速、制动、油门与转向来自位姿差分或演示估计，不是原始 CAN 总线信号。",
    "车道引导线与计划路径是演示可视化，不是高精地图或量产规划器真值。",
    "本地规则分析仅用于场景筛查与回归建议，不代替道路安全认证。",
]


def _risk_label(value: str) -> str:
    return {"high": "高", "medium": "中"}[value]


def protected_projection(report: DiagnosisReport) -> Dict:
    protected = deepcopy(report.model_dump(mode="json"))
    protected["generation_mode"] = "<narrative-allowed>"
    protected["executive_summary"] = "<narrative-allowed>"
    for finding in protected["key_findings"]:
        finding["title"] = "<narrative-allowed>"
        finding["summary"] = "<narrative-allowed>"
    for section in (
        "perception_analysis", "motion_control_analysis", "trajectory_analysis"
    ):
        protected[section]["summary"] = "<narrative-allowed>"
    for chain in protected["causal_chains"]:
        chain["mechanism"] = "<narrative-allowed>"
        chain["possible_impact"] = "<narrative-allowed>"
    for recommendation in protected["recommendations"]:
        recommendation["action"] = "<narrative-allowed>"
        recommendation["rationale"] = "<narrative-allowed>"
    return protected


def protected_fingerprint(report: DiagnosisReport) -> str:
    encoded = json.dumps(
        protected_projection(report),
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _evidence_index(context: DiagnosisContext) -> List[EvidenceRef]:
    if context.episodes:
        windows: Iterable[Tuple[List[str], float, float, float, str]] = (
            (
                episode.evidence_ids,
                episode.start_time,
                episode.end_time,
                episode.peak_time,
                _risk_label(episode.risk),
            )
            for episode in context.episodes
        )
    else:
        start_time = context.samples[0].time if context.samples else 0.0
        end_time = context.samples[-1].time if context.samples else 0.0
        windows = [(["ev-0001", "ev-0002", "ev-0003"], start_time, end_time,
                    start_time, "基线")]

    evidence: List[EvidenceRef] = []
    for evidence_ids, start_time, end_time, peak_time, risk_label in windows:
        if len(evidence_ids) != 3:
            raise ValueError("each episode must contain three modality evidence ids")
        details = [
            ("perception", "real-derived", f"{risk_label}窗感知目标证据"),
            ("telemetry", "estimated", f"{risk_label}窗运动与控制证据"),
            ("trajectory", "demo-visualization", f"{risk_label}窗演示轨迹证据"),
        ]
        for evidence_id, (source, provenance, detail) in zip(evidence_ids, details):
            evidence.append(EvidenceRef(
                id=evidence_id,
                source=source,
                provenance=provenance,
                start_time=start_time,
                end_time=end_time,
                detail=f"{detail}，峰值位于 {peak_time:.2f} 秒。",
            ))
    return evidence


def _evidence_ids_by_source(evidence: List[EvidenceRef], source: str) -> List[str]:
    return [item.id for item in evidence if item.source == source]


def _key_findings(context: DiagnosisContext) -> List[Finding]:
    if not context.episodes:
        return [Finding(
            title="未检出持续风险事件",
            summary="在当前阈值与可用模态下，未检出超过最短持续时间的风险窗。",
            severity="info",
            evidence_ids=["ev-0001"],
        )]
    return [Finding(
        title=f"{_risk_label(episode.risk)}风险事件",
        summary=episode.summary,
        severity=episode.risk,
        evidence_ids=episode.evidence_ids,
    ) for episode in context.episodes]


def _recommendations(
    context: DiagnosisContext, evidence_ids: List[str]
) -> List[Recommendation]:
    recommendations: List[Recommendation] = []
    if any(episode.control_conflict for episode in context.episodes):
        recommendations.append(Recommendation(
            priority="high",
            action="在制动请求生效时增加油门抑制与控制意图互斥检查。",
            rationale="当前时间窗出现了制动与油门重叠的可观测事实。",
            evidence_ids=evidence_ids,
        ))
    if any(episode.risk == "high" for episode in context.episodes):
        recommendations.append(Recommendation(
            priority="high",
            action="扩充高风险目标时间窗的减速与避让回归用例。",
            rationale="高风险目标在连续帧中持续存在，需验证决策的时序稳定性。",
            evidence_ids=evidence_ids,
        ))
    if not recommendations:
        recommendations.append(Recommendation(
            priority="medium",
            action="保留当前场景作为无持续风险的基线回归用例。",
            rationale="基线场景可用于监测规则阈值调整后的误报。",
            evidence_ids=evidence_ids,
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


def _referenced_evidence_ids(report: DiagnosisReport) -> List[str]:
    references: List[str] = []
    for episode in report.timeline:
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
    serialized = report.model_dump_json()
    if RAW_SCENE_ID.search(serialized):
        raise ValueError("diagnosis reports must not expose raw scene ids")

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
            raise ValueError(f"{source} analysis must reference evidence")
        for evidence_id in section.evidence_ids:
            item = evidence[evidence_id]
            if item.source != source or item.provenance != provenance:
                raise ValueError(f"{source} analysis references mismatched evidence")

    required_episode_sources = {"perception", "telemetry", "trajectory"}
    for episode in report.timeline:
        sources = {evidence[item].source for item in episode.evidence_ids}
        if sources != required_episode_sources:
            raise ValueError(f"episode {episode.id} has incomplete modality evidence")
    return report


def assemble_report(
    context: DiagnosisContext,
    causal_chains: Optional[List[CausalChain]] = None,
) -> DiagnosisReport:
    evidence_index = _evidence_index(context)
    evidence_ids = [item.id for item in evidence_index]
    perception_evidence_ids = _evidence_ids_by_source(evidence_index, "perception")
    telemetry_evidence_ids = _evidence_ids_by_source(evidence_index, "telemetry")
    trajectory_evidence_ids = _evidence_ids_by_source(evidence_index, "trajectory")
    description = RAW_SCENE_ID.sub("内部场景", context.bundle.description)
    high_count = sum(episode.risk == "high" for episode in context.episodes)
    summary = (
        f"本地确定性分析检出 {len(context.episodes)} 个持续风险事件，"
        f"其中 {high_count} 个为高风险；综合风险分为 {context.scores.overall}。"
    )
    report = DiagnosisReport(
        scene_name=context.bundle.scene_name,
        data_version=context.data_version,
        generation_mode="local-harness",
        executive_summary=summary,
        scene_overview={
            "description": description,
            "duration_seconds": context.features.duration,
            "telemetry_samples": len(context.bundle.telemetry),
            "perception_samples": len(context.bundle.perception),
            "lidar_available": bool(context.bundle.lidar_index),
        },
        data_quality=context.validation.findings,
        scores=context.scores,
        key_findings=_key_findings(context),
        timeline=context.episodes,
        perception_analysis=AnalysisSection(
            summary=(
                f"单帧最多 {context.features.object_peak} 个目标，"
                f"高风险目标峰值 {context.features.high_risk_object_peak} 个。"
            ),
            metrics={
                "object_peak": context.features.object_peak,
                "high_risk_object_peak": context.features.high_risk_object_peak,
                "tracking_continuity": context.features.tracking_continuity,
            },
            evidence_ids=perception_evidence_ids,
        ),
        motion_control_analysis=AnalysisSection(
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
            evidence_ids=telemetry_evidence_ids,
        ),
        trajectory_analysis=AnalysisSection(
            summary=(
                f"演示计划路径的峰值横向偏移为 "
                f"{context.features.trajectory_deviation:.2f} 米。"
            ),
            metrics={"demo_path_lateral_deviation": context.features.trajectory_deviation},
            evidence_ids=trajectory_evidence_ids,
        ),
        causal_chains=causal_chains if causal_chains is not None else build_causal_chains(context),
        recommendations=_recommendations(context, evidence_ids),
        regression_tests=_regression_tests(context),
        evidence_index=evidence_index,
        limitations=STANDARD_LIMITATIONS,
    )
    return validate_report_contract(report)
