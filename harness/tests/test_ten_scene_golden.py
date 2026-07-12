import re

import pytest

from autodrive_harness.pipeline import run_scene_diagnosis


TEN_SCENE_KEYS = [
    "scene-0061", "scene-0103", "scene-0553", "scene-0655", "scene-0757",
    "default", "scene-0916", "scene-1077", "scene-1094", "scene-1100",
]


def test_golden_summary_has_exact_fixed_scene_set(golden_summary):
    assert set(golden_summary) == set(TEN_SCENE_KEYS)
    assert all(set(item) == {"scene_name", "overall", "event_count"}
               for item in golden_summary.values())


@pytest.mark.parametrize("scene_key", TEN_SCENE_KEYS)
def test_every_real_scene_matches_golden_contract(
    real_catalog, golden_summary, scene_key
):
    report = run_scene_diagnosis(real_catalog, scene_key, "golden-v1")
    assert report.scene_name == golden_summary[scene_key]["scene_name"]
    assert report.scores.overall == golden_summary[scene_key]["overall"]
    assert len(report.timeline) == golden_summary[scene_key]["event_count"]
    assert report.executive_summary and report.recommendations and report.regression_tests
    assert report.evidence_index and report.limitations
    assert "scene-" not in report.model_dump_json()
    assert all(re.fullmatch(r"ev-\d{4}", item.id) for item in report.evidence_index)
