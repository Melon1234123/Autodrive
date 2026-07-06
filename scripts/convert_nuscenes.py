#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parents[1] / "frontend" / "public"
DEFAULT_SAMPLE_FPS = 2.0


@dataclass
class FrameRecord:
    time: float
    timestamp_us: int
    image_path: Path
    ego_pose: dict[str, Any] | None
    annotations: list[dict[str, Any]]


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def table_by_token(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {row["token"]: row for row in rows}


def find_version_dir(dataroot: Path, version: str) -> Path:
    direct = dataroot / version
    if direct.is_dir():
        return direct

    matches = sorted(dataroot.glob("v1.0-*"))
    if len(matches) == 1:
        return matches[0]

    raise FileNotFoundError(
        f"Cannot find nuScenes metadata directory {direct}. "
        "Pass --version v1.0-mini or point --dataroot at the nuScenes root."
    )


def load_tables(version_dir: Path) -> dict[str, Any]:
    required = [
        "scene",
        "sample",
        "sample_data",
        "ego_pose",
        "sample_annotation",
        "category",
    ]
    tables: dict[str, Any] = {}
    for name in required:
        path = version_dir / f"{name}.json"
        if not path.exists():
            raise FileNotFoundError(f"Missing required nuScenes table: {path}")
        tables[name] = load_json(path)
    return tables


def choose_scene(scenes: list[dict[str, Any]], scene_name: str | None) -> dict[str, Any]:
    if not scenes:
        raise ValueError("nuScenes scene table is empty.")

    if scene_name:
        for scene in scenes:
            if scene.get("name") == scene_name or scene.get("token") == scene_name:
                return scene
        names = ", ".join(scene.get("name", scene.get("token", "")) for scene in scenes[:8])
        raise ValueError(f"Scene {scene_name!r} not found. First scenes: {names}")

    return scenes[0]


def walk_scene_samples(scene: dict[str, Any], samples_by_token: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    token = scene.get("first_sample_token")
    samples: list[dict[str, Any]] = []
    visited: set[str] = set()

    while token and token not in visited:
        visited.add(token)
        sample = samples_by_token[token]
        samples.append(sample)
        token = sample.get("next") or ""

    return samples


def resolve_image_path(dataroot: Path, sample_data: dict[str, Any]) -> Path:
    filename = sample_data.get("filename")
    if not filename:
        raise ValueError(f"sample_data {sample_data.get('token')} has no filename.")
    path = dataroot / filename
    if not path.exists():
        raise FileNotFoundError(f"Missing CAM_FRONT image file: {path}")
    return path


def yaw_from_quaternion(rotation: list[float] | None) -> float:
    if not rotation or len(rotation) != 4:
        return 0.0

    w, x, y, z = rotation
    siny_cosp = 2.0 * (w * z + x * y)
    cosy_cosp = 1.0 - 2.0 * (y * y + z * z)
    return math.atan2(siny_cosp, cosy_cosp)


def normalize_angle(angle: float) -> float:
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle < -math.pi:
        angle += 2 * math.pi
    return angle


def speed_kmh(prev_pose: dict[str, Any] | None, pose: dict[str, Any] | None, dt: float) -> float:
    if not prev_pose or not pose or dt <= 0:
        return 0.0

    p0 = prev_pose.get("translation") or [0, 0, 0]
    p1 = pose.get("translation") or [0, 0, 0]
    dx = float(p1[0]) - float(p0[0])
    dy = float(p1[1]) - float(p0[1])
    return math.sqrt(dx * dx + dy * dy) / dt * 3.6


def estimate_brake_throttle(speed: float, prev_speed: float | None, dt: float) -> tuple[float, float, float]:
    if prev_speed is None or dt <= 0:
        return 0.0, 0.18 if speed > 1 else 0.0, 0.0

    accel_ms2 = ((speed - prev_speed) / 3.6) / dt
    brake = min(max(-accel_ms2 / 4.0, 0.0), 1.0)
    throttle = min(max(accel_ms2 / 3.0, 0.0), 1.0)

    if speed > 3 and throttle < 0.05 and brake < 0.05:
        throttle = 0.16

    return brake, throttle, accel_ms2


def estimate_steering(prev_pose: dict[str, Any] | None, pose: dict[str, Any] | None) -> float:
    if not prev_pose or not pose:
        return 0.0

    yaw0 = yaw_from_quaternion(prev_pose.get("rotation"))
    yaw1 = yaw_from_quaternion(pose.get("rotation"))
    # Map roughly +/- 0.35 rad heading change to normalized steering +/- 1.
    return min(max(normalize_angle(yaw1 - yaw0) / 0.35, -1.0), 1.0)


def annotation_category(annotation: dict[str, Any], categories_by_token: dict[str, dict[str, Any]]) -> str:
    category_token = annotation.get("category_token")
    category = categories_by_token.get(category_token or "", {})
    return category.get("name", "")


def scene_text(frame: FrameRecord, categories_by_token: dict[str, dict[str, Any]]) -> str:
    categories = [annotation_category(ann, categories_by_token) for ann in frame.annotations]
    human_count = sum(1 for name in categories if "human.pedestrian" in name)
    vehicle_count = sum(1 for name in categories if name.startswith("vehicle."))
    bike_count = sum(1 for name in categories if "bicycle" in name or "motorcycle" in name)

    parts = ["nuScenes CAM_FRONT 当前帧"]
    if human_count:
        parts.append(f"前方标注到 {human_count} 个行人")
    if vehicle_count:
        parts.append(f"可见 {vehicle_count} 个车辆目标")
    if bike_count:
        parts.append(f"可见 {bike_count} 个两轮车目标")
    if len(parts) == 1:
        parts.append("前向图像未匹配到重点动态目标")

    return "，".join(parts)


def build_frames(
    dataroot: Path,
    scene: dict[str, Any],
    tables: dict[str, Any],
    camera_channel: str,
    max_frames: int | None,
) -> list[FrameRecord]:
    samples_by_token = table_by_token(tables["sample"])
    sample_data_by_token = table_by_token(tables["sample_data"])
    ego_pose_by_token = table_by_token(tables["ego_pose"])

    annotations_by_sample: dict[str, list[dict[str, Any]]] = {}
    for annotation in tables["sample_annotation"]:
        annotations_by_sample.setdefault(annotation["sample_token"], []).append(annotation)

    samples = walk_scene_samples(scene, samples_by_token)
    frames: list[FrameRecord] = []
    first_timestamp: int | None = None

    for sample in samples:
        data = sample.get("data") or {}
        camera_token = data.get(camera_channel)
        if not camera_token:
            continue

        camera_data = sample_data_by_token[camera_token]
        image_path = resolve_image_path(dataroot, camera_data)
        timestamp = int(camera_data.get("timestamp") or sample.get("timestamp") or 0)
        if first_timestamp is None:
            first_timestamp = timestamp

        ego_pose = ego_pose_by_token.get(camera_data.get("ego_pose_token", ""))
        frame = FrameRecord(
            time=(timestamp - first_timestamp) / 1_000_000.0,
            timestamp_us=timestamp,
            image_path=image_path,
            ego_pose=ego_pose,
            annotations=annotations_by_sample.get(sample["token"], []),
        )
        frames.append(frame)
        if max_frames and len(frames) >= max_frames:
            break

    if not frames:
        raise ValueError(f"No frames found for channel {camera_channel} in scene {scene.get('name')}.")

    return frames


def load_can_bus(can_bus_root: Path | None, scene_name: str) -> dict[str, list[dict[str, Any]]]:
    if not can_bus_root:
        return {}

    def message_name(path: Path) -> str:
        stem = path.stem
        prefix = f"{scene_name}_"
        if stem.startswith(prefix):
            return stem[len(prefix) :]
        if stem == scene_name:
            return "raw"
        return stem.replace(scene_name, "").strip("_-") or "raw"

    search_roots = [
        can_bus_root,
        can_bus_root / "can_bus",
        can_bus_root / "scene",
        can_bus_root / "vehicle_monitor",
    ]

    data: dict[str, list[dict[str, Any]]] = {}
    candidates: list[Path] = []
    for root in search_roots:
        if not root.exists():
            continue
        candidates.extend(sorted(root.glob(f"{scene_name}.json")))
        candidates.extend(sorted(root.glob(f"{scene_name}_*.json")))
        candidates.extend(sorted(root.glob(f"{scene_name}-*.json")))

    seen: set[Path] = set()
    for path in candidates:
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        try:
            payload = load_json(path)
            if isinstance(payload, dict):
                added = False
                for key, value in payload.items():
                    if isinstance(value, list):
                        data[key] = value
                        added = True
                if not added:
                    data.setdefault(message_name(path), []).append(payload)
            elif isinstance(payload, list):
                data[message_name(path)] = payload
        except Exception as exc:
            print(f"[warn] Failed to parse CAN bus file {path}: {exc}", file=sys.stderr)

    if data:
        message_names = ", ".join(sorted(data.keys()))
        print(f"[info] Loaded CAN bus expansion from {can_bus_root}: {message_names}")
    return data


def numeric_value(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list) and value and all(isinstance(item, (int, float)) for item in value[:3]):
        numbers = [float(item) for item in value[:3]]
        return math.sqrt(sum(item * item for item in numbers))
    if isinstance(value, dict):
        for key in ("value", "x", "longitudinal", "vehicle_speed"):
            nested = numeric_value(value.get(key))
            if nested is not None:
                return nested
    return None


def nearest_can_value(rows: list[dict[str, Any]], timestamp_us: int, keys: list[str]) -> float | None:
    if not rows:
        return None

    best = min(rows, key=lambda row: abs(int(row.get("utime") or row.get("timestamp") or 0) - timestamp_us))
    for key in keys:
        value = numeric_value(best.get(key))
        if value is not None:
            return value
    return None


def can_overrides(can_data: dict[str, list[dict[str, Any]]], timestamp_us: int) -> dict[str, float]:
    values: dict[str, float] = {}
    vehicle_rows = (
        can_data.get("vehicle_monitor")
        or can_data.get("zoesensors")
        or can_data.get("raw")
        or []
    )
    pose_rows = can_data.get("pose") or []
    steering_rows = can_data.get("steeranglefeedback") or can_data.get("steering") or []

    speed = nearest_can_value(
        vehicle_rows + pose_rows,
        timestamp_us,
        ["vehicle_speed", "speed", "speed_kph", "vel", "velocity"],
    )
    if speed is not None:
        values["speedKmh"] = speed if speed > 7 else speed * 3.6

    brake = nearest_can_value(
        vehicle_rows,
        timestamp_us,
        ["brake", "brake_input", "brake_pressed", "brakepedal", "brake_pressure"],
    )
    if brake is not None:
        values["brake"] = min(max(brake, 0.0), 1.0)

    throttle = nearest_can_value(
        vehicle_rows,
        timestamp_us,
        ["throttle", "throttle_input", "accelerator_pedal", "pedal_gas", "gas"],
    )
    if throttle is not None:
        values["throttle"] = min(max(throttle, 0.0), 1.0)

    steering = nearest_can_value(
        vehicle_rows + pose_rows + steering_rows,
        timestamp_us,
        ["steering", "steering_angle", "steering_rate", "angle", "value"],
    )
    if steering is not None:
        values["steering"] = min(max(steering / 450.0 if abs(steering) > 1 else steering, -1.0), 1.0)

    accel = nearest_can_value(
        vehicle_rows + pose_rows,
        timestamp_us,
        ["accel", "linear_accel", "linear_acceleration", "accel_x", "acceleration"],
    )
    if accel is not None:
        values["accel"] = accel

    return values


def build_telemetry(
    frames: list[FrameRecord],
    categories_by_token: dict[str, dict[str, Any]],
    can_data: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    telemetry: list[dict[str, Any]] = []
    provenance = {
        "time": "real: CAM_FRONT sample_data timestamp",
        "speedKmh": "estimated: ego_pose translation delta",
        "brake": "estimated: negative longitudinal speed delta",
        "throttle": "estimated: positive longitudinal speed delta or cruise placeholder",
        "steering": "estimated: ego_pose yaw delta",
        "accel": "estimated: speed delta",
        "scene": "real-derived: sample annotations category summary",
    }

    previous_frame: FrameRecord | None = None
    previous_speed: float | None = None

    for frame in frames:
        dt = frame.time - previous_frame.time if previous_frame else 0.0
        speed = speed_kmh(previous_frame.ego_pose if previous_frame else None, frame.ego_pose, dt)
        brake, throttle, accel = estimate_brake_throttle(speed, previous_speed, dt)
        steering = estimate_steering(previous_frame.ego_pose if previous_frame else None, frame.ego_pose)

        values = {
            "time": round(frame.time, 3),
            "speedKmh": round(speed, 2),
            "brake": round(brake, 3),
            "throttle": round(throttle, 3),
            "steering": round(steering, 3),
            "accel": round(accel, 3),
            "scene": scene_text(frame, categories_by_token),
        }

        overrides = can_overrides(can_data, frame.timestamp_us)
        for key, value in overrides.items():
            values[key] = round(value, 3)
            provenance[key] = "real: nuScenes CAN bus expansion nearest timestamp"

        telemetry.append(values)
        previous_frame = frame
        previous_speed = float(values["speedKmh"])

    return telemetry, provenance


def find_ffmpeg(explicit: str | None) -> str | None:
    if explicit:
        return explicit
    env_path = os.getenv("IMAGEIO_FFMPEG_EXE")
    if env_path:
        return env_path
    return shutil.which("ffmpeg")


def write_video_ffmpeg(frames: list[FrameRecord], output_path: Path, fps: float, ffmpeg: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="autodrive-nuscenes-") as tmp:
        tmp_dir = Path(tmp)
        for index, frame in enumerate(frames):
            suffix = frame.image_path.suffix.lower() or ".jpg"
            target = tmp_dir / f"frame_{index:06d}{suffix}"
            try:
                os.symlink(frame.image_path, target)
            except OSError:
                shutil.copy2(frame.image_path, target)

        first_suffix = frames[0].image_path.suffix.lower() or ".jpg"
        pattern = str(tmp_dir / f"frame_%06d{first_suffix}")
        command = [
            ffmpeg,
            "-y",
            "-framerate",
            str(fps),
            "-i",
            pattern,
            "-vf",
            "scale=1280:-2",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        subprocess.run(command, check=True)


def write_metadata(
    output_dir: Path,
    scene: dict[str, Any],
    telemetry_count: int,
    provenance: dict[str, str],
    source_root: Path,
    video_path: Path,
) -> None:
    metadata = {
        "sourceType": "nuScenes",
        "sourceLabel": f"nuScenes {scene.get('name', scene.get('token', 'scene'))}",
        "sceneName": scene.get("name"),
        "sceneDescription": scene.get("description", ""),
        "sampleCount": telemetry_count,
        "videoFile": video_path.name,
        "telemetryFile": "telemetry.json",
        "sourceRoot": "NUSCENES_DATAROOT",
        "fieldProvenance": provenance,
        "notes": [
            "time comes from CAM_FRONT timestamps.",
            "scene text is summarized from nuScenes annotations.",
            "speed/accel/steering are estimated from ego_pose unless CAN bus data overrides them.",
            "brake/throttle are estimated unless CAN bus data provides compatible fields.",
        ],
    }
    with (output_dir / "dataset-meta.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        f.write("\n")


def write_demo_metadata(output_dir: Path) -> None:
    metadata = {
        "sourceType": "demo",
        "sourceLabel": "demo 模拟数据",
        "sceneName": "synthetic-local-demo",
        "sceneDescription": "Small generated driving-style video with hand-authored telemetry.",
        "sampleCount": None,
        "videoFile": "sample.mp4",
        "telemetryFile": "telemetry.json",
        "fieldProvenance": {
            "time": "demo: hand-authored",
            "speedKmh": "demo: hand-authored",
            "brake": "demo: hand-authored",
            "throttle": "demo: hand-authored",
            "steering": "demo: hand-authored",
            "accel": "demo: hand-authored",
            "scene": "demo: hand-authored",
        },
    }
    with (output_dir / "dataset-meta.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        f.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a local nuScenes scene into Autodrive sample.mp4 + telemetry.json.",
    )
    parser.add_argument("--dataroot", type=Path, help="nuScenes root containing v1.0-mini and samples/...")
    parser.add_argument("--version", default="v1.0-mini", help="nuScenes version directory, default v1.0-mini")
    parser.add_argument("--scene", help="scene name or token, default first scene in the table")
    parser.add_argument("--camera", default="CAM_FRONT", help="Camera channel, default CAM_FRONT")
    parser.add_argument("--can-bus-root", type=Path, help="Optional nuScenes CAN bus expansion root")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output dir, default frontend/public")
    parser.add_argument("--video-name", default="sample.mp4", help="Output video filename")
    parser.add_argument("--fps", type=float, default=DEFAULT_SAMPLE_FPS, help="Output video FPS")
    parser.add_argument("--max-frames", type=int, help="Limit frame count for a smaller demo")
    parser.add_argument("--ffmpeg", help="Path to ffmpeg executable. If omitted, uses PATH or IMAGEIO_FFMPEG_EXE.")
    parser.add_argument("--metadata-only", action="store_true", help="Write demo dataset-meta.json only.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.metadata_only:
        write_demo_metadata(output_dir)
        print(f"[ok] Wrote demo metadata to {output_dir / 'dataset-meta.json'}")
        return 0

    if args.dataroot is None:
        raise SystemExit("--dataroot is required unless --metadata-only is used.")

    dataroot = args.dataroot.resolve()
    version_dir = find_version_dir(dataroot, args.version)
    tables = load_tables(version_dir)
    scene = choose_scene(tables["scene"], args.scene)
    categories_by_token = table_by_token(tables["category"])
    frames = build_frames(dataroot, scene, tables, args.camera, args.max_frames)

    scene_name = scene.get("name") or scene.get("token") or "unknown-scene"
    can_data = load_can_bus(args.can_bus_root.resolve() if args.can_bus_root else None, scene_name)
    telemetry, provenance = build_telemetry(frames, categories_by_token, can_data)

    telemetry_path = output_dir / "telemetry.json"
    with telemetry_path.open("w", encoding="utf-8") as f:
        json.dump(telemetry, f, ensure_ascii=False, indent=2)
        f.write("\n")

    ffmpeg = find_ffmpeg(args.ffmpeg)
    video_path = output_dir / args.video_name
    if ffmpeg:
        write_video_ffmpeg(frames, video_path, args.fps, ffmpeg)
        video_status = f"wrote {video_path}"
    else:
        video_status = "skipped video: ffmpeg not found. Pass --ffmpeg or install ffmpeg."
        print(f"[warn] {video_status}", file=sys.stderr)

    write_metadata(output_dir, scene, len(telemetry), provenance, dataroot, video_path)

    print(f"[ok] nuScenes scene: {scene_name}")
    print(f"[ok] telemetry: {telemetry_path} ({len(telemetry)} frames)")
    print(f"[ok] video: {video_status}")
    print("[info] Field provenance:")
    for key, value in provenance.items():
        print(f"  - {key}: {value}")
    if not can_data:
        print("[info] CAN bus expansion not loaded; brake/throttle are estimated placeholders.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
