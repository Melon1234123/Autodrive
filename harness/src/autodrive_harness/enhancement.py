from __future__ import annotations

from typing import Any, Dict, Protocol

from .models import DiagnosisReport
from .reporting import protected_fingerprint, validate_report_contract


class ReportEnhancer(Protocol):
    def enhance(self, local_report: Dict[str, Any]) -> Any:
        ...


def enhance_report(local: DiagnosisReport, enhancer: ReportEnhancer) -> DiagnosisReport:
    before = protected_fingerprint(local)
    try:
        payload = enhancer.enhance(local.model_dump(mode="json"))
        candidate = DiagnosisReport.model_validate(payload)
        validate_report_contract(candidate)
    except Exception:
        return local
    if protected_fingerprint(candidate) != before:
        return local
    try:
        enhanced = DiagnosisReport.model_validate({
            **candidate.model_dump(mode="json"),
            "generation_mode": "model-enhanced",
        })
        return validate_report_contract(enhanced)
    except Exception:
        return local
