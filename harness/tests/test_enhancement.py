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


def test_enhancer_rejects_scene_name_data_quality_metrics_and_causal_fact_changes():
    local = local_report()
    payload = local.model_dump(mode="json")
    payload["scene_name"] = "雨夜行人横穿"
    payload["data_quality"] = [{
        "code": "fabricated", "severity": "info", "affected_modules": ["perception"],
        "message": "fabricated",
    }]
    payload["perception_analysis"]["metrics"]["object_peak"] = 999
    payload["causal_chains"][0]["confidence"] = 0.01
    assert enhance_report(local, FakeEnhancer(payload)) == local


def test_enhancer_rejects_dangling_evidence_reference_outside_fingerprint():
    local = local_report()
    payload = local.model_dump(mode="json")
    payload["recommendations"][0]["evidence_ids"] = ["ev-9999"]
    assert enhance_report(local, FakeEnhancer(payload)) == local


def test_enhancer_rejects_provenance_and_all_evidence_id_mutations():
    local = local_report()
    payload = local.model_dump(mode="json")
    payload["evidence_index"][0]["provenance"] = "estimated"
    payload["timeline"][0]["evidence_ids"] = ["ev-9999"]
    payload["key_findings"][0]["evidence_ids"] = ["ev-9999"]
    payload["perception_analysis"]["evidence_ids"] = ["ev-9999"]
    assert enhance_report(local, FakeEnhancer(payload)) == local


def test_enhancer_fails_closed_when_one_response_tampers_with_all_fact_classes():
    local = local_report()
    payload = local.model_dump(mode="json")
    payload["scene_name"] = "雨夜行人横穿"
    payload["data_quality"] = [{
        "code": "forged", "severity": "warning", "affected_modules": ["telemetry"],
        "message": "forged",
    }]
    payload["scores"]["overall"] = 0
    payload["timeline"][0]["risk"] = "medium"
    payload["timeline"][0]["evidence_ids"] = ["ev-9999"]
    payload["perception_analysis"]["metrics"]["object_peak"] = 999
    payload["motion_control_analysis"]["metrics"]["peak_speed_kmh"] = 0
    payload["trajectory_analysis"]["metrics"]["demo_path_lateral_deviation"] = 0
    payload["causal_chains"][0]["confidence"] = 0
    payload["causal_chains"][0]["evidence_ids"] = ["ev-9999"]
    payload["key_findings"][0]["evidence_ids"] = ["ev-9999"]
    payload["recommendations"][0]["evidence_ids"] = ["ev-9999"]
    payload["evidence_index"][0]["provenance"] = "estimated"
    payload["limitations"] = ["forged"]
    assert enhance_report(local, FakeEnhancer(payload)) == local
