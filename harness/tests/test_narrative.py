import inspect

import pytest

from autodrive_harness.fact_bundle import protected_facts_fingerprint
import autodrive_harness.narrative as narrative
from autodrive_harness.reporting import (
    build_deterministic_facts,
    prepare_report_context,
)

from test_causality import high_risk_context


class FakeComposer:
    def __init__(self, payload):
        self.payload = payload
        self.projection = None

    def compose(self, projection):
        self.projection = projection
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


def grounded_facts(context=None):
    prepared, evidence = prepare_report_context(context or high_risk_context())
    return build_deterministic_facts(prepared, evidence)


def valid_payload(facts):
    evidence_id = facts.evidence_index[0].id
    return {
        "executive_summary": "依据当前证据，控制冲突应优先处理。",
        "finding_explanations": [{
            "finding_id": facts.priority_findings[0].id,
            "interpretation": "当前发现与已索引证据一致。",
            "evidence_ids": [evidence_id],
        }],
        "causal_explanations": [{
            "causal_chain_id": facts.causal_chains[0].id,
            "explanation": "该因果链仅解释已观测的风险关系。",
            "evidence_ids": [evidence_id],
        }],
        "recommendation_rationales": [{
            "recommendation_id": facts.recommendations[0].id,
            "rationale": "该建议对应当前证据支持的改进方向。",
            "evidence_ids": [evidence_id],
        }],
        "analysis_notes": [{
            "title": "证据边界",
            "body": "叙述不替代确定性事实与局限说明。",
            "evidence_ids": [evidence_id],
        }],
    }


def test_valid_narrative_changes_only_explanatory_fields_and_keeps_facts():
    facts = grounded_facts()
    facts_before = facts.model_dump(mode="json")
    fingerprint_before = protected_facts_fingerprint(facts)
    payload = valid_payload(facts)

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "model-grounded"
    assert report.meta.generation.model == "test-model"
    assert report.meta.generation.attempted is True
    assert report.meta.protected_facts_fingerprint == fingerprint_before
    assert report.analysis.risk_profile == facts.scores
    assert report.analysis.priority_findings == facts.priority_findings
    assert report.analysis.causal_chains == facts.causal_chains
    assert report.analysis.recommendations == facts.recommendations
    assert report.evidence.index == facts.evidence_index
    assert report.support.limitations == facts.limitations
    assert payload["executive_summary"] not in report.analysis.executive_summary
    assert "全程" in report.analysis.executive_summary
    assert report.analysis.finding_explanations[0].interpretation == payload[
        "finding_explanations"
    ][0]["interpretation"]
    assert facts.model_dump(mode="json") == facts_before


def test_composition_boundary_advertises_a_report_v2_return_contract():
    signature = inspect.signature(narrative.compose_report)

    assert "ReportV2" in str(signature.return_annotation)


def test_projection_contains_only_safe_display_facts():
    context = high_risk_context(scene_key="scene-0099")
    context.bundle.description = "内部文件 /private/raw/camera/frame.jpg"
    context.bundle.perception[0].imageFile = "/private/raw/camera/frame.jpg"
    context.bundle.perception[0].sampleToken = "private-sample-token"
    facts = grounded_facts(context)

    projection = narrative.build_narrative_projection(facts)
    serialized = projection.model_dump_json()

    assert projection.fact_fingerprint == protected_facts_fingerprint(facts)
    assert not hasattr(projection, "scene_key")
    assert "scene-0099" not in serialized
    assert "/private/raw" not in serialized
    assert "private-sample-token" not in serialized
    assert "OPENAI_API_KEY" not in serialized
    assert "base_url" not in serialized


def _empty_payload(_facts):
    return {}


def _unsupported_field_payload(facts):
    payload = valid_payload(facts)
    payload["unsupported"] = "not allowed"
    return payload


