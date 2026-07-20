from __future__ import annotations

import re
from typing import (
    TYPE_CHECKING,
    Any,
    Dict,
    List,
    Literal,
    Optional,
    Protocol,
    Set,
    Union,
)

from pydantic import Field, ValidationError, model_validator

from .fact_bundle import (
    FactBundle,
    _contains_unsafe_display_value,
    protected_facts_fingerprint,
)
from .models import (
    CausalChain,
    EvidenceRef,
    Finding,
    Recommendation,
    RiskScores,
    StrictModel,
)

if TYPE_CHECKING:
    from .report_v2 import ReportV2


class FindingExplanation(StrictModel):
    finding_id: str = Field(pattern=r"^finding-\d{4}$")
    interpretation: str = Field(min_length=1, max_length=600)
    evidence_ids: List[str] = Field(default_factory=list)


class CausalExplanation(StrictModel):
    causal_chain_id: str = Field(pattern=r"^causal-\d{4}$")
    explanation: str = Field(min_length=1, max_length=600)
    evidence_ids: List[str] = Field(default_factory=list)


class RecommendationRationale(StrictModel):
    recommendation_id: str = Field(pattern=r"^recommendation-\d{4}$")
    rationale: str = Field(min_length=1, max_length=600)
    evidence_ids: List[str] = Field(default_factory=list)


class AnalysisNote(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=600)
    evidence_ids: List[str] = Field(default_factory=list)


class ModelNarrative(StrictModel):
    executive_summary: str = Field(min_length=1, max_length=800)
    finding_explanations: List[FindingExplanation] = Field(default_factory=list)
    causal_explanations: List[CausalExplanation] = Field(default_factory=list)
    recommendation_rationales: List[RecommendationRationale] = Field(
        default_factory=list
    )
    analysis_notes: List[AnalysisNote] = Field(default_factory=list)


class NarrativePromptProjection(StrictModel):
    """The only deterministic display facts a composer may inspect."""

    fact_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    scene_name: str
    scores: RiskScores
    priority_findings: List[Finding]
    causal_chains: List[CausalChain]
    recommendations: List[Recommendation]
    evidence_index: List[EvidenceRef]
    limitations: List[str]

    @model_validator(mode="after")
    def values_are_display_safe(self) -> "NarrativePromptProjection":
        if _contains_unsafe_display_value(self.model_dump(mode="json")):
            raise ValueError(
                "narrative projections must not expose raw scene ids or filesystem paths"
            )
        return self


NarrativePayload = Union[ModelNarrative, Dict[str, Any]]


class NarrativeComposer(Protocol):
    def compose(self, projection: NarrativePromptProjection) -> NarrativePayload:
        ...


class NarrativeCompositionCancelled(Exception):
    """Signals cancellation that must escape narrative fallback handling."""


class NarrativeFailure(Exception):
    """A normalized, non-sensitive failure returned by a narrative provider."""

    _REASONS = {"timeout", "unavailable", "invalid_response"}

    def __init__(
        self,
        reason: Literal["timeout", "unavailable", "invalid_response"],
    ) -> None:
        if reason not in self._REASONS:
            raise ValueError("unsupported narrative failure reason")
        self.reason = reason
        super().__init__(reason)


def build_narrative_projection(facts: FactBundle) -> NarrativePromptProjection:
    """Copy only safe, display-oriented facts into the model input boundary."""

    return NarrativePromptProjection(
        fact_fingerprint=protected_facts_fingerprint(facts),
        scene_name=facts.scene_name,
        scores=facts.scores.model_copy(deep=True),
        priority_findings=[
            item.model_copy(deep=True) for item in facts.priority_findings
        ],
        causal_chains=[
            item.model_copy(deep=True) for item in facts.causal_chains
        ],
        recommendations=[
            item.model_copy(deep=True) for item in facts.recommendations
        ],
        evidence_index=[
            item.model_copy(deep=True) for item in facts.evidence_index
        ],
        limitations=list(facts.limitations),
    )


_NUMERIC_ATOM = r"(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?"
_NUMERIC_ATOM_PATTERN = re.compile(rf"[-+]?{_NUMERIC_ATOM}")
_NUMERIC_START = re.compile(rf"(?<!\d)[-+]?{_NUMERIC_ATOM}")
_NUMERIC_CHAIN_SEPARATORS = (
    ",", "，", ":", "：", "/", "／", "~", "～", "–", "—", "-", "至", "到", "to",
)
_NUMERIC_TEMPORAL_UNITS = ("毫秒", "分钟", "小时", "秒", "分", "时")
_NUMERIC_COMMON_UNITS = (
    "公里/小时", "千米/小时", "km/h", "kmph", "米/秒", "m/s", "mph",
    "公里", "千米", "毫米", "厘米", "分钟", "小时", "毫秒",
    "km", "cm", "mm", "ms", "米", "秒", "分", "时", "m", "s", "%", "％",
)
_OPAQUE_IDENTIFIER = re.compile(
    r"(?<![A-Za-z0-9_-])(?:ev|finding|causal|recommendation|ep)-\d{4}"
    r"(?![A-Za-z0-9_-])",
    re.IGNORECASE,
)
_IDENTIFIER_KEYS = {
    "id",
    "evidence_ids",
    "finding_id",
    "causal_chain_id",
    "recommendation_id",
    "fact_fingerprint",
}


