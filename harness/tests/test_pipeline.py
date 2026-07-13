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


@pytest.mark.parametrize("case", [
    "missing-telemetry", "missing-perception", "partial-overlap", "excessive-skew",
])
def test_pipeline_returns_complete_modality_aware_degraded_report(real_catalog, case):
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
    assert report.scores.overall is None
    sources = {item.source for item in report.evidence_index}

    if case == "missing-telemetry":
        assert sources == {"camera", "perception", "lidar", "ego_pose", "trajectory"}
        assert report.scores.motion is None
        assert report.scores.control is None
        assert report.scores.perception is not None
        assert report.scores.trajectory is not None
        assert report.perception_analysis.metrics["object_peak"] > 0
        assert report.trajectory_analysis.metrics["demo_path_lateral_deviation"] > 0
        unavailable = (report.motion_control_analysis,)
    elif case == "missing-perception":
        assert sources == {"lidar", "telemetry"}
        assert report.scores.perception is None
        assert report.scores.trajectory is None
        assert report.scores.motion is not None
        assert report.scores.control is not None
        assert report.motion_control_analysis.metrics["peak_speed_kmh"] > 0
        assert report.motion_control_analysis.metrics["peak_abs_accel"] > 0
        unavailable = (report.perception_analysis, report.trajectory_analysis)
    else:
        assert sources == {
            "camera", "perception", "lidar", "ego_pose", "telemetry", "trajectory",
        }
        assert all(getattr(report.scores, axis) is not None for axis in (
            "perception", "motion", "control", "trajectory",
        ))
        assert report.perception_analysis.metrics["object_peak"] > 0
        assert report.motion_control_analysis.metrics["peak_speed_kmh"] > 0
        assert report.trajectory_analysis.metrics["demo_path_lateral_deviation"] > 0
        unavailable = ()

    for section in unavailable:
        assert "不可评估" in section.summary
        assert section.evidence_ids == []
        assert all(value is None for value in section.metrics.values())
