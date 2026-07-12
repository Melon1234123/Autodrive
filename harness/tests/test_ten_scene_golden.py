import re

import pytest

from autodrive_harness.pipeline import run_scene_diagnosis

from fixture_support import (
    ARCHIVE_PATH,
    InputFingerprintError,
    extract_fixture,
    load_frozen_fingerprints,
    verify_input_fingerprints,
)


TEN_SCENE_KEYS = [
    "scene-0061", "scene-0103", "scene-0553", "scene-0655", "scene-0757",
    "default", "scene-0916", "scene-1077", "scene-1094", "scene-1100",
]


def test_golden_summary_has_exact_fixed_scene_set(golden_summary):
    assert set(golden_summary) == set(TEN_SCENE_KEYS)
    assert all(set(item) == {"scene_name", "overall", "event_count"}
               for item in golden_summary.values())


def test_compact_fixture_is_frozen_and_contains_exact_ten_scene_inputs(real_catalog):
    assert 1_000_000 <= ARCHIVE_PATH.stat().st_size <= 3_000_000
    frozen = load_frozen_fingerprints()
    assert set(frozen["scenes"]) == set(TEN_SCENE_KEYS)
    assert set(verify_input_fingerprints(real_catalog.public_root)) == set(TEN_SCENE_KEYS)


def test_input_change_cannot_pass_by_regenerating_golden(tmp_path):
    public_root = extract_fixture(tmp_path / "mutated")
    telemetry = public_root / "telemetry.json"
    telemetry.write_bytes(telemetry.read_bytes() + b" ")
    with pytest.raises(InputFingerprintError, match="SHA-256 mismatch"):
        verify_input_fingerprints(public_root)


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


def test_live_public_root_default_matches_frozen_fixture_when_available(
    live_catalog, golden_summary
):
    report = run_scene_diagnosis(live_catalog, "default", "golden-v1")
    assert report.scores.overall == golden_summary["default"]["overall"]
    assert len(report.timeline) == golden_summary["default"]["event_count"]
