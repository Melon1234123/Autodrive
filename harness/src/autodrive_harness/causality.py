from __future__ import annotations

from typing import Dict, List, Optional

from .models import CausalChain, DiagnosisContext, EvidenceRef


def _time(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _risk_label(value: str) -> str:
    return {"high": "高", "medium": "中"}[value]


def build_causal_chains(
    context: DiagnosisContext,
    evidence_index: Optional[List[EvidenceRef]] = None,
) -> List[CausalChain]:
    evidence: Dict[str, EvidenceRef] = {
        item.id: item for item in (evidence_index or [])
    }

    if not context.validation.usable:
        available_ids = [
            item.id for item in (evidence_index or [])
            if item.source in {"perception", "telemetry"}
        ][:1]
        return [CausalChain(
            id="causal-0001",
            observation="跨模态事件挖掘与因果链不可评估。",
            mechanism="未执行：跨模态数据不满足时间对齐条件。",
            possible_impact="恢复缺失数据并重新运行后，才能评估事件与因果关系。",
            evidence_ids=available_ids,
            confidence=context.scores.confidence,
        )]

    def source_ids(episode_ids: List[str], source: str) -> List[str]:
        if evidence:
            return [item for item in episode_ids if evidence[item].source == source]
        if len(episode_ids) == 3:
            legacy_index = {"perception": 0, "telemetry": 1, "trajectory": 2}[source]
            return [episode_ids[legacy_index]]
        return []

    chains: List[CausalChain] = []
    for episode in context.episodes:
        telemetry_ids = source_ids(episode.evidence_ids, "telemetry")
        perception_ids = source_ids(episode.evidence_ids, "perception")
        if episode.control_conflict and telemetry_ids:
            chains.append(CausalChain(
                id=f"causal-{len(chains) + 1:04d}",
                observation=f"在 {_time(episode.peak_time)} 秒检测到制动与油门输入重叠。",
                mechanism="推断：控制意图冲突会压缩纵向安全裕度。",
                possible_impact="可能导致减速响应不一致。",
                evidence_ids=telemetry_ids,
                confidence=context.scores.confidence,
            ))
        has_risk_object = any(
            item.risk in {"medium", "high"}
            for sample in context.samples
            if episode.start_time <= sample.time <= episode.end_time
            for item in sample.perception.value.objects
        )
        if has_risk_object and perception_ids:
            chains.append(CausalChain(
                id=f"causal-{len(chains) + 1:04d}",
                observation=(
                    f"在 {_time(episode.peak_time)} 秒记录到持续"
                    f"{_risk_label(episode.risk)}风险目标。"
                ),
                mechanism="推断：风险目标持续存在会降低可用反应时间。",
                possible_impact="可能增加轨迹规划与制动决策压力。",
                evidence_ids=perception_ids,
                confidence=context.scores.confidence,
            ))
    if chains:
        return chains
    baseline_ids = []
    if evidence_index:
        baseline_ids = [
            item.id for item in evidence_index
            if item.source in {"perception", "telemetry"}
        ][:1]
    elif evidence_index is None and not context.episodes:
        baseline_ids = ["ev-0001"]
    return [CausalChain(
        id="causal-0001",
        observation="在可用时间范围内未形成持续风险事件。",
        mechanism="推断：当前规则阈值下没有足够证据支持具体因果机制。",
        possible_impact="可能存在未被现有传感模态覆盖的低强度风险。",
        evidence_ids=baseline_ids,
        confidence=context.scores.confidence,
    )]
