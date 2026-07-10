import json
from pathlib import Path

import numpy as np
import pytest

import scripts.export_nuscenes_lidar as exporter
from scripts.export_nuscenes_lidar import crop_and_voxel_downsample, write_lidar_index


def test_crop_and_voxel_downsample_keeps_one_point_per_voxel():
    points = [(1.01, 1.01, 0.0, 0.2), (1.03, 1.02, 0.0, 0.8), (70.0, 0.0, 0.0, 1.0)]
    assert crop_and_voxel_downsample(points, max_range_m=60, voxel_m=0.5) == [(1.01, 1.01, 0.0, 0.2)]


def test_write_lidar_index_uses_relative_frame_paths(tmp_path: Path):
    write_lidar_index(tmp_path, [{"time": 1.0, "timestampUs": 1000000, "file": "frames/000001.bin", "pointCount": 12}])
    assert '"pointFormat": "xyzI-f32-le"' in (tmp_path / "index.json").read_text()


def make_dataset(tmp_path: Path) -> dict[str, Path]:
    dataroot = tmp_path / "dataset"
    version = dataroot / "v1.0-mini"
    version.mkdir(parents=True)
    sources = dataroot / "samples" / "LIDAR_TOP"
    sources.mkdir(parents=True)
    for name, x in (("first.bin", 1.0), ("second.bin", 2.0), ("not-keyframe.bin", 9.0)):
        np.array([(x, 0.0, 0.0, 0.5, 0.0)], dtype=exporter.POINT_DTYPE).tofile(sources / name)
    def dump(name: str, value) -> None:
        (version / name).write_text(json.dumps(value))
    dump("scene.json", [{"name": "scene-test", "first_sample_token": "sample-1"}])
    dump("sample.json", [{"token": "sample-1", "next": "sample-2"}, {"token": "sample-2", "next": ""}])
    dump("ego_pose.json", [{"token": "pose-1"}, {"token": "pose-2"}])
    dump("sensor.json", [{"token": "lidar-sensor", "channel": "LIDAR_TOP"}, {"token": "camera-sensor", "channel": "CAM_FRONT"}])
    dump("calibrated_sensor.json", [{"token": "lidar-cal", "sensor_token": "lidar-sensor"}, {"token": "camera-cal", "sensor_token": "camera-sensor"}])
    dump("sample_data.json", [
        {"token": "lidar-1", "sample_token": "sample-1", "is_key_frame": True, "calibrated_sensor_token": "lidar-cal", "ego_pose_token": "pose-1", "timestamp": 100, "filename": "samples/LIDAR_TOP/first.bin"},
        {"token": "lidar-2", "sample_token": "sample-2", "is_key_frame": True, "calibrated_sensor_token": "lidar-cal", "ego_pose_token": "pose-2", "timestamp": 200, "filename": "samples/LIDAR_TOP/second.bin"},
        {"token": "lidar-sweep", "sample_token": "sample-1", "is_key_frame": False, "calibrated_sensor_token": "lidar-cal", "ego_pose_token": "pose-1", "timestamp": 105, "filename": "samples/LIDAR_TOP/not-keyframe.bin"},
        {"token": "camera", "sample_token": "sample-1", "is_key_frame": True, "calibrated_sensor_token": "camera-cal", "ego_pose_token": "pose-1", "timestamp": 100, "filename": "samples/LIDAR_TOP/not-keyframe.bin"},
    ])
    public = tmp_path / "public"
    public.mkdir()
    perception = public / "perception.json"
    perception.write_text(json.dumps([{"time": 1.0, "timestampUs": 105}, {"time": 2.0, "timestampUs": 195}]))
    manifest = public / "scenes.json"
    manifest.write_text(json.dumps({"scenes": [{"id": "default", "label": "test"}]}))
    return {"dataroot": dataroot, "perception": perception, "manifest": manifest, "output": public / "scenes/default/lidar"}


def run_export(paths: dict[str, Path], **overrides):
    options = dict(dataroot=paths["dataroot"], version="v1.0-mini", scene_name="scene-test", output_dir=paths["output"], perception_path=paths["perception"], manifest_path=paths["manifest"], scene_id="default", max_range_m=60, voxel_m=0.5, max_scene_bytes=exporter.MAX_SCENE_BYTES)
    options.update(overrides)
    return exporter.export_lidar(**options)


def test_export_uses_only_lidar_top_keyframes_and_nearest_timestamps(tmp_path: Path):
    paths = make_dataset(tmp_path)
    frames, total_bytes = run_export(paths)
    index = json.loads((paths["output"] / "index.json").read_text())
    assert frames == 2 and total_bytes == sum(path.stat().st_size for path in paths["output"].rglob("*") if path.is_file())
    assert [frame["file"] for frame in index["frames"]] == ["frames/000000.bin", "frames/000001.bin"]
    assert [frame["pointCount"] for frame in index["frames"]] == [1, 1]
    assert np.fromfile(paths["output"] / "frames/000000.bin", dtype="<f4").tolist() == [1.0, 0.0, 0.0, 0.5]
    assert json.loads(paths["manifest"].read_text())["scenes"][0]["lidarIndexFile"] == "/scenes/default/lidar/index.json"


def test_export_fails_when_real_lidar_source_is_missing(tmp_path: Path):
    paths = make_dataset(tmp_path)
    (paths["dataroot"] / "samples/LIDAR_TOP/second.bin").unlink()
    with pytest.raises(FileNotFoundError, match="Required LIDAR_TOP source file is missing"):
        run_export(paths)


def test_export_rejects_total_output_including_index_before_publishing(tmp_path: Path):
    paths = make_dataset(tmp_path)
    paths["output"].mkdir(parents=True)
    (paths["output"] / "old.txt").write_text("keep")
    before_manifest = paths["manifest"].read_text()
    with pytest.raises(ValueError, match="exceeding"):
        run_export(paths, max_scene_bytes=1)
    assert (paths["output"] / "old.txt").read_text() == "keep"
    assert paths["manifest"].read_text() == before_manifest


def test_manifest_failure_restores_existing_output(tmp_path: Path, monkeypatch):
    paths = make_dataset(tmp_path)
    paths["output"].mkdir(parents=True)
    (paths["output"] / "old.txt").write_text("keep")
    monkeypatch.setattr(exporter, "atomic_write_text", lambda *_: (_ for _ in ()).throw(OSError("manifest unavailable")))
    with pytest.raises(OSError, match="manifest unavailable"):
        run_export(paths)
    assert (paths["output"] / "old.txt").read_text() == "keep"
