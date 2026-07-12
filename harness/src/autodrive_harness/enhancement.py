from __future__ import annotations

from typing import Any, Dict, List, Literal, Protocol

from pydantic import Field, model_validator

from .models import DiagnosisReport, StrictModel
from .reporting import validate_report_contract


class EnhancementPlan(StrictModel):
    style: Literal["expert", "concise"]
    emphasized_finding_ids: List[str] = Field(default_factory=list)
    emphasized_recommendation_ids: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def ids_are_unique(self) -> "EnhancementPlan":
        if len(self.emphasized_finding_ids) != len(set(self.emphasized_finding_ids)):
            raise ValueError("emphasized finding ids must be unique")
        if len(self.emphasized_recommendation_ids) != len(
            set(self.emphasized_recommendation_ids)
        ):
            raise ValueError("emphasized recommendation ids must be unique")
        return self


class ReportEnhancer(Protocol):
    def plan(self, local_report: Dict[str, Any]) -> Any:
        ...


def _prioritize(items: List, emphasized_ids: List[str]) -> List:
    rank = {item_id: index for index, item_id in enumerate(emphasized_ids)}
    original = {item.id: index for index, item in enumerate(items)}
    return sorted(
        items,
        key=lambda item: (
            0 if item.id in rank else 1,
            rank.get(item.id, original[item.id]),
            original[item.id],
        ),
    )


def enhance_report(local: DiagnosisReport, enhancer: ReportEnhancer) -> DiagnosisReport:
    try:
        validate_report_contract(local)
        plan = EnhancementPlan.model_validate(
            enhancer.plan(local.model_dump(mode="json"))
        )
        finding_ids = {item.id for item in local.key_findings}
        recommendation_ids = {item.id for item in local.recommendations}
        if not set(plan.emphasized_finding_ids) <= finding_ids:
            raise ValueError("enhancement plan references an unknown finding id")
        if not set(plan.emphasized_recommendation_ids) <= recommendation_ids:
            raise ValueError("enhancement plan references an unknown recommendation id")

        prefix = {"expert": "专家视图：", "concise": "简明视图："}[plan.style]
        payload = local.model_dump(mode="json")
        payload["generation_mode"] = "model-enhanced"
        payload["executive_summary"] = prefix + local.executive_summary
        payload["key_findings"] = [
            item.model_dump(mode="json")
            for item in _prioritize(local.key_findings, plan.emphasized_finding_ids)
        ]
        payload["recommendations"] = [
            item.model_dump(mode="json")
            for item in _prioritize(
                local.recommendations, plan.emphasized_recommendation_ids
            )
        ]
        enhanced = DiagnosisReport.model_validate(payload)
        return validate_report_contract(enhanced)
    except Exception:
        return local
