from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import Field, model_validator

from .fact_bundle import (
    FactBundle,
    _contains_unsafe_display_value,
    protected_facts_fingerprint,
)
from .models import (
    CausalChain,
    DataQualityFinding,
    EvidenceRef,
    Finding,
    Recommendation,
    RegressionRecommendation,
    RiskEpisode,
    RiskScores,
    StrictModel,
)
from .narrative import (
    AnalysisNote,
    CausalExplanation,
    FindingExplanation,
    ModelNarrative,
    RecommendationRationale,
)


MIN_EXECUTIVE_SUMMARY_LENGTH = 200


class GenerationMetadata(StrictModel):
    mode: Literal["model-grounded", "local-harness"]
    model: Optional[str] = None
    attempted: bool
    fallback_reason: Optional[
        Literal["timeout", "unavailable", "invalid_response", "disabled"]
    ] = None

    @classmethod
    def local(
        cls,
        model: Optional[str],
        reason: Literal[
            "timeout", "unavailable", "invalid_response", "disabled"
        ],
    ) -> "GenerationMetadata":
        return cls(
            mode="local-harness",
            model=model,
            attempted=reason != "disabled",
            fallback_reason=reason,
        )


class ReportMeta(StrictModel):
    schema_version: Literal["2.0"] = "2.0"
    scene_name: str
    data_version: str
    protected_facts_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    generation: GenerationMetadata


class AnalysisWorkspace(StrictModel):
    executive_summary: str = Field(min_length=MIN_EXECUTIVE_SUMMARY_LENGTH)
    risk_profile: RiskScores
    priority_findings: List[Finding]
    finding_explanations: List[FindingExplanation]
    causal_chains: List[CausalChain]
    causal_explanations: List[CausalExplanation]
    recommendations: List[Recommendation]
    recommendation_rationales: List[RecommendationRationale]
    analysis_notes: List[AnalysisNote]


class EvidenceWorkspace(StrictModel):
    timeline: List[RiskEpisode]
    index: List[EvidenceRef]
    default_evidence_id: Optional[str] = None


class SupportWorkspace(StrictModel):
    scene_overview: Dict[str, Any]
    data_quality: List[DataQualityFinding]
    regression_tests: List[RegressionRecommendation]
    limitations: List[str]


class ReportV2(StrictModel):
    meta: ReportMeta
    analysis: AnalysisWorkspace
    evidence: EvidenceWorkspace
    support: SupportWorkspace

    @model_validator(mode="after")
    def validates_safe_unique_references(self) -> "ReportV2":
        if _contains_unsafe_display_value(self.model_dump(mode="json")):
            raise ValueError(
                "reports must not expose unsafe display values"
            )

        evidence_ids = [item.id for item in self.evidence.index]
        finding_ids = [item.id for item in self.analysis.priority_findings]
        causal_ids = [item.id for item in self.analysis.causal_chains]
        recommendation_ids = [
            item.id for item in self.analysis.recommendations
        ]
        for label, identifiers in (
            ("evidence", evidence_ids),
            ("finding", finding_ids),
            ("causal chain", causal_ids),
            ("recommendation", recommendation_ids),
        ):
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"{label} ids must be unique")

        known_evidence_ids = set(evidence_ids)
        referenced_evidence_ids = set()
        for item in (
            list(self.evidence.timeline)
            + list(self.analysis.priority_findings)
            + list(self.analysis.causal_chains)
            + list(self.analysis.recommendations)
            + list(self.analysis.finding_explanations)
            + list(self.analysis.causal_explanations)
            + list(self.analysis.recommendation_rationales)
            + list(self.analysis.analysis_notes)
        ):
            referenced_evidence_ids.update(item.evidence_ids)
        dangling = referenced_evidence_ids - known_evidence_ids
        if dangling:
            raise ValueError(f"dangling evidence ids: {sorted(dangling)}")
        if (
            self.evidence.default_evidence_id is not None
            and self.evidence.default_evidence_id not in known_evidence_ids
        ):
            raise ValueError("default evidence id must reference the evidence index")

        explanation_finding_ids = [
            item.finding_id for item in self.analysis.finding_explanations
        ]
        explanation_causal_ids = [
            item.causal_chain_id for item in self.analysis.causal_explanations
        ]
        rationale_recommendation_ids = [
            item.recommendation_id
            for item in self.analysis.recommendation_rationales
        ]
        reference_contracts = (
            (
                "finding explanation",
                explanation_finding_ids,
                set(finding_ids),
            ),
            (
                "causal explanation",
                explanation_causal_ids,
                set(causal_ids),
            ),
            (
                "recommendation rationale",
                rationale_recommendation_ids,
                set(recommendation_ids),
            ),
        )
        for label, identifiers, known_ids in reference_contracts:
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"{label} target ids must be unique")
            unknown = set(identifiers) - known_ids
            if unknown:
                raise ValueError(f"{label} has dangling target ids: {sorted(unknown)}")
        return self


