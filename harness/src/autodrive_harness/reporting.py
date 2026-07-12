from __future__ import annotations

import hashlib
import json
from typing import List

from .causality import build_causal_chains
from .models import (
    AnalysisSection,
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


def protected_fingerprint(report: DiagnosisReport) -> str:
    protected = {
        "scores": report.scores.model_dump(mode="json"),
        "timeline": [episode.model_dump(mode="json") for episode in report.timeline],
        "evidence_index": [item.model_dump(mode="json") for item in report.evidence_index],
        "limitations": report.limitations,
    }
    encoded = json.dumps(
        protected, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _evidence_index(context: DiagnosisContext) -> List[EvidenceRef]:
    if not context.episodes:
        start_time = context.samples[0].time if context.samples else 0.0
        end_time = context.samples[-1].time if context.samples else 0.0
        return [EvidenceRef(
            id="ev-0001",
            source="telemetry",
            provenance="estimated",
            start_time=start_time,
            end_time=end_time,
            detail="可用时间范围内未形成持续风险事件。",
        )]
    evidence: List[EvidenceRef] = []
    for episode in context.episodes:
        evidence.append(EvidenceRef(
            id=episode.evidence_ids[0],
            source="telemetry" if episode.control_conflict else "perception",
            provenance="estimated" if episode.control_conflict else "real-derived",
            start_time=episode.start_time,
            end_time=episode.end_time,
            detail=(
                f"{_risk_label(episode.risk)}风险时间窗，峰值位于 "
                f"{episode.peak_time:.2f} 秒。"
            ),
        ))
    return evidence


def _evidence_ids(context: DiagnosisContext) -> List[str]:
    return [item.id for item in _evidence_index(context)]


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


def _recommendations(context: DiagnosisContext) -> List[Recommendation]:
    evidence_ids = _evidence_ids(context)
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


def assemble_report(context: DiagnosisContext) -> DiagnosisReport:
    evidence_ids = _evidence_ids(context)
    description = RAW_SCENE_ID.sub("内部场景", context.bundle.description)
    high_count = sum(episode.risk == "high" for episode in context.episodes)
    summary = (
        f"本地确定性分析检出 {len(context.episodes)} 个持续风险事件，"
        f"其中 {high_count} 个为高风险；综合风险分为 {context.scores.overall}。"
    )
    return DiagnosisReport(
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
            evidence_ids=evidence_ids,
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
            evidence_ids=evidence_ids,
        ),
        trajectory_analysis=AnalysisSection(
            summary=(
                f"演示计划路径的峰值横向偏移为 "
                f"{context.features.trajectory_deviation:.2f} 米。"
            ),
            metrics={"demo_path_lateral_deviation": context.features.trajectory_deviation},
            evidence_ids=evidence_ids,
        ),
        causal_chains=build_causal_chains(context),
        recommendations=_recommendations(context),
        regression_tests=_regression_tests(context),
        evidence_index=_evidence_index(context),
        limitations=STANDARD_LIMITATIONS,
    )
