import pytest
from pydantic import ValidationError

from autodrive_harness.fact_bundle import (
    FactBundle,
    build_fact_bundle,
    protected_facts_fingerprint,
)
from autodrive_harness.models import RiskScores
from autodrive_harness.report_v2 import (
    GenerationMetadata,
    ReportV2,
    assemble_report_v2,
)
from autodrive_harness.narrative import ModelNarrative

from test_causality import high_risk_context


def test_report_v2_groups_immutable_facts_into_four_safe_top_level_areas():
    facts = build_fact_bundle(high_risk_context(), [], [])
    original = facts.model_dump(mode="json")
    report = assemble_report_v2(
        facts,
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )

    assert report.meta.schema_version == "2.0"
    assert report.analysis.risk_profile == facts.scores
    assert report.evidence.timeline == facts.timeline
    assert report.support.limitations == facts.limitations
    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "disabled"
    assert len(report.analysis.executive_summary) >= 200
    assert (
        report.meta.protected_facts_fingerprint
        == protected_facts_fingerprint(facts)
    )
    assert facts.model_dump(mode="json") == original
    assert set(report.model_dump()) == {"meta", "analysis", "evidence", "support"}
    assert "scene-" not in report.model_dump_json()


def test_report_v2_writes_a_segment_level_executive_conclusion_without_examples():
    facts = build_fact_bundle(high_risk_context(), [], [])
    source_summary = "模型结论：应优先处理当前控制冲突。"
    report = assemble_report_v2(
        facts,
        narrative=ModelNarrative(executive_summary=source_summary),
        generation=GenerationMetadata(
            mode="model-grounded",
            model="test-model",
            attempted=True,
        ),
    )

    conclusion = report.analysis.executive_summary

    assert len(conclusion) >= 200
    assert "全程" in conclusion or "整段路段" in conclusion
    assert str(facts.scores.overall) not in conclusion
    assert f"{len(facts.timeline)} 个" not in conclusion
    assert facts.priority_findings[0].title not in conclusion
    assert facts.priority_findings[0].summary not in conclusion
    assert source_summary not in conclusion
    assert "证据" in conclusion
    assert "回归" in conclusion


def test_report_v2_keeps_a_compatible_model_summary_for_the_whole_segment():
    facts = build_fact_bundle(high_risk_context(), [], [])
    source_summary = (
        "模型研判：整段路段需要优先收敛感知、决策与控制之间的协同风险。"
    )
    report = assemble_report_v2(
        facts,
        narrative=ModelNarrative(executive_summary=source_summary),
        generation=GenerationMetadata(
            mode="model-grounded",
            model="test-model",
            attempted=True,
        ),
    )

    assert source_summary in report.analysis.executive_summary


def test_report_v2_omits_a_numeric_model_summary_for_the_whole_segment():
    facts = build_fact_bundle(high_risk_context(), [], [])
    source_summary = "模型研判：整段路段综合风险为 66，应优先收敛协同风险。"
    report = assemble_report_v2(
        facts,
        narrative=ModelNarrative(executive_summary=source_summary),
        generation=GenerationMetadata(
            mode="model-grounded",
            model="test-model",
            attempted=True,
        ),
    )

    assert source_summary not in report.analysis.executive_summary


def test_report_v2_expands_sparse_facts_without_claiming_alignment_failure():
    facts = FactBundle(
        scene_name="最小事实场景",
        data_version="test-v2",
        scene_overview={},
        data_quality=[],
        scores=RiskScores(
            perception=None,
            motion=None,
            control=None,
            trajectory=None,
            data_quality=0,
            overall=None,
            confidence=0,
        ),
        priority_findings=[],
        timeline=[],
        causal_chains=[],
        recommendations=[],
        regression_tests=[],
        evidence_index=[],
        limitations=[],
    )
    report = assemble_report_v2(
        facts,
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )

    assert len(report.analysis.executive_summary) >= 200
    assert "跨模态时间对齐" not in report.analysis.executive_summary
    assert "当前事实包和证据索引" in report.analysis.executive_summary


def test_report_v2_rejects_an_executive_summary_shorter_than_200_characters():
    report = assemble_report_v2(
        build_fact_bundle(high_risk_context(), [], []),
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )
    payload = report.model_dump(mode="json")
    payload["analysis"]["executive_summary"] = "结论过短。"

    with pytest.raises(ValidationError):
        ReportV2.model_validate(payload)


def test_report_v2_contains_only_unique_non_dangling_references():
    facts = build_fact_bundle(high_risk_context(), [], [])
    report = assemble_report_v2(
        facts,
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )

    evidence_ids = {item.id for item in report.evidence.index}
    assert len(evidence_ids) == len(report.evidence.index)
    assert all(
        set(item.evidence_ids) <= evidence_ids
        for item in report.analysis.priority_findings
    )
    assert all(
        set(item.evidence_ids) <= evidence_ids
        for item in report.analysis.causal_chains
    )
    assert all(
        set(item.evidence_ids) <= evidence_ids
        for item in report.analysis.recommendations
    )
    assert all(
        set(item.evidence_ids) <= evidence_ids
        for item in report.evidence.timeline
    )


@pytest.mark.parametrize(
    ("area", "unsafe_value"),
    [
        ("source", "scene-0099"),
        ("asset", "/private/raw/camera/frame.jpg"),
        ("unc_asset", r"\\server\share\camera\frame.jpg"),
        ("relative_asset", "assets/private/report.csv"),
        ("extensionless_relative_asset", "assets/private/recording"),
        ("credential", "OPENAI_API_KEY=fake-secret-123456"),
        ("credential_header", "x-api-key: fake-secret-123456"),
        ("provider_key", "sk-fakecredential123456"),
    ],
)
def test_report_v2_rejects_raw_scene_ids_and_filesystem_paths(
    area: str,
    unsafe_value: str,
):
    report = assemble_report_v2(
        build_fact_bundle(high_risk_context(), [], []),
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )
    payload = report.model_dump(mode="json")
    payload["support"]["scene_overview"][area] = unsafe_value

    with pytest.raises(ValidationError):
        ReportV2.model_validate(payload)


def test_report_v2_rejects_dangling_evidence_references():
    report = assemble_report_v2(
        build_fact_bundle(high_risk_context(), [], []),
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )
    payload = report.model_dump(mode="json")
    payload["analysis"]["priority_findings"][0]["evidence_ids"] = ["ev-9999"]

    with pytest.raises(ValidationError, match="dangling evidence"):
        ReportV2.model_validate(payload)


def test_report_v2_owns_a_deep_snapshot_of_fact_bundle_values():
    facts = build_fact_bundle(high_risk_context(), [], [])
    facts_at_assembly = facts.model_copy(deep=True)
    report = assemble_report_v2(
        facts,
        narrative=None,
        generation=GenerationMetadata.local(model=None, reason="disabled"),
    )
    assembled_payload = report.model_dump(mode="json")

    facts.scores.overall = 1
    facts.scene_overview["description"] = "组装后修改"
    facts.priority_findings[0].summary = "组装后修改"

    assert report.model_dump(mode="json") == assembled_payload
    assert report.analysis.risk_profile is not facts.scores
    assert (
        report.meta.protected_facts_fingerprint
        == protected_facts_fingerprint(facts_at_assembly)
    )