def _unknown_target_payload(facts):
    payload = valid_payload(facts)
    payload["finding_explanations"][0]["finding_id"] = "finding-9999"
    return payload


def _duplicate_target_payload(facts):
    payload = valid_payload(facts)
    payload["finding_explanations"].append(
        dict(payload["finding_explanations"][0])
    )
    return payload


def _unknown_evidence_payload(facts):
    payload = valid_payload(facts)
    payload["analysis_notes"][0]["evidence_ids"] = ["ev-9999"]
    return payload


def _empty_prose_payload(facts):
    payload = valid_payload(facts)
    payload["executive_summary"] = "   "
    return payload


def _novel_numeric_payload(facts):
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 999 km/h 的未经验证结论。"
    return payload


@pytest.mark.parametrize(
    "payload_builder",
    [
        _empty_payload,
        _unsupported_field_payload,
        _unknown_target_payload,
        _duplicate_target_payload,
        _unknown_evidence_payload,
        _empty_prose_payload,
        _novel_numeric_payload,
    ],
    ids=[
        "empty",
        "unsupported-field",
        "unknown-target",
        "duplicate-target",
        "unknown-evidence",
        "empty-prose",
        "novel-number",
    ],
)
def test_invalid_narrative_payload_falls_back_without_claiming_model_grounding(
    payload_builder,
):
    facts = grounded_facts()
    report = narrative.compose_report(
        facts,
        FakeComposer(payload_builder(facts)),
        "test-model",
    )

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.model == "test-model"
    assert report.meta.generation.attempted is True
    assert report.meta.generation.fallback_reason == "invalid_response"
    assert report.meta.protected_facts_fingerprint == protected_facts_fingerprint(facts)


def test_failure_reasons_and_disabled_composer_have_honest_local_metadata():
    facts = grounded_facts()

    timeout_report = narrative.compose_report(
        facts,
        FakeComposer(narrative.NarrativeFailure("timeout")),
        "test-model",
    )
    unavailable_report = narrative.compose_report(
        facts,
        FakeComposer(RuntimeError("offline")),
        "test-model",
    )
    disabled_report = narrative.compose_report(facts, None, "test-model")

    assert timeout_report.meta.generation.fallback_reason == "timeout"
    assert unavailable_report.meta.generation.fallback_reason == "unavailable"
    assert disabled_report.meta.generation.fallback_reason == "disabled"
    assert disabled_report.meta.generation.attempted is False
    assert all(
        report.meta.generation.mode == "local-harness"
        for report in (timeout_report, unavailable_report, disabled_report)
    )


def test_exact_factual_numeric_text_is_accepted_but_not_used_as_the_segment_conclusion():
    facts = grounded_facts()
    allowed = valid_payload(facts)
    allowed["executive_summary"] = "综合风险分为 34。"
    decimal = valid_payload(facts)
    decimal["executive_summary"] = "证据窗口峰值位于 12.4 秒。"
    sentence_punctuation = valid_payload(facts)
    sentence_punctuation["executive_summary"] = "综合风险分为 34."

    report = narrative.compose_report(facts, FakeComposer(allowed), "test-model")
    decimal_report = narrative.compose_report(
        facts,
        FakeComposer(decimal),
        "test-model",
    )
    punctuated_report = narrative.compose_report(
        facts,
        FakeComposer(sentence_punctuation),
        "test-model",
    )

    assert report.meta.generation.mode == "model-grounded"
    assert allowed["executive_summary"] not in report.analysis.executive_summary
    assert decimal_report.meta.generation.mode == "model-grounded"
    assert punctuated_report.meta.generation.mode == "model-grounded"


def test_standalone_temporal_unit_keeps_the_underlying_decimal_literal():
    assert narrative._numeric_literals_in("12.4 秒") == {"12.4"}


def test_novel_numeric_text_followed_by_sentence_period_falls_back():
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 999. 未经验证的结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


def test_novel_leading_decimal_text_falls_back_with_normal_grounded_facts():
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 .999 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


