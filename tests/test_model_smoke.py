import os

import pytest


@pytest.mark.skipif(
    os.getenv("RUN_MODEL_SMOKE") != "1",
    reason="set RUN_MODEL_SMOKE=1 to call the configured model",
)
def test_configured_model_returns_a_grounded_report():
    from backend import server
    from autodrive_harness import run_scene_diagnosis

    if not server.has_model_credentials():
        pytest.skip("configured model credentials are required for this opt-in smoke test")

    baseline = run_scene_diagnosis(
        server.scene_catalog,
        "default",
        "model-smoke-v2",
    )
    report = server.run_diagnosis_pipeline(
        "default",
        "model-smoke-v2",
        lambda _progress: None,
    )

    assert report.meta.generation.mode == "model-grounded"
    assert report.meta.generation.attempted is True
    assert report.meta.schema_version == "2.0"
    assert (
        report.meta.protected_facts_fingerprint
        == baseline.meta.protected_facts_fingerprint
    )
