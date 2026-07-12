import json

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
        def enhance(self, payload):
            return payload

    stages = []
    report = run_scene_diagnosis(
        real_catalog, "default", "test-v1", stages.append, IdentityEnhancer()
    )
    assert [item.stage for item in stages][-2:] == ["enhancement", "complete"]
    assert report.generation_mode == "model-enhanced"


def test_cli_writes_strict_scene_agnostic_json(real_catalog, tmp_path):
    del real_catalog
    output = tmp_path / "diagnosis.json"
    result = main([
        "--public-root", "frontend/public",
        "--manifest", "frontend/public/scenes.json",
        "--scene-key", "default",
        "--data-version", "cli-test-v1",
        "--output", str(output),
    ])
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert result == 0
    assert payload["scene_name"] == "城市路口侧向超车"
    assert payload["data_version"] == "cli-test-v1"
    assert "scene-" not in output.read_text(encoding="utf-8")
