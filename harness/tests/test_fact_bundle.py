import pytest

from autodrive_harness.fact_bundle import (
    build_fact_bundle,
    protected_facts_fingerprint,
)
from autodrive_harness.models import DiagnosisContext, EvidenceRef

from test_causality import high_risk_context


def context_with_raw_scene_and_asset_paths(
    scene_key: str,
    image_file: str,
    lidar_file: str,
) -> DiagnosisContext:
    payload = high_risk_context().model_dump(mode="json")
    payload["bundle"].update({
        "scene_key": scene_key,
        "description": (
            f"内部来源 {scene_key}，相机文件 {image_file}，"
            f"点云文件 {lidar_file}。"
        ),
        "lidar_index": [{
            "time": 12.4,
            "file": lidar_file,
            "pointCount": 42,
        }],
    })
    payload["bundle"]["perception"][0]["imageFile"] = image_file
    payload["samples"][0]["perception"]["value"]["imageFile"] = image_file
    payload["samples"][0]["lidar"] = {
        "value": {
            "time": 12.4,
            "file": lidar_file,
            "pointCount": 42,
        },
        "provenance": "nearest",
        "source_times": [12.4],
    }
    return DiagnosisContext.model_validate(payload)


def test_protected_fact_fingerprint_changes_only_when_facts_change():
    facts = build_fact_bundle(high_risk_context(), [], [])
    copied = facts.model_copy(deep=True)

    assert protected_facts_fingerprint(facts) == protected_facts_fingerprint(copied)

    copied.scores.overall = 1
    assert protected_facts_fingerprint(facts) != protected_facts_fingerprint(copied)


def test_display_fact_bundle_removes_scene_keys_and_asset_paths():
    context = context_with_raw_scene_and_asset_paths(
        scene_key="scene-0099",
        image_file="/private/raw/camera/frame.jpg",
        lidar_file="/private/raw/lidar/frame.bin",
    )

    serialized = build_fact_bundle(context, [], []).model_dump_json()

    assert "scene-0099" not in serialized
    assert "/private/raw" not in serialized
    assert context.bundle.scene_key == "scene-0099"
    assert context.bundle.perception[0].imageFile == "/private/raw/camera/frame.jpg"


@pytest.mark.parametrize(
    "unsafe_path",
    [
        r"\\server\share\camera\frame.jpg",
        "assets/private/report.csv",
    ],
)
def test_display_fact_bundle_removes_unc_and_general_relative_paths(
    unsafe_path: str,
):
    context = high_risk_context()
    context.bundle.description = f"诊断输入来自 {unsafe_path}。"
    evidence = EvidenceRef(
        id="ev-0001",
        source="camera",
        provenance="real",
        start_time=12.4,
        end_time=12.4,
        detail=f"证据文件为 {unsafe_path}。",
    )

    facts = build_fact_bundle(context, [evidence], [])

    assert unsafe_path not in facts.scene_overview["description"]
    assert unsafe_path not in facts.evidence_index[0].detail
    assert "[内部资源]" in facts.scene_overview["description"]
    assert "[内部资源]" in facts.evidence_index[0].detail
