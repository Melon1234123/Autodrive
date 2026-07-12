from autodrive_harness.enhancement import enhance_report
from autodrive_harness.reporting import assemble_report

from test_causality import high_risk_context


class FakeEnhancer:
    def __init__(self, payload):
        self.payload = payload

    def enhance(self, _local_payload):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


def local_report():
    return assemble_report(high_risk_context())


def test_enhancer_rejects_protected_field_changes():
    local = local_report()
    malicious = local.model_copy(update={
        "scores": local.scores.model_copy(update={"overall": 0})
    })
    assert enhance_report(local, FakeEnhancer(malicious.model_dump(mode="json"))) == local


def test_enhancer_accepts_narrative_only_changes_and_marks_mode():
    local = local_report()
    candidate = local.model_copy(update={"executive_summary": "经模型改写的摘要。"})
    enhanced = enhance_report(local, FakeEnhancer(candidate.model_dump(mode="json")))
    assert enhanced.executive_summary == "经模型改写的摘要。"
    assert enhanced.generation_mode == "model-enhanced"
    assert enhanced.scores == local.scores


def test_enhancer_fails_closed_on_exception_or_raw_scene_id():
    local = local_report()
    assert enhance_report(local, FakeEnhancer(RuntimeError("offline"))) == local
    candidate = local.model_copy(update={"executive_summary": "raw scene-0796"})
    assert enhance_report(local, FakeEnhancer(candidate.model_dump(mode="json"))) == local
