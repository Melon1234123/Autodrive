import inspect
import json

import pytest

from autodrive_harness.cli import main
from autodrive_harness.models import DiagnosisProgress
from autodrive_harness.pipeline import DiagnosisCancelled, run_scene_diagnosis


def test_pipeline_emits_ordered_progress_and_is_deterministic(real_catalog):
    stages = []
    first = run_scene_diagnosis(real_catalog, "default", "test-v2", stages.append)
    second = run_scene_diagnosis(real_catalog, "default", "test-v2")
    assert [item.stage for item in stages] == [
        "validation", "alignment", "features", "events", "evidence", "report", "complete",
    ]
    assert [item.percent for item in stages] == sorted(item.percent for item in stages)
    assert first.meta.schema_version == "2.0"
    assert first.meta.generation.mode == "local-harness"
    assert first.model_dump() == second.model_dump()


def test_narrative_progress_stage_is_a_valid_progress_contract_value():
    progress = DiagnosisProgress(stage="narrative", percent=86)

    assert progress.stage == "narrative"
    assert progress.percent == 86


def test_pipeline_reports_local_stage_before_disabled_composition(
    real_catalog,
    monkeypatch,
):
    from autodrive_harness import pipeline

    stages = []
    original = pipeline.compose_report

    def compose_after_report(facts, composer, model_name):
        assert composer is None
        assert stages[-1].stage == "report"
        return original(facts, composer, model_name)

    monkeypatch.setattr(pipeline, "compose_report", compose_after_report)
    pipeline.run_scene_diagnosis(real_catalog, "default", "test-v2", stages.append)


def test_pipeline_inserts_narrative_only_for_a_real_composer(real_catalog):
    stages = []

    class FakeComposer:
        def compose(self, _projection):
            assert stages[-1].stage == "narrative"
            return {
                "executive_summary": "依据当前证据生成的受约束解释。",
                "finding_explanations": [],
                "causal_explanations": [],
                "recommendation_rationales": [],
                "analysis_notes": [],
            }

    report = run_scene_diagnosis(
        real_catalog,
        "default",
        "test-v2",
        stages.append,
        composer=FakeComposer(),
        model_name="fake-narrative-model",
    )

    assert [item.stage for item in stages] == [
        "validation", "alignment", "features", "events", "evidence",
        "narrative", "report", "complete",
    ]
    assert [item.percent for item in stages] == sorted(item.percent for item in stages)
    assert report.meta.generation.mode == "model-grounded"
    assert report.meta.generation.model == "fake-narrative-model"


def test_pipeline_no_longer_accepts_the_retired_v1_enhancer_keyword():
    signature = inspect.signature(run_scene_diagnosis)

    assert "enhancer" not in signature.parameters


def test_cli_writes_strict_scene_agnostic_json(real_catalog, tmp_path):
    output = tmp_path / "diagnosis.json"
    result = main([
        "--public-root", str(real_catalog.public_root),
        "--manifest", str(real_catalog.manifest_path),
        "--scene-key", "default",
        "--data-version", "cli-test-v2",
        "--output", str(output),
    ])
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert result == 0
    assert payload["meta"]["schema_version"] == "2.0"
    assert payload["meta"]["scene_name"] == "城市路口侧向超车"
    assert payload["meta"]["data_version"] == "cli-test-v2"
    assert payload["meta"]["generation"]["mode"] == "local-harness"
    assert "scene-" not in output.read_text(encoding="utf-8")


def test_pipeline_computes_causal_chains_once(real_catalog, monkeypatch):
    import autodrive_harness.reporting as reporting
    from autodrive_harness import pipeline

    original = reporting.build_causal_chains
    calls = []

    def counted(context, *args, **kwargs):
        calls.append(context.bundle.scene_key)
        return original(context, *args, **kwargs)

    monkeypatch.setattr(reporting, "build_causal_chains", counted)
    pipeline.run_scene_diagnosis(real_catalog, "default", "test-v2")
    assert calls == ["default"]


class BundleCatalog:
    def __init__(self, bundle):
        self.bundle = bundle

    def load(self, _scene_key):
        return self.bundle


