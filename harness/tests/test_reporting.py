import pytest
from pydantic import ValidationError

from autodrive_harness import reporting
from autodrive_harness.fact_bundle import protected_facts_fingerprint
from autodrive_harness.models import DiagnosisContext
from autodrive_harness.narrative import ModelNarrative
from autodrive_harness.report_v2 import (
    GenerationMetadata,
    ReportV2,
    assemble_report_v2,
)
from autodrive_harness.reporting import prepare_report_context

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


def report_from_context(context):
    prepared, evidence = prepare_report_context(context)
    facts = reporting.build_deterministic_facts(prepared, evidence)
    return assemble_report_v2(
        facts,
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )


def test_local_report_is_complete_and_has_no_raw_scene_id():
    report = report_from_context(high_risk_context(
        scene_key="scene-0796", scene_name="城市路口侧向超车"
    ))

    assert report.meta.generation.mode == "local-harness"
    assert len(report.analysis.executive_summary) >= 200
    assert report.analysis.priority_findings
    assert report.analysis.recommendations
    assert report.support.regression_tests
    assert report.evidence.index
    assert "scene-0796" not in report.model_dump_json()
    assert {item.id for item in report.evidence.index} >= set(
        report.evidence.timeline[0].evidence_ids
    )


def test_v2_evidence_index_preserves_matching_provenance_for_all_sources():
    report = report_from_context(all_source_context())
    evidence = {item.id: item for item in report.evidence.index}

    assert {item.source for item in report.evidence.index} == {
        "camera", "perception", "lidar", "ego_pose", "telemetry", "trajectory",
    }
    assert set(report.evidence.timeline[0].evidence_ids) == set(evidence)
    assert all(
        evidence[item_id].provenance in {
            "real", "real-derived", "estimated", "demo-visualization",
        }
        for item_id in report.evidence.timeline[0].evidence_ids
    )


def test_v2_report_contract_rejects_dangling_evidence_anywhere():
    report = report_from_context(high_risk_context())
    payload = report.model_dump(mode="json")
    payload["analysis"]["recommendations"][0]["evidence_ids"] = ["ev-9999"]

    with pytest.raises(ValidationError, match="dangling evidence"):
        ReportV2.model_validate(payload)


def test_report_evidence_ids_are_stable_and_scene_agnostic():
    first = report_from_context(high_risk_context(scene_key="scene-0796"))
    second = report_from_context(high_risk_context(scene_key="scene-9999"))

    assert [item.id for item in first.evidence.index] == [
        item.id for item in second.evidence.index
    ]
    assert all(item.id.startswith("ev-") for item in first.evidence.index)


def test_control_only_episode_does_not_fabricate_perception_or_trajectory_evidence():
    report = report_from_context(control_only_context())

    assert {item.source for item in report.evidence.index} == {"telemetry"}
    assert report.evidence.timeline[0].evidence_ids == [report.evidence.index[0].id]
    assert {item.code for item in report.support.data_quality} >= {
        "perception-objects-unavailable", "trajectory-unavailable",
    }
    assert any("不可评估" in item for item in report.support.limitations)
    assert all(
        chain.evidence_ids == report.evidence.timeline[0].evidence_ids
        for chain in report.analysis.causal_chains
    )


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

    report = report_from_context(DiagnosisContext.model_validate(payload))

    assert "camera" not in {item.source for item in report.evidence.index}
    assert "ego_pose" not in {item.source for item in report.evidence.index}


def test_deterministic_fact_builder_calculates_causality_and_keeps_evidence_safe():
    context, evidence = prepare_report_context(all_source_context())

    facts = reporting.build_deterministic_facts(context, evidence)

    assert facts.priority_findings
    assert facts.causal_chains
    assert facts.evidence_index == evidence
    serialized = facts.model_dump_json()
    assert "samples/CAM_FRONT/source.jpg" not in serialized
    assert "frames/000001.bin" not in serialized
    assert "sample-token" not in serialized


def test_protected_fact_fingerprint_is_independent_of_narrative_and_fallback():
    context, evidence = prepare_report_context(high_risk_context())
    facts = reporting.build_deterministic_facts(context, evidence)
    evidence_ids = [item.id for item in evidence]
    narrative = ModelNarrative(
        executive_summary="经受约束的模型叙述。",
        analysis_notes=[{
            "title": "风险提示",
            "body": "叙述仅解释确定性事实。",
            "evidence_ids": evidence_ids[:1],
        }],
    )
    reports = [
        assemble_report_v2(
            facts,
            narrative=narrative,
            generation=GenerationMetadata(
                mode="model-grounded",
                model="fake-model",
                attempted=True,
            ),
        ),
        assemble_report_v2(
            facts,
            narrative=None,
            generation=GenerationMetadata.local(
                model="fake-model",
                reason="invalid_response",
            ),
        ),
        assemble_report_v2(
            facts,
            narrative=None,
            generation=GenerationMetadata.local(model=None, reason="disabled"),
        ),
    ]

    expected = protected_facts_fingerprint(facts)
    assert {item.meta.protected_facts_fingerprint for item in reports} == {expected}
