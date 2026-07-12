from autodrive_harness.reporting import assemble_report, protected_fingerprint

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