def test_leading_decimal_is_checked_against_approved_fact_values():
    facts = grounded_facts()
    facts.limitations.append("当前显示阈值为 .5。")
    payload = valid_payload(facts)
    payload["executive_summary"] = "模型声称阈值为 .6。"
    fact_backed = valid_payload(facts)
    fact_backed["executive_summary"] = "当前显示阈值为 .5。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")
    fact_backed_report = narrative.compose_report(
        facts,
        FakeComposer(fact_backed),
        "test-model",
    )

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"
    assert fact_backed_report.meta.generation.mode == "model-grounded"


def test_exact_signed_fact_numeric_text_remains_grounded():
    facts = grounded_facts()
    facts.limitations.append("当前校正偏差为 -3。")
    payload = valid_payload(facts)
    payload["executive_summary"] = "当前校正偏差为 -3。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "model-grounded"


def test_comma_separated_numeric_sequence_is_not_approved_by_its_fragments():
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 20,30 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


def test_slash_connected_numeric_sequence_is_not_approved_by_its_fragments():
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 20/30 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


def test_thousands_group_is_not_approved_by_its_individual_digits():
    facts = grounded_facts()
    facts.scores.overall = 1
    facts.limitations.append("当前校验值为 000。")
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 1,000 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


def test_multi_dot_chain_from_existing_fact_values_fails_closed():
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 12.4.20 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


def test_multi_dot_numeric_like_sequence_is_not_approved_by_its_fragments():
    facts = grounded_facts()
    facts.limitations.append("当前显示值为 1.2，已记录 3 项限制。")
    payload = valid_payload(facts)
    payload["executive_summary"] = "新增 1.2.3 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


@pytest.mark.parametrize("expression", ["20:30", "20-30", "20~30", "20至30", "20—30"])
def test_time_and_range_numeric_chains_are_not_approved_by_their_fragments(
    expression,
):
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = f"新增 {expression} 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


@pytest.mark.parametrize("expression", ["20时30分", "20 秒至 30 秒", "20分30秒"])
def test_chinese_temporal_numeric_chains_are_not_approved_by_their_fragments(
    expression,
):
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = f"新增 {expression} 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


@pytest.mark.parametrize(
    "expression",
    [
        "20%至30%",
        "20 米至 30 米",
        "20公里至30公里",
        "20 km/h 至 30 km/h",
        "20 to 30",
    ],
)
def test_unit_aware_range_chains_are_not_approved_by_their_fragments(
    expression,
):
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["executive_summary"] = f"新增 {expression} 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


@pytest.mark.parametrize("scientific_literal", ["1e3", "1E+3"])
def test_scientific_notation_is_checked_as_one_novel_numeric_literal(
    scientific_literal,
):
    facts = grounded_facts()
    facts.scores.overall = 1
    facts.limitations.append("已核验 3 项，显示偏差 +3。")
    payload = valid_payload(facts)
    payload["executive_summary"] = f"新增 {scientific_literal} 的未经验证结论。"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"


def test_opaque_evidence_ids_are_not_treated_as_model_numeric_prose():
    facts = grounded_facts()
    payload = valid_payload(facts)
    payload["analysis_notes"][0]["title"] = "关联 ev-0001 的证据边界"

    report = narrative.compose_report(facts, FakeComposer(payload), "test-model")

    assert report.meta.generation.mode == "model-grounded"


def test_facts_changed_during_composition_cannot_return_model_grounded_report():
    facts = grounded_facts()
    fingerprint_before = protected_facts_fingerprint(facts)

    class FactMutatingComposer:
        def compose(self, _projection):
            facts.scores.overall = 1
            return valid_payload(facts)

    report = narrative.compose_report(facts, FactMutatingComposer(), "test-model")

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.fallback_reason == "invalid_response"
    assert report.meta.protected_facts_fingerprint == fingerprint_before
