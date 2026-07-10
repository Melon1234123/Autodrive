#!/usr/bin/env python3
"""Export real nuScenes LIDAR_TOP keyframes for the cockpit's LiDAR viewer."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterable

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATAROOT = Path(os.getenv("NUSCENES_DATAROOT", str(Path.home() / "Datasets" / "nuscenes-mini-5gb")))
POINT_DTYPE = np.dtype(
    [("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("intensity", "<f4"), ("ring", "<f4")]
)
POINT_FORMAT = "xyzI-f32-le"
MAX_SCENE_BYTES = 50 * 1024 * 1024


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as source:
            return json.load(source)
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Required nuScenes metadata file is missing: {path}") from exc


def table_by_token(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row["token"]): row for row in rows}


def find_version_dir(dataroot: Path, version: str) -> Path:
    direct = dataroot / version
    if direct.is_dir():
        return direct
    matches = sorted(dataroot.glob("v1.0-*"))
    if len(matches) == 1:
        return matches[0]
    raise FileNotFoundError(f"Cannot find nuScenes metadata version {version!r} under {dataroot}")


def find_scene(scenes: list[dict[str, Any]], scene_name: str) -> dict[str, Any]:
    for scene in scenes:
        if scene.get("name") == scene_name or scene.get("token") == scene_name:
            return scene
    raise ValueError(f"nuScenes scene {scene_name!r} was not found")


def walk_scene_samples(scene: dict[str, Any], samples_by_token: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    token = str(scene.get("first_sample_token") or "")
    seen: set[str] = set()
    while token:
        if token in seen:
            raise ValueError(f"Scene {scene.get('name')!r} has a cyclic sample chain")
        try:
            sample = samples_by_token[token]
        except KeyError as exc:
            raise ValueError(f"Scene references missing sample token {token}") from exc
        seen.add(token)
        samples.append(sample)
        token = str(sample.get("next") or "")
    if not samples:
        raise ValueError(f"Scene {scene.get('name')!r} has no samples")
    return samples


def crop_and_voxel_downsample(points, max_range_m: float, voxel_m: float):
    """Keep the first xyzi point in each occupied voxel inside the cockpit view."""
    if max_range_m <= 0 or voxel_m <= 0:
        raise ValueError("max_range_m and voxel_m must be positive")
    kept, occupied = [], set()
    max_range_squared = max_range_m * max_range_m
    for x, y, z, intensity in points:
        if x * x + y * y > max_range_squared or z < -3.0 or z > 3.0:
            continue
        voxel = (math.floor(x / voxel_m), math.floor(y / voxel_m), math.floor(z / voxel_m))
        if voxel not in occupied:
            occupied.add(voxel)
            kept.append((x, y, z, intensity))
    return kept


def write_lidar_index(output_dir: Path, frames: list[dict[str, Any]]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    index = {"version": 1, "pointFormat": POINT_FORMAT, "frames": frames}
    (output_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def nearest_lidar(lidar_frames: list[dict[str, Any]], timestamp_us: int) -> dict[str, Any]:
    return min(lidar_frames, key=lambda frame: abs(int(frame["timestamp"]) - timestamp_us))


def load_perception_frames(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path)
    if not isinstance(payload, list) or not payload:
        raise ValueError(f"Perception input must be a non-empty JSON list: {path}")
    frames: list[dict[str, Any]] = []
    for index, frame in enumerate(payload):
        if not isinstance(frame, dict) or "time" not in frame or "timestampUs" not in frame:
            raise ValueError(f"Perception frame {index} must contain time and timestampUs")
        frames.append(frame)
    return frames


def update_manifest(manifest_path: Path, scene_id: str, lidar_index_file: str) -> None:
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("scenes"), list):
        raise ValueError(f"Scene manifest must contain a scenes list: {manifest_path}")
    for scene in manifest["scenes"]:
        if scene.get("id") == scene_id:
            scene["lidarIndexFile"] = lidar_index_file
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return
    raise ValueError(f"Scene id {scene_id!r} was not found in manifest {manifest_path}")


def export_lidar(
    dataroot: Path,
    version: str,
    scene_name: str,
    output_dir: Path,
    perception_path: Path,
    manifest_path: Path,
    scene_id: str,
    max_range_m: float,
    voxel_m: float,
    max_scene_bytes: int,
) -> tuple[int, int]:
    version_dir = find_version_dir(dataroot, version)
    scenes = load_json(version_dir / "scene.json")
    samples_by_token = table_by_token(load_json(version_dir / "sample.json"))
    sample_data = load_json(version_dir / "sample_data.json")
    ego_poses_by_token = table_by_token(load_json(version_dir / "ego_pose.json"))
    calibrated_sensors_by_token = table_by_token(load_json(version_dir / "calibrated_sensor.json"))
    sensors_by_token = table_by_token(load_json(version_dir / "sensor.json"))
    scene = find_scene(scenes, scene_name)
    perception_frames = load_perception_frames(perception_path)

    lidar_keyframes: list[dict[str, Any]] = []
    for sample in walk_scene_samples(scene, samples_by_token):
        candidates = []
        for sample_data_row in sample_data:
            if sample_data_row.get("sample_token") != sample["token"] or not sample_data_row.get("is_key_frame"):
                continue
            calibration = calibrated_sensors_by_token.get(sample_data_row.get("calibrated_sensor_token"), {})
            sensor = sensors_by_token.get(calibration.get("sensor_token"), {})
            if sensor.get("channel") == "LIDAR_TOP":
                candidates.append(sample_data_row)
        if len(candidates) != 1:
            raise ValueError(f"Sample {sample['token']} does not contain a LIDAR_TOP keyframe")
        lidar = candidates[0]
        if lidar.get("ego_pose_token") not in ego_poses_by_token:
            raise ValueError(f"LIDAR_TOP sample data {lidar['token']} references a missing ego pose")
        source_path = dataroot / str(lidar.get("filename") or "")
        if not source_path.is_file():
            raise FileNotFoundError(f"Required LIDAR_TOP source file is missing: {source_path}")
        lidar_keyframes.append({"token": lidar["token"], "timestamp": int(lidar["timestamp"]), "source": source_path})
    if not lidar_keyframes:
        raise ValueError(f"Scene {scene_name!r} has no LIDAR_TOP keyframes")

    try:
        public_relative = output_dir.resolve().relative_to(manifest_path.parent.resolve())
    except ValueError as exc:
        raise ValueError("output-dir must be inside the manifest's public directory") from exc
    lidar_index_file = "/" + (public_relative / "index.json").as_posix()

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary_dir = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}-", dir=output_dir.parent))
    try:
        frames_dir = temporary_dir / "frames"
        frames_dir.mkdir()
        exported: dict[str, tuple[str, int]] = {}
        for lidar in lidar_keyframes:
            points = np.fromfile(lidar["source"], dtype=POINT_DTYPE)
            reduced = crop_and_voxel_downsample(
                ((float(point["x"]), float(point["y"]), float(point["z"]), float(point["intensity"])) for point in points),
                max_range_m=max_range_m,
                voxel_m=voxel_m,
            )
            filename = f"{len(exported):06d}.bin"
            relative_file = f"frames/{filename}"
            values = np.asarray(reduced, dtype="<f4").reshape((-1, 4)) if reduced else np.empty((0, 4), dtype="<f4")
            values.tofile(frames_dir / filename)
            exported[lidar["token"]] = (relative_file, len(reduced))

        total_bytes = sum(path.stat().st_size for path in frames_dir.glob("*.bin"))
        if total_bytes > max_scene_bytes:
            raise ValueError(f"LiDAR export is {total_bytes} bytes, exceeding the {max_scene_bytes}-byte scene limit")

        index_frames = []
        for perception in perception_frames:
            lidar = nearest_lidar(lidar_keyframes, int(perception["timestampUs"]))
            relative_file, point_count = exported[lidar["token"]]
            index_frames.append(
                {
                    "time": float(perception["time"]),
                    "timestampUs": int(perception["timestampUs"]),
                    "file": relative_file,
                    "pointCount": point_count,
                }
            )
        write_lidar_index(temporary_dir, index_frames)
        if output_dir.exists():
            shutil.rmtree(output_dir)
        temporary_dir.replace(output_dir)
        update_manifest(manifest_path, scene_id, lidar_index_file)
        return len(index_frames), total_bytes
    except Exception:
        shutil.rmtree(temporary_dir, ignore_errors=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataroot", type=Path, default=DEFAULT_DATAROOT)
    parser.add_argument("--version", default="v1.0-mini")
    parser.add_argument("--scene", required=True, help="nuScenes scene name or token")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--perception", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--scene-id", required=True)
    parser.add_argument("--max-range-m", type=float, default=60.0)
    parser.add_argument("--voxel-m", type=float, default=0.5)
    parser.add_argument("--max-scene-bytes", type=int, default=MAX_SCENE_BYTES)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frame_count, total_bytes = export_lidar(
        dataroot=args.dataroot.resolve(),
        version=args.version,
        scene_name=args.scene,
        output_dir=args.output_dir.resolve(),
        perception_path=args.perception.resolve(),
        manifest_path=args.manifest.resolve(),
        scene_id=args.scene_id,
        max_range_m=args.max_range_m,
        voxel_m=args.voxel_m,
        max_scene_bytes=args.max_scene_bytes,
    )
    print(f"[ok] exported {frame_count} timeline frames ({total_bytes / 1024 / 1024:.2f} MiB) to {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
