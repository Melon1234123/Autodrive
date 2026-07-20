from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List

from pydantic import model_validator

from .models import (
    CausalChain,
    DataQualityFinding,
    DiagnosisContext,
    EvidenceRef,
    Finding,
    RAW_SCENE_ID,
    Recommendation,
    RegressionRecommendation,
    RiskEpisode,
    RiskScores,
    StrictModel,
)
from .reporting import (
    _data_quality,
    _key_findings,
    _limitations,
    _recommendations,
    _regression_tests,
)


FILESYSTEM_PATH = re.compile(
    r"""
    (?:
        (?<![\w:/\\])
        (?:\\\\|[A-Za-z]:[\\/]|/)
        (?:[^\\/\s,;，。]+[\\/])*
        [^\\/\s,;，。]+
    )
    |
    (?:
        (?<![\w./\\])
        (?:[\w.-]+[\\/])+
        [\w.-]+\.[A-Za-z0-9]{1,16}
    )
    |
    (?:
        (?<![\w./\\])
        (?=[A-Za-z][\w.-]*[\\/])
        (?:[\w.-]+[\\/]){2,}
        [\w.-]+
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

SENSITIVE_CREDENTIAL = re.compile(
    r"""
    (?:
        \b(?:[A-Za-z0-9]+[_-])*
        (?:api[_-]?key|apikey|authorization)
        \s*(?:=|:)\s*(?:bearer\s+)?[^\s,;，。]+
    )
    |
    (?:\bsk-[A-Za-z0-9_-]{12,}\b)
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _sanitize_display_string(value: str) -> str:
    without_credentials = SENSITIVE_CREDENTIAL.sub("[敏感凭据]", value)
    without_scene_ids = RAW_SCENE_ID.sub("内部场景", without_credentials)
    return FILESYSTEM_PATH.sub("[内部资源]", without_scene_ids)


def _sanitize_display_payload(value: Any) -> Any:
    if isinstance(value, str):
        return _sanitize_display_string(value)
    if isinstance(value, list):
        return [_sanitize_display_payload(item) for item in value]
    if isinstance(value, dict):
        return {
            _sanitize_display_string(key) if isinstance(key, str) else key:
            _sanitize_display_payload(item)
            for key, item in value.items()
        }
    return value


def _contains_unsafe_display_value(value: Any) -> bool:
    if isinstance(value, str):
        return bool(
            RAW_SCENE_ID.search(value)
            or FILESYSTEM_PATH.search(value)
            or SENSITIVE_CREDENTIAL.search(value)
        )
    if isinstance(value, list):
        return any(_contains_unsafe_display_value(item) for item in value)
    if isinstance(value, dict):
        return any(
            _contains_unsafe_display_value(key)
            or _contains_unsafe_display_value(item)
            for key, item in value.items()
        )
    return False


class FactBundle(StrictModel):
    scene_name: str
    data_version: str
    scene_overview: Dict[str, Any]
    data_quality: List[DataQualityFinding]
    scores: RiskScores
    priority_findings: List[Finding]
    timeline: List[RiskEpisode]
    causal_chains: List[CausalChain]
    recommendations: List[Recommendation]
    regression_tests: List[RegressionRecommendation]
    evidence_index: List[EvidenceRef]
    limitations: List[str]

    @model_validator(mode="after")
    def display_values_are_safe(self) -> "FactBundle":
        if _contains_unsafe_display_value(self.model_dump(mode="json")):
            raise ValueError(
                "fact bundles must not expose unsafe display values"
            )
        return self


def _filter_evidence_ids(items: List[Any], evidence_ids: set) -> List[Any]:
    return [
        item.model_copy(update={
            "evidence_ids": [
                evidence_id
                for evidence_id in item.evidence_ids
                if evidence_id in evidence_ids
            ],
        })
        for item in items
    ]


def build_fact_bundle(
    context: DiagnosisContext,
    evidence_index: List[EvidenceRef],
    causal_chains: List[CausalChain],
) -> FactBundle:
    ordered_evidence_ids = [item.id for item in evidence_index]
    known_evidence_ids = set(ordered_evidence_ids)
    timeline = _filter_evidence_ids(context.episodes, known_evidence_ids)
    safe_context = context.model_copy(
        deep=True,
        update={"episodes": timeline},
    )
    available_sources = {item.source for item in evidence_index}
    priority_findings = _filter_evidence_ids(
        _key_findings(safe_context, ordered_evidence_ids),
        known_evidence_ids,
    )
    safe_causal_chains = _filter_evidence_ids(
        causal_chains,
        known_evidence_ids,
    )
    recommendations = _filter_evidence_ids(
        _recommendations(safe_context, evidence_index),
        known_evidence_ids,
    )
    payload = {
        "scene_name": context.bundle.scene_name,
        "data_version": context.data_version,
        "scene_overview": {
            "description": context.bundle.description,
            "duration_seconds": context.features.duration,
            "telemetry_samples": len(context.bundle.telemetry),
            "perception_samples": len(context.bundle.perception),
            "lidar_available": bool(context.bundle.lidar_index),
        },
        "data_quality": _data_quality(safe_context, available_sources),
        "scores": context.scores,
        "priority_findings": priority_findings,
        "timeline": timeline,
        "causal_chains": safe_causal_chains,
        "recommendations": recommendations,
        "regression_tests": _regression_tests(safe_context),
        "evidence_index": evidence_index,
        "limitations": _limitations(available_sources),
    }
    serialized_payload = {
        key: (
            value.model_dump(mode="json")
            if isinstance(value, StrictModel)
            else [
                item.model_dump(mode="json")
                if isinstance(item, StrictModel)
                else item
                for item in value
            ]
            if isinstance(value, list)
            else value
        )
        for key, value in payload.items()
    }
    return FactBundle.model_validate(_sanitize_display_payload(serialized_payload))


def protected_facts_fingerprint(facts: FactBundle) -> str:
    payload = facts.model_dump(mode="json")
    encoded = json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