def _skip_whitespace(value: str, index: int) -> int:
    while index < len(value) and value[index].isspace():
        index += 1
    return index


def _match_chain_separator(value: str, index: int) -> Optional[int]:
    index = _skip_whitespace(value, index)
    for separator in _NUMERIC_CHAIN_SEPARATORS:
        if separator == "to":
            if value[index:index + len(separator)].lower() != separator:
                continue
        elif not value.startswith(separator, index):
            continue
        end = index + len(separator)
        if (
            separator == "to"
            and end < len(value)
            and value[end].isascii()
            and (value[end].isalnum() or value[end] == "_")
        ):
            continue
        return end
    return None


def _match_temporal_unit(value: str, index: int) -> Optional[int]:
    index = _skip_whitespace(value, index)
    for unit in _NUMERIC_TEMPORAL_UNITS:
        if value.startswith(unit, index):
            return index + len(unit)
    return None


def _match_common_unit(value: str, index: int) -> Optional[int]:
    index = _skip_whitespace(value, index)
    lower_value = value.lower()
    for unit in _NUMERIC_COMMON_UNITS:
        if not lower_value.startswith(unit.lower(), index):
            continue
        end = index + len(unit)
        if (
            unit.isascii()
            and any(character.isalpha() for character in unit)
            and end < len(value)
            and value[end].isascii()
            and (value[end].isalnum() or value[end] == "_")
        ):
            continue
        return end
    return None


def _match_numeric_atom(value: str, index: int, skip_whitespace: bool = True):
    if skip_whitespace:
        index = _skip_whitespace(value, index)
    return _NUMERIC_ATOM_PATTERN.match(value, index)


def _match_unit_aware_range(value: str, end: int) -> Optional[int]:
    left_unit_end = _match_common_unit(value, end)
    separator_end = _match_chain_separator(
        value,
        left_unit_end if left_unit_end is not None else end,
    )
    if separator_end is None:
        return None
    right_unit_end = _match_common_unit(value, separator_end)
    next_atom = _match_numeric_atom(
        value,
        right_unit_end if right_unit_end is not None else separator_end,
    )
    if next_atom is None:
        return None
    trailing_unit_end = _match_common_unit(value, next_atom.end())
    return trailing_unit_end if trailing_unit_end is not None else next_atom.end()


def _extend_numeric_literal(value: str, end: int) -> int:
    chain_seen = False
    while True:
        range_end = _match_unit_aware_range(value, end)
        if range_end is not None:
            end = range_end
            chain_seen = True
            continue

        temporal_end = _match_temporal_unit(value, end)
        if temporal_end is not None:
            separator_end = _match_chain_separator(value, temporal_end)
            next_atom = _match_numeric_atom(
                value,
                separator_end if separator_end is not None else temporal_end,
            )
            if next_atom is not None:
                end = next_atom.end()
                chain_seen = True
                continue

        dot_end = end
        while dot_end < len(value) and value[dot_end] == ".":
            dot_end += 1
        if dot_end > end:
            next_atom = _match_numeric_atom(value, dot_end, skip_whitespace=False)
            if next_atom is not None:
                end = next_atom.end()
                chain_seen = True
                continue
        break

    if chain_seen:
        unit_end = _match_common_unit(value, end)
        if unit_end is not None:
            return unit_end
    return end


def _numeric_literals_in(value: str) -> Set[str]:
    prose_without_ids = _OPAQUE_IDENTIFIER.sub("", value)
    literals = set()
    consumed_until = 0
    for match in _NUMERIC_START.finditer(prose_without_ids):
        if match.start() < consumed_until:
            continue
        end = _extend_numeric_literal(prose_without_ids, match.end())
        literals.add(prose_without_ids[match.start():end])
        consumed_until = end
    return literals


def _approved_numeric_literals(value: Any, key: Optional[str] = None) -> Set[str]:
    if key in _IDENTIFIER_KEYS:
        return set()
    if isinstance(value, bool) or value is None:
        return set()
    if isinstance(value, (int, float)):
        return _numeric_literals_in(str(value))
    if isinstance(value, str):
        return _numeric_literals_in(value)
    if isinstance(value, list):
        allowed: Set[str] = set()
        for item in value:
            allowed.update(_approved_numeric_literals(item))
        return allowed
    if isinstance(value, dict):
        allowed = set()
        for item_key, item in value.items():
            allowed.update(_approved_numeric_literals(item, item_key))
        return allowed
    return set()


