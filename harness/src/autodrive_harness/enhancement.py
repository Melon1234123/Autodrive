from __future__ import annotations

from typing import Any, Dict, Protocol

from .models import DiagnosisReport
from .reporting import protected_fingerprint


class ReportEnhancer(Protocol):
    def enhance(self, local_report: Dict[str, Any]) -> Any:
        ...


def enhance_report(local: DiagnosisReport, enhancer: ReportEnhancer) -> DiagnosisReport:
    before = protected_fingerprint(local)
    try:
        payload = enhancer.enhance(local.model_dump(mode="json"))
        candidate = DiagnosisReport.model_validate(payload)
    except Exception:
        return local
    if protected_fingerprint(candidate) != before:
        return local
    return candidate.model_copy(update={"generation_mode": "model-enhanced"})