def degraded_bundle(real_catalog, case):
    bundle = real_catalog.load("default").model_copy(deep=True)
    if case == "missing-telemetry":
        bundle.telemetry = []
    elif case == "missing-perception":
        bundle.perception = []
    elif case == "partial-overlap":
        cutoff = bundle.telemetry[-1].time - 0.2
        bundle.perception = [row for row in bundle.perception if row.time >= cutoff]
    elif case == "excessive-skew":
        for row in bundle.perception:
            row.time += 10_000.0
    return bundle


@pytest.mark.parametrize("case", [
    "missing-telemetry", "missing-perception", "partial-overlap", "excessive-skew",
])
def test_pipeline_returns_complete_modality_aware_degraded_report(real_catalog, case):
    stages = []
    report = run_scene_diagnosis(
        BundleCatalog(degraded_bundle(real_catalog, case)),
        "default",
        f"{case}-v2",
        stages.append,
    )

    assert stages[-1].stage == "complete"
    assert stages[-1].percent == 100
    assert report.meta.generation.mode == "local-harness"
    assert report.support.data_quality
    assert report.support.limitations
    assert report.analysis.risk_profile.confidence < 1
    assert report.evidence.timeline == []
    assert report.analysis.risk_profile.overall is None
    sources = {item.source for item in report.evidence.index}

    if case == "missing-telemetry":
        assert sources == {"camera", "perception", "lidar", "ego_pose", "trajectory"}
        assert report.analysis.risk_profile.motion is None
        assert report.analysis.risk_profile.control is None
        assert report.analysis.risk_profile.perception is not None
        assert report.analysis.risk_profile.trajectory is not None
    elif case == "missing-perception":
        assert sources == {"lidar", "telemetry"}
        assert report.analysis.risk_profile.perception is None
        assert report.analysis.risk_profile.trajectory is None
        assert report.analysis.risk_profile.motion is not None
        assert report.analysis.risk_profile.control is not None
    else:
        assert sources == {
            "camera", "perception", "lidar", "ego_pose", "telemetry", "trajectory",
        }
        assert all(getattr(report.analysis.risk_profile, axis) is not None for axis in (
            "perception", "motion", "control", "trajectory",
        ))


@pytest.mark.parametrize(
    "case,missing_label",
    [("missing-telemetry", "遥测"), ("missing-perception", "感知")],
)
def test_degraded_report_never_presents_unexecuted_event_mining_as_negative(
    real_catalog, case, missing_label
):
    report = run_scene_diagnosis(
        BundleCatalog(degraded_bundle(real_catalog, case)),
        "default",
        f"semantic-{case}-v2",
    )

    assert "综合风险不可评估" in report.analysis.executive_summary
    assert report.analysis.priority_findings[0].title == "跨模态事件挖掘不可评估"
    assert "未执行" in report.analysis.priority_findings[0].summary
    assert (
        report.analysis.causal_chains[0].observation
        == "跨模态事件挖掘与因果链不可评估。"
    )
    assert "未执行" in report.analysis.causal_chains[0].mechanism
    assert missing_label in report.analysis.recommendations[0].action
    assert "重新运行" in report.analysis.recommendations[0].action
    assert report.support.regression_tests[0].name == "跨模态数据恢复复验"
    assert missing_label in report.support.regression_tests[0].criterion
    assert "重新运行" in report.support.regression_tests[0].criterion

    degraded_semantics = " ".join([
        *(item.title + item.summary for item in report.analysis.priority_findings),
        *(item.observation + item.mechanism for item in report.analysis.causal_chains),
        *(item.action + item.rationale for item in report.analysis.recommendations),
        *(
            item.name + item.criterion + item.rationale
            for item in report.support.regression_tests
        ),
    ])
    for false_negative in ("未检出持续风险", "无持续风险", "保持 0 个事件"):
        assert false_negative not in degraded_semantics


