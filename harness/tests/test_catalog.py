import json
from pathlib import Path

import pytest

from autodrive_harness.catalog import (
    SceneCatalog,
    SceneNotFoundError,
    UnsafeAssetPathError,
)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def build_catalog(tmp_path: Path, scene_key: str = "default", label: str = "untrusted") -> SceneCatalog:
    public_root = tmp_path / "public"
    scene_root = public_root / "scenes" / scene_key
    telemetry = [{"time": 0.0, "speedKmh": 1.0, "brake": 0.0, "throttle": 0.1,
                  "steering": 0.0, "accel": 0.0, "scene": "test"}]
    perception = [{"time": 0.0, "objects": [], "ego": {"x": 0.0, "y": 0.0,
                   "yaw": 0.0}, "lanes": [], "plannedPath": []}]
    _write_json(scene_root / "telemetry.json", telemetry)
    _write_json(scene_root / "perception.json", perception)
    _write_json(scene_root / "metadata.json", {"sourceType": "test"})
    _write_json(scene_root / "lidar" / "index.json", {
        "version": 1,
        "pointFormat": "xyzI-f32-le",
        "frames": [{"time": 0.0, "file": "frames/000000.bin", "pointCount": 4}],
    })
    manifest = {
        "version": 1,
        "defaultSceneId": scene_key,
        "scenes": [{
            "id": scene_key,
            "label": label,
            "description": "fixture",
            "telemetryFile": f"/scenes/{scene_key}/telemetry.json",
            "perceptionFile": f"/scenes/{scene_key}/perception.json",
            "metadataFile": f"/scenes/{scene_key}/metadata.json",
            "lidarIndexFile": f"/scenes/{scene_key}/lidar/index.json",
        }],
    }
    manifest_path = public_root / "scenes.json"
    _write_json(manifest_path, manifest)
    return SceneCatalog(public_root, manifest_path)


def test_catalog_rejects_unknown_and_traversal_scene_keys(tmp_path):
    catalog = build_catalog(tmp_path)
    with pytest.raises(SceneNotFoundError):
        catalog.load("../default")
    with pytest.raises(SceneNotFoundError):
        catalog.load("safe-scene")


def test_catalog_loads_typed_scene_and_lidar_frames(tmp_path):
    bundle = build_catalog(tmp_path, label="internal-alias").load("default")
    assert bundle.scene_name == "城市路口侧向超车"
    assert bundle.telemetry[0].speedKmh == 1.0
    assert bundle.perception[0].objects == []
    assert bundle.lidar_index is not None
    assert bundle.lidar_index[0].point_count == 4


def test_catalog_rejects_manifest_asset_outside_public_root(tmp_path):
    catalog = build_catalog(tmp_path)
    manifest = json.loads(catalog.manifest_path.read_text(encoding="utf-8"))
    manifest["scenes"][0]["telemetryFile"] = "../secret.json"
    catalog.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(UnsafeAssetPathError):
        catalog.load("default")


def test_catalog_rejects_lidar_frame_path_outside_public_root(tmp_path):
    catalog = build_catalog(tmp_path)
    index_path = tmp_path / "public" / "scenes" / "default" / "lidar" / "index.json"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    payload["frames"][0]["file"] = "../../../../../secret.bin"
    index_path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(UnsafeAssetPathError):
        catalog.load("default")
