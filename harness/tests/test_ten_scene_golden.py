import json
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
    assert all(set(item) == {
        "scene_name",
        "protected_facts_fingerprint",
        "generation_mode",
        "overall",
        "episode_count",
        "evidence_count",
        "limitations",
    }
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
    report = run_scene_diagnosis(real_catalog, scene_key, "golden-v2")
    expected = golden_summary[scene_key]
    assert report.meta.scene_name == expected["scene_name"]
    assert (
        report.meta.protected_facts_fingerprint
        == expected["protected_facts_fingerprint"]
    )
    assert report.meta.generation.mode == expected["generation_mode"]
    assert report.analysis.risk_profile.overall == expected["overall"]
    assert len(report.evidence.timeline) == expected["episode_count"]
    assert len(report.evidence.index) == expected["evidence_count"]
    assert report.support.limitations == expected["limitations"]
    assert report.analysis.priority_findings
    assert report.evidence.index
    assert "scene-" not in report.model_dump_json()
    assert all(re.fullmatch(r"ev-\d{4}", item.id) for item in report.evidence.index)
    assert scene_key not in json.dumps(expected, ensure_ascii=False)
    assert not any(
        marker in json.dumps(expected, ensure_ascii=False)
        for marker in ("/Users/", "\\\\", ".jpg", ".bin", ".json")
    )


def test_live_public_root_default_matches_frozen_fixture_when_available(
    live_catalog, golden_summary
):
    report = run_scene_diagnosis(live_catalog, "default", "golden-v2")
    assert report.analysis.risk_profile.overall == golden_summary["default"]["overall"]
    assert (
        report.meta.protected_facts_fingerprint
        == golden_summary["default"]["protected_facts_fingerprint"]
    )