def test_pipeline_stops_before_loading_when_already_cancelled():
    class NoLoadCatalog:
        def load(self, _scene_key):
            raise AssertionError("cancelled pipeline must not load a scene")

    stages = []
    with pytest.raises(DiagnosisCancelled):
        run_scene_diagnosis(
            NoLoadCatalog(),
            "default",
            "cancelled-before-load",
            stages.append,
            cancelled=lambda: True,
        )

    assert stages == []


def test_pipeline_stops_after_an_in_flight_feature_boundary(real_catalog, monkeypatch):
    from autodrive_harness import pipeline

    cancelled = False
    original = pipeline.extract_features

    def cancel_after_features(samples):
        nonlocal cancelled
        result = original(samples)
        cancelled = True
        return result

    monkeypatch.setattr(pipeline, "extract_features", cancel_after_features)
    stages = []
    with pytest.raises(DiagnosisCancelled):
        pipeline.run_scene_diagnosis(
            real_catalog,
            "default",
            "cancelled-in-flight",
            stages.append,
            cancelled=lambda: cancelled,
        )

    assert [item.stage for item in stages] == [
        "validation", "alignment", "features",
    ]


def test_pipeline_stops_after_a_narrative_provider_cancellation(real_catalog):
    cancelled = False

    class CancelAfterCompose:
        def compose(self, _projection):
            nonlocal cancelled
            cancelled = True
            return {
                "executive_summary": "依据当前证据生成的受约束解释。",
                "finding_explanations": [],
                "causal_explanations": [],
                "recommendation_rationales": [],
                "analysis_notes": [],
            }

    stages = []
    with pytest.raises(DiagnosisCancelled):
        run_scene_diagnosis(
            real_catalog,
            "default",
            "cancelled-narrative",
            stages.append,
            composer=CancelAfterCompose(),
            model_name="fake-narrative-model",
            cancelled=lambda: cancelled,
        )

    assert [item.stage for item in stages] == [
        "validation", "alignment", "features", "events", "evidence", "narrative",
    ]


def test_provider_cancellation_reraises_without_constructing_a_local_report(
    real_catalog,
    monkeypatch,
):
    from autodrive_harness import narrative

    cancelled = False
    fallback_called = False

    class CancelAfterCompose:
        def compose(self, _projection):
            nonlocal cancelled
            cancelled = True
            return {
                "executive_summary": "依据当前证据生成的受约束解释。",
                "finding_explanations": [],
                "causal_explanations": [],
                "recommendation_rationales": [],
                "analysis_notes": [],
            }

    def local_report_must_not_run(*_args, **_kwargs):
        nonlocal fallback_called
        fallback_called = True
        raise AssertionError("provider cancellation must not become a local report")

    monkeypatch.setattr(narrative, "_local_report", local_report_must_not_run)

    with pytest.raises(DiagnosisCancelled):
        run_scene_diagnosis(
            real_catalog,
            "default",
            "cancelled-narrative-no-fallback",
            composer=CancelAfterCompose(),
            model_name="fake-narrative-model",
            cancelled=lambda: cancelled,
        )

    assert fallback_called is False


def test_degraded_pipeline_stops_before_scoring_after_feature_cancellation(
    real_catalog,
    monkeypatch,
):
    from autodrive_harness import pipeline

    cancelled = False
    score_calls = []
    original = pipeline.extract_independent_features

    def cancel_after_feature_extraction(bundle):
        nonlocal cancelled
        features = original(bundle)
        cancelled = True
        return features

    def scoring_must_not_run(*_args, **_kwargs):
        score_calls.append(True)
        raise AssertionError("degraded scoring must not start after cancellation")

    monkeypatch.setattr(
        pipeline,
        "extract_independent_features",
        cancel_after_feature_extraction,
    )
    monkeypatch.setattr(pipeline, "score_independent_modalities", scoring_must_not_run)

    stages = []
    with pytest.raises(DiagnosisCancelled):
        run_scene_diagnosis(
            BundleCatalog(degraded_bundle(real_catalog, "missing-telemetry")),
            "default",
            "cancelled-degraded-scoring",
            stages.append,
            cancelled=lambda: cancelled,
        )

    assert score_calls == []
    assert [item.stage for item in stages] == [
        "validation", "alignment", "features", "events",
    ]
