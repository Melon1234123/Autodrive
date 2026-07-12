import pytest

from autodrive_harness.reporting import (
    assemble_report,
    protected_fingerprint,
    validate_report_contract,
)

from test_causality import high_risk_context


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
    assert "scene-0796" not in report.model_dump_json()
    assert {item.id for item in report.evidence_index} >= set(report.timeline[0].evidence_ids)


def test_analysis_sections_reference_only_matching_evidence_provenance():
    report = assemble_report(high_risk_context())
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
    assert {item.source for item in report.evidence_index} >= {
        "perception", "telemetry", "trajectory",
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


def test_protected_fingerprint_covers_facts_but_not_narrative():
    report = assemble_report(high_risk_context())
    original = protected_fingerprint(report)
    narrative_change = report.model_copy(update={"executive_summary": "改写后的叙述。"})
    score_change = report.model_copy(update={
        "scores": report.scores.model_copy(update={"overall": report.scores.overall + 1})
    })
    assert protected_fingerprint(narrative_change) == original
    assert protected_fingerprint(score_change) != original


def test_report_evidence_ids_are_stable_and_scene_agnostic():
    first = assemble_report(high_risk_context(scene_key="scene-0796"))
    second = assemble_report(high_risk_context(scene_key="scene-9999"))
    assert [item.id for item in first.evidence_index] == [item.id for item in second.evidence_index]
    assert all(item.id.startswith("ev-") for item in first.evidence_index)
