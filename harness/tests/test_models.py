import pytest
from pydantic import ValidationError

from autodrive_harness.models import DiagnosisReport


def minimal_report_payload():
    return {
        "scene_name": "城市路口侧向超车",
        "data_version": "test-v1",
        "generation_mode": "local-harness",
        "executive_summary": "场景数据可用，完成本地确定性分析。",
        "scene_overview": {"duration_seconds": 1.0},
        "data_quality": [],
        "scores": {
            "perception": 20, "motion": 10, "control": 5, "trajectory": 10,
            "data_quality": 100, "overall": 13, "confidence": 1.0,
        },
        "key_findings": [],
        "timeline": [],
        "historical_risk_events": [],
        "perception_analysis": {"summary": "未发现显著异常。", "evidence_ids": []},
        "motion_control_analysis": {"summary": "未发现显著异常。", "evidence_ids": []},
        "trajectory_analysis": {"summary": "未发现显著异常。", "evidence_ids": []},
        "causal_chains": [],
        "recommendations": [],
        "regression_tests": [],
        "evidence_index": [],
        "limitations": ["本报告不代替道路安全认证。"],
    }


def test_report_forbids_unknown_fields_and_raw_scene_ids():
    report = DiagnosisReport.model_validate(minimal_report_payload())
    assert report.scene_name == "城市路口侧向超车"
    assert "scene-" not in report.model_dump_json()
    with pytest.raises(ValidationError):
        DiagnosisReport.model_validate({**minimal_report_payload(), "extra": True})


def test_report_rejects_raw_scene_id_nested_in_unstructured_content():
    payload = minimal_report_payload()
    payload["scene_overview"] = {"source": "scene-0796"}
    with pytest.raises(ValidationError):
        DiagnosisReport.model_validate(payload)


def test_report_enforces_score_bounds():
    payload = minimal_report_payload()
    payload["scores"] = {**payload["scores"], "overall": 101}
    with pytest.raises(ValidationError):
        DiagnosisReport.model_validate(payload)


def test_report_requires_distinct_historical_risk_events_field():
    payload = minimal_report_payload()
    payload.pop("historical_risk_events")
    with pytest.raises(ValidationError):
        DiagnosisReport.model_validate(payload)
