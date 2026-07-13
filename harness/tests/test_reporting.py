import pytest

from autodrive_harness.models import DiagnosisContext, DiagnosisReport
from autodrive_harness.reporting import (
    assemble_report,
    protected_fingerprint,
    validate_report_contract,
)

from test_causality import high_risk_context


def control_only_context():
    payload = high_risk_context().model_dump(mode="json")
    payload["bundle"]["perception"][0]["objects"] = []
    payload["bundle"]["perception"][0]["plannedPath"] = []
    payload["samples"][0]["perception"]["value"]["objects"] = []
    payload["samples"][0]["perception"]["value"]["plannedPath"] = []
    payload["features"].update({
        "object_peak": 0,
        "high_risk_object_peak": 0,
        "medium_risk_object_peak": 0,
        "trajectory_deviation": 0,
    })
    payload["episodes"][0].update({
        "risk": "medium",
        "summary": "仅检测到控制冲突。",
        "evidence_ids": [],
    })
    payload["scores"].update({"perception": 0, "trajectory": 0, "overall": 23})
    return DiagnosisContext.model_validate(payload)


def all_source_context():
    payload = high_risk_context().model_dump(mode="json")
    perception = payload["bundle"]["perception"][0]
    perception.update({
        "imageFile": "samples/CAM_FRONT/source.jpg",
        "sampleToken": "sample-token",
        "ego": {"x": 1.0, "y": 2.0, "yaw": 0.1, "latitude": 42.0},
    })
    sample_perception = payload["samples"][0]["perception"]["value"]
    sample_perception.update({
        "imageFile": "samples/CAM_FRONT/source.jpg",
        "sampleToken": "sample-token",
        "ego": {"x": 1.0, "y": 2.0, "yaw": 0.1, "latitude": 42.0},
    })
    lidar = {"time": 12.4, "file": "frames/000001.bin", "pointCount": 42}
    payload["bundle"]["lidar_index"] = [lidar]
    payload["samples"][0]["lidar"] = {
        "value": lidar,
        "provenance": "nearest",
        "source_times": [12.4],
    }
    payload["features"]["provenance"]["ego_pose"] = "real"
    return DiagnosisContext.model_validate(payload)


def test_local_report_is_complete_and_has_no_raw_scene_id():
    report = assemble_report(high_risk_context(
        scene_key="scene-0796", scene_name="城市路口侧向超车"
    ))
    assert report.generation_mode == "local-harness"
    assert report.executive_summary
    assert report.key_findings
    assert report.recommendations
    assert report.regression_tests
    assert report.evidence_index
    assert report.historical_risk_events == report.timeline
    assert "scene-0796" not in report.model_dump_json()
    assert {item.id for item in report.evidence_index} >= set(report.timeline[0].evidence_ids)


def test_analysis_sections_reference_only_matching_evidence_provenance():
    report = assemble_report(all_source_context())
    evidence = {item.id: item for item in report.evidence_index}
    expected = [
        (report.perception_analysis, "perception", "real-derived"),
        (report.motion_control_analysis, "telemetry", "estimated"),
        (report.trajectory_analysis, "trajectory", "demo-visualization"),
    ]
    for section, source, provenance in expected:
        assert section.evidence_ids
        assert all(evidence[item].source == source for item in section.evidence_ids)
        assert all(evidence[item].provenance == provenance for item in section.evidence_ids)
    assert {item.source for item in report.evidence_index} == {
        "camera", "perception", "lidar", "ego_pose", "telemetry", "trajectory",
    }
    assert set(report.timeline[0].evidence_ids) == {
        item.id for item in report.evidence_index
    }


def test_report_contract_rejects_dangling_evidence_anywhere():
    report = assemble_report(high_risk_context())
    payload = report.model_dump(mode="json")
    payload["recommendations"][0]["evidence_ids"] = ["ev-9999"]
    with pytest.raises(ValueError, match="dangling evidence"):
        validate_report_contract(report.model_validate(payload))


def test_protected_fingerprint_covers_narrative_and_structured_facts():
    report = assemble_report(high_risk_context())
    original = protected_fingerprint(report)
    narrative_change = report.model_copy(update={"executive_summary": "改写后的叙述。"})
    score_change = report.model_copy(update={
        "scores": report.scores.model_copy(update={"overall": report.scores.overall + 1})
    })
    assert protected_fingerprint(narrative_change) != original
    assert protected_fingerprint(score_change) != original


def test_report_evidence_ids_are_stable_and_scene_agnostic():
    first = assemble_report(high_risk_context(scene_key="scene-0796"))
    second = assemble_report(high_risk_context(scene_key="scene-9999"))
    assert [item.id for item in first.evidence_index] == [item.id for item in second.evidence_index]
    assert all(item.id.startswith("ev-") for item in first.evidence_index)


def test_control_only_episode_does_not_fabricate_perception_or_trajectory_evidence():
    report = assemble_report(control_only_context())
    assert {item.source for item in report.evidence_index} == {"telemetry"}
    assert report.timeline[0].evidence_ids == [report.evidence_index[0].id]
    assert report.perception_analysis.evidence_ids == []
    assert report.trajectory_analysis.evidence_ids == []
    assert all(value is None for value in report.perception_analysis.metrics.values())
    assert all(value is None for value in report.trajectory_analysis.metrics.values())
    assert "不可评估" in report.perception_analysis.summary
    assert "不可评估" in report.trajectory_analysis.summary
    assert {item.code for item in report.data_quality} >= {
        "perception-objects-unavailable", "trajectory-unavailable",
    }
    assert any("不可评估" in item for item in report.limitations)
    assert all(chain.evidence_ids == report.timeline[0].evidence_ids
               for chain in report.causal_chains)
    DiagnosisReport.model_validate(report.model_dump(mode="json"))


def test_missing_camera_and_ego_records_do_not_create_false_evidence():
    context = all_source_context()
    payload = context.model_dump(mode="json")
    for row in payload["bundle"]["perception"]:
        row["imageFile"] = None
        row["ego"] = {"x": 0.0, "y": 0.0, "yaw": 0.0}
    for sample in payload["samples"]:
        sample["perception"]["value"]["imageFile"] = None
        sample["perception"]["value"]["ego"] = {"x": 0.0, "y": 0.0, "yaw": 0.0}
    payload["features"]["provenance"].pop("ego_pose", None)

    report = assemble_report(DiagnosisContext.model_validate(payload))

    assert "camera" not in {item.source for item in report.evidence_index}
    assert "ego_pose" not in {item.source for item in report.evidence_index}
