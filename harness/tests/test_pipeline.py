import json

import pytest

from autodrive_harness.cli import main
from autodrive_harness.pipeline import run_scene_diagnosis


def test_pipeline_emits_ordered_progress_and_is_deterministic(real_catalog):
    stages = []
    first = run_scene_diagnosis(real_catalog, "default", "test-v1", stages.append)
    second = run_scene_diagnosis(real_catalog, "default", "test-v1")
    assert [item.stage for item in stages] == [
        "validation", "timeline", "features", "events", "causality", "report", "complete",
    ]
    assert [item.percent for item in stages] == sorted(item.percent for item in stages)
    assert first.model_dump() == second.model_dump()


def test_pipeline_includes_enhancement_stage_only_when_requested(real_catalog):
    class IdentityEnhancer:
        def plan(self, payload):
            return {
                "style": "concise",
                "emphasized_finding_ids": [payload["key_findings"][0]["id"]],
                "emphasized_recommendation_ids": [payload["recommendations"][0]["id"]],
            }

    stages = []
    report = run_scene_diagnosis(
        real_catalog, "default", "test-v1", stages.append, IdentityEnhancer()
    )
    assert [item.stage for item in stages][-2:] == ["enhancement", "complete"]
    assert report.generation_mode == "model-enhanced"


def test_cli_writes_strict_scene_agnostic_json(real_catalog, tmp_path):
    output = tmp_path / "diagnosis.json"
    result = main([
        "--public-root", str(real_catalog.public_root),
        "--manifest", str(real_catalog.manifest_path),
        "--scene-key", "default",
        "--data-version", "cli-test-v1",
        "--output", str(output),
    ])
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert result == 0
    assert payload["scene_name"] == "城市路口侧向超车"
    assert payload["data_version"] == "cli-test-v1"
    assert "scene-" not in output.read_text(encoding="utf-8")


def test_pipeline_computes_causal_chains_once(real_catalog, monkeypatch):
    import autodrive_harness.pipeline as pipeline

    original = pipeline.build_causal_chains
    calls = []

    def counted(context, *args, **kwargs):
        calls.append(context.bundle.scene_key)
        return original(context, *args, **kwargs)

    monkeypatch.setattr(pipeline, "build_causal_chains", counted)
    pipeline.run_scene_diagnosis(real_catalog, "default", "test-v1")
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


@pytest.mark.parametrize(
    "case,unavailable",
    [
        ("missing-telemetry", ("motion_control_analysis",)),
        ("missing-perception", ("perception_analysis", "trajectory_analysis")),
        ("partial-overlap", ("perception_analysis", "motion_control_analysis", "trajectory_analysis")),
        ("excessive-skew", ("perception_analysis", "motion_control_analysis", "trajectory_analysis")),
    ],
)
def test_pipeline_returns_complete_degraded_report(real_catalog, case, unavailable):
    stages = []
    report = run_scene_diagnosis(
        BundleCatalog(degraded_bundle(real_catalog, case)),
        "default",
        f"{case}-v1",
        stages.append,
    )

    assert stages[-1].stage == "complete"
    assert stages[-1].percent == 100
    assert report.generation_mode == "local-harness"
    assert report.data_quality
    assert report.limitations
    assert report.scores.confidence < 1
    assert report.historical_risk_events == []
    for name in unavailable:
        section = getattr(report, name)
        assert "不可评估" in section.summary
        assert section.evidence_ids == []
        assert all(value is None for value in section.metrics.values())
