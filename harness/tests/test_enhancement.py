from autodrive_harness.enhancement import enhance_report
from autodrive_harness.reporting import assemble_report

from test_causality import high_risk_context


class FakeEnhancer:
    def __init__(self, payload):
        self.payload = payload

    def plan(self, _local_payload):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


def local_report():
    return assemble_report(high_risk_context())


def valid_plan(local):
    return {
        "style": "expert",
        "emphasized_finding_ids": [local.key_findings[0].id],
        "emphasized_recommendation_ids": [local.recommendations[0].id],
    }


def test_valid_structured_plan_uses_only_local_content_and_marks_mode():
    local = local_report()
    enhanced = enhance_report(local, FakeEnhancer(valid_plan(local)))
    assert enhanced.generation_mode == "model-enhanced"
    assert enhanced.executive_summary == f"专家视图：{local.executive_summary}"
    assert enhanced.key_findings == local.key_findings
    assert enhanced.recommendations == local.recommendations
    assert enhanced.scores == local.scores
    assert enhanced.timeline == local.timeline
    assert enhanced.evidence_index == local.evidence_index


def test_plan_fails_closed_on_exception_unknown_style_or_invalid_local_id():
    local = local_report()
    assert enhance_report(local, FakeEnhancer(RuntimeError("offline"))) == local
    unknown_style = {**valid_plan(local), "style": "marketing"}
    assert enhance_report(local, FakeEnhancer(unknown_style)) == local
    invalid_id = {**valid_plan(local), "emphasized_finding_ids": ["finding-9999"]}
    assert enhance_report(local, FakeEnhancer(invalid_id)) == local


def test_plan_with_unknown_field_or_free_text_fails_closed():
    local = local_report()
    payload = {**valid_plan(local), "summary": "自由文本"}
    assert enhance_report(local, FakeEnhancer(payload)) == local


def test_plan_rejects_duplicate_emphasis_ids():
    local = local_report()
    finding_id = local.key_findings[0].id
    payload = {
        **valid_plan(local),
        "emphasized_finding_ids": [finding_id, finding_id],
    }
    assert enhance_report(local, FakeEnhancer(payload)) == local


def test_concise_plan_uses_only_the_local_safe_template():
    local = local_report()
    payload = {**valid_plan(local), "style": "concise"}
    result = enhance_report(local, FakeEnhancer(payload))
    assert result.generation_mode == "model-enhanced"
    assert result.executive_summary == f"简明视图：{local.executive_summary}"


def test_reviewer_composite_fact_injection_payload_is_rejected_without_leakage():
    local = local_report()
    attack = "default 100 分 999km/h 999米 低风险 已认证 ev-9999"
    payload = {
        **valid_plan(local),
        "narrative": attack,
        "emphasized_finding_ids": ["finding-9999"],
        "emphasized_recommendation_ids": ["recommendation-9999"],
    }
    result = enhance_report(local, FakeEnhancer(payload))
    assert result == local
    serialized = result.model_dump_json()
    for injected in ["default", "100", "999km/h", "999米", "低风险", "已认证", "ev-9999"]:
        assert injected not in serialized


def test_full_report_payload_is_not_an_enhancement_plan():
    local = local_report()
    payload = local.model_dump(mode="json")
    payload["executive_summary"] = "经模型改写的摘要。"
    assert enhance_report(local, FakeEnhancer(payload)) == local