def _model_prose(narrative: ModelNarrative) -> List[str]:
    prose = [narrative.executive_summary]
    prose.extend(item.interpretation for item in narrative.finding_explanations)
    prose.extend(item.explanation for item in narrative.causal_explanations)
    prose.extend(item.rationale for item in narrative.recommendation_rationales)
    for item in narrative.analysis_notes:
        prose.extend((item.title, item.body))
    return prose


def _assert_nonempty_prose(narrative: ModelNarrative) -> None:
    if any(not value.strip() for value in _model_prose(narrative)):
        raise ValueError("narrative prose must not be empty")


def _assert_known_evidence(
    evidence_ids: List[str],
    allowed_evidence: Set[str],
) -> None:
    if len(evidence_ids) != len(set(evidence_ids)):
        raise ValueError("narrative evidence ids must be unique")
    unknown = set(evidence_ids) - allowed_evidence
    if unknown:
        raise ValueError(f"narrative references unknown evidence: {sorted(unknown)}")


def _assert_unique_known_targets(
    targets: List[str],
    allowed_targets: Set[str],
    label: str,
) -> None:
    if len(targets) != len(set(targets)):
        raise ValueError(f"duplicate {label} targets")
    unknown = set(targets) - allowed_targets
    if unknown:
        raise ValueError(f"narrative references unknown {label}: {sorted(unknown)}")


def _assert_references_exist(
    narrative: ModelNarrative,
    allowed_evidence: Set[str],
    allowed_findings: Set[str],
    allowed_chains: Set[str],
    allowed_recommendations: Set[str],
) -> None:
    _assert_unique_known_targets(
        [item.finding_id for item in narrative.finding_explanations],
        allowed_findings,
        "finding",
    )
    _assert_unique_known_targets(
        [item.causal_chain_id for item in narrative.causal_explanations],
        allowed_chains,
        "causal chain",
    )
    _assert_unique_known_targets(
        [item.recommendation_id for item in narrative.recommendation_rationales],
        allowed_recommendations,
        "recommendation",
    )
    evidence_references = (
        list(narrative.finding_explanations)
        + list(narrative.causal_explanations)
        + list(narrative.recommendation_rationales)
        + list(narrative.analysis_notes)
    )
    for item in evidence_references:
        _assert_known_evidence(item.evidence_ids, allowed_evidence)


def _assert_no_novel_numeric_literals(
    facts: FactBundle,
    narrative: ModelNarrative,
) -> None:
    projection_payload = build_narrative_projection(facts).model_dump(mode="json")
    allowed = _approved_numeric_literals(projection_payload)
    used = set()
    for prose in _model_prose(narrative):
        used.update(_numeric_literals_in(prose))
    novel = used - allowed
    if novel:
        raise ValueError(f"narrative contains ungrounded numeric text: {sorted(novel)}")


def validate_narrative(facts: FactBundle, narrative: ModelNarrative) -> None:
    """Reject prose that reaches beyond the supplied immutable facts."""

    if _contains_unsafe_display_value(narrative.model_dump(mode="json")):
        raise ValueError(
            "narratives must not expose unsafe display values"
        )
    _assert_nonempty_prose(narrative)
    _assert_references_exist(
        narrative,
        {item.id for item in facts.evidence_index},
        {item.id for item in facts.priority_findings},
        {item.id for item in facts.causal_chains},
        {item.id for item in facts.recommendations},
    )
    _assert_no_novel_numeric_literals(facts, narrative)


def _local_report(
    facts: FactBundle,
    model_name: Optional[str],
    reason: Literal["timeout", "unavailable", "invalid_response", "disabled"],
) -> "ReportV2":
    from .report_v2 import GenerationMetadata, assemble_report_v2

    return assemble_report_v2(
        facts,
        narrative=None,
        generation=GenerationMetadata.local(model_name, reason),
    )


def compose_report(
    facts: FactBundle,
    composer: Optional[NarrativeComposer],
    model_name: Optional[str],
) -> "ReportV2":
    """Compose a fact-preserving report or return an honest local fallback."""

    facts_snapshot = facts.model_copy(deep=True)
    fingerprint_before = protected_facts_fingerprint(facts)
    if composer is None:
        return _local_report(facts_snapshot, model_name, "disabled")
    try:
        payload = composer.compose(build_narrative_projection(facts_snapshot))
        narrative = ModelNarrative.model_validate(payload)
        validate_narrative(facts_snapshot, narrative)
        if protected_facts_fingerprint(facts) != fingerprint_before:
            raise ValueError("fact bundle changed during narrative composition")
    except NarrativeCompositionCancelled:
        raise
    except NarrativeFailure as failure:
        return _local_report(facts_snapshot, model_name, failure.reason)
    except (ValidationError, ValueError):
        return _local_report(facts_snapshot, model_name, "invalid_response")
    except Exception:
        return _local_report(facts_snapshot, model_name, "unavailable")

    from .report_v2 import GenerationMetadata, assemble_report_v2

    return assemble_report_v2(
        facts_snapshot,
        narrative=narrative,
        generation=GenerationMetadata(
            mode="model-grounded",
            model=model_name,
            attempted=True,
        ),
    )