def _segment_risk_statement(facts: FactBundle) -> str:
    if facts.scores.overall is None:
        return (
            "整段路段当前综合风险不可评估，当前事实包和证据索引不足以支撑完整的"
            "运行安全判断；仍可利用已保留的模态事实、证据和数据质量边界开展有条件"
            "复核。"
        )
    if any(item.risk == "high" for item in facts.timeline):
        return (
            "整段路段呈现需要优先收敛的高风险暴露，说明车辆在复杂交通交互中的"
            "运行安全裕度不足，不能将局部动作的暂时稳定视为全程可靠。"
        )
    if facts.timeline:
        return (
            "整段路段存在持续的风险压力，当前运行表现需要通过全程一致的风险识别、"
            "决策约束和控制响应进一步收敛，才能形成稳定的安全预期。"
        )
    return (
        "整段路段暂未形成可验证的持续风险事件，但当前结论只覆盖已被观测和可复核"
        "的运行事实，不能替代对未覆盖工况的安全判断。"
    )


_SEGMENT_SUMMARY_MARKERS = (
    "全程",
    "整段路段",
    "整段运行",
    "整个路段",
    "路段整体",
)
_MAX_MODEL_SEGMENT_SUMMARY_LENGTH = 180


def _compatible_model_segment_summary(
    narrative: Optional[ModelNarrative],
) -> Optional[str]:
    if narrative is None:
        return None
    summary = narrative.executive_summary.strip()
    if (
        len(summary) > _MAX_MODEL_SEGMENT_SUMMARY_LENGTH
        or any(character.isdigit() for character in summary)
        or not any(marker in summary for marker in _SEGMENT_SUMMARY_MARKERS)
    ):
        return None
    return summary


def _segment_execution_direction(facts: FactBundle) -> str:
    direction = (
        "执行上应把感知、轨迹、决策和控制作为连续闭环审视，确认各环节在交通"
        "变化中保持一致、及时且可解释。"
    )
    if any(item.control_conflict for item in facts.timeline):
        direction += (
            "控制层面存在协调压力，应明确制动、驱动与横向控制的优先级，避免局部"
            "策略抵消整体安全意图。"
        )
    return direction


def _executive_summary_context(
    facts: FactBundle,
    narrative: Optional[ModelNarrative],
) -> List[str]:
    context = [_segment_risk_statement(facts)]
    model_summary = _compatible_model_segment_summary(narrative)
    if model_summary is not None:
        context.append(model_summary)
    context.append(_segment_execution_direction(facts))
    if facts.data_quality or facts.limitations:
        context.append(
            "当前判断受数据质量和观测覆盖边界约束。未被充分观测的传感器状态、"
            "道路条件或交通变化不应直接外推，复核时应先确认事实基础仍然适用。"
        )
    context.append(
        "整改与验收应复现整段运行，在相同及相邻交通条件下确认风险收敛和控制"
        "协同，并以证据链和回归验证形成闭环；详细事件、评分和时间信息保留在"
        "分析与证据模块。"
    )
    return context


_EXECUTIVE_SUMMARY_SCOPE = (
    "本结论仅覆盖当前事实包所支持的整段路段运行表现，不替代道路安全认证、"
    "功能准入或对未观测运行条件的外推判断。"
)


def _expand_executive_summary(
    facts: FactBundle,
    narrative: Optional[ModelNarrative],
) -> str:
    sections = _executive_summary_context(facts, narrative)
    while len(" ".join(sections)) < MIN_EXECUTIVE_SUMMARY_LENGTH:
        sections.append(_EXECUTIVE_SUMMARY_SCOPE)
    return " ".join(sections)


def build_analysis_workspace(
    facts: FactBundle,
    narrative: Optional[ModelNarrative],
) -> AnalysisWorkspace:
    return AnalysisWorkspace(
        executive_summary=_expand_executive_summary(facts, narrative),
        risk_profile=facts.scores,
        priority_findings=facts.priority_findings,
        finding_explanations=(
            narrative.finding_explanations if narrative is not None else []
        ),
        causal_chains=facts.causal_chains,
        causal_explanations=(
            narrative.causal_explanations if narrative is not None else []
        ),
        recommendations=facts.recommendations,
        recommendation_rationales=(
            narrative.recommendation_rationales if narrative is not None else []
        ),
        analysis_notes=narrative.analysis_notes if narrative is not None else [],
    )


def assemble_report_v2(
    facts: FactBundle,
    narrative: Optional[ModelNarrative],
    generation: GenerationMetadata,
) -> ReportV2:
    facts_snapshot = facts.model_copy(deep=True)
    narrative_snapshot = (
        narrative.model_copy(deep=True) if narrative is not None else None
    )
    generation_snapshot = generation.model_copy(deep=True)
    return ReportV2(
        meta=ReportMeta(
            schema_version="2.0",
            scene_name=facts_snapshot.scene_name,
            data_version=facts_snapshot.data_version,
            protected_facts_fingerprint=protected_facts_fingerprint(
                facts_snapshot
            ),
            generation=generation_snapshot,
        ),
        analysis=build_analysis_workspace(facts_snapshot, narrative_snapshot),
        evidence=EvidenceWorkspace(
            timeline=facts_snapshot.timeline,
            index=facts_snapshot.evidence_index,
            default_evidence_id=(
                facts_snapshot.evidence_index[0].id
                if facts_snapshot.evidence_index
                else None
            ),
        ),
        support=SupportWorkspace(
            scene_overview=facts_snapshot.scene_overview,
            data_quality=facts_snapshot.data_quality,
            regression_tests=facts_snapshot.regression_tests,
            limitations=facts_snapshot.limitations,
        ),
    )
