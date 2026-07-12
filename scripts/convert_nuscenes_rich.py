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


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATAROOT = Path(os.getenv("NUSCENES_DATAROOT", str(Path.home() / "Datasets" / "nuscenes-mini-5gb")))
DEFAULT_OUTPUT_DIR = ROOT / "frontend" / "public"
DEFAULT_FFMPEG = Path("/tmp/autodrive-video/node_modules/ffmpeg-static/ffmpeg")


@dataclass
class FrameRecord:
    time: float
    timestamp_us: int
    sample_token: str
    sample_data_token: str
    image_path: Path
    ego_pose: dict[str, Any] | None
    camera_calibration: dict[str, Any] | None
    image_width: int
    image_height: int
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
    raise FileNotFoundError(f"Cannot find {version} under {dataroot}")


def load_tables(version_dir: Path) -> dict[str, Any]:
    names = ["scene", "sample", "sample_data", "ego_pose", "sample_annotation", "category", "instance", "calibrated_sensor", "sensor"]
    return {name: load_json(version_dir / f"{name}.json") for name in names}


def yaw_from_quaternion(rotation: list[float] | None) -> float:
    if not rotation or len(rotation) != 4:
        return 0.0
    w, x, y, z = rotation
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def rotation_matrix(rotation: list[float] | None) -> list[list[float]]:
    if not rotation or len(rotation) != 4:
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    w, x, y, z = [float(value) for value in rotation]
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def mat_vec(matrix: list[list[float]], vector: list[float]) -> list[float]:
    return [
        matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
        matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
        matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
    ]


def mat_t_vec(matrix: list[list[float]], vector: list[float]) -> list[float]:
    return [
        matrix[0][0] * vector[0] + matrix[1][0] * vector[1] + matrix[2][0] * vector[2],
        matrix[0][1] * vector[0] + matrix[1][1] * vector[1] + matrix[2][1] * vector[2],
        matrix[0][2] * vector[0] + matrix[1][2] * vector[1] + matrix[2][2] * vector[2],
    ]


def sub_vec(a: list[float], b: list[float]) -> list[float]:
    return [float(a[0]) - float(b[0]), float(a[1]) - float(b[1]), float(a[2]) - float(b[2])]


def normalize_angle(angle: float) -> float:
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle < -math.pi:
        angle += 2 * math.pi
    return angle


def rotate_xy(x: float, y: float, yaw: float) -> tuple[float, float]:
    c = math.cos(yaw)
    s = math.sin(yaw)
    return c * x - s * y, s * x + c * y


def box_corners_global(annotation: dict[str, Any]) -> list[list[float]]:
    width, length, height = [float(value) for value in (annotation.get("size") or [1.8, 4.2, 1.6])]
    local_corners = [
        [length / 2, width / 2, height / 2],
        [length / 2, -width / 2, height / 2],
        [length / 2, -width / 2, -height / 2],
        [length / 2, width / 2, -height / 2],
        [-length / 2, width / 2, height / 2],
        [-length / 2, -width / 2, height / 2],
        [-length / 2, -width / 2, -height / 2],
        [-length / 2, width / 2, -height / 2],
    ]
    center = [float(value) for value in (annotation.get("translation") or [0.0, 0.0, 0.0])]
    box_rotation = rotation_matrix(annotation.get("rotation"))
    return [
        [
            center[0] + rotated[0],
            center[1] + rotated[1],
            center[2] + rotated[2],
        ]
        for rotated in (mat_vec(box_rotation, corner) for corner in local_corners)
    ]


def global_to_camera(
    point: list[float],
    ego_pose: dict[str, Any] | None,
    camera_calibration: dict[str, Any] | None,
) -> list[float] | None:
    if not ego_pose or not camera_calibration:
        return None
    ego_translation = [float(value) for value in (ego_pose.get("translation") or [0.0, 0.0, 0.0])]
    sensor_translation = [float(value) for value in (camera_calibration.get("translation") or [0.0, 0.0, 0.0])]
    ego_rotation = rotation_matrix(ego_pose.get("rotation"))
    sensor_rotation = rotation_matrix(camera_calibration.get("rotation"))
    point_ego = mat_t_vec(ego_rotation, sub_vec(point, ego_translation))
    return mat_t_vec(sensor_rotation, sub_vec(point_ego, sensor_translation))


def project_camera_box(annotation: dict[str, Any], frame: FrameRecord) -> dict[str, Any] | None:
    calibration = frame.camera_calibration
    intrinsic = calibration.get("camera_intrinsic") if calibration else None
    if not intrinsic:
        return None

    projected: list[tuple[float, float, float]] = []
    for corner in box_corners_global(annotation):
        camera_point = global_to_camera(corner, frame.ego_pose, calibration)
        if camera_point is None:
            return None
        z = camera_point[2]
        if z <= 0.25:
            continue
        u = (intrinsic[0][0] * camera_point[0] + intrinsic[0][2] * z) / z
        v = (intrinsic[1][1] * camera_point[1] + intrinsic[1][2] * z) / z
        projected.append((u, v, z))

    if len(projected) < 3:
        return None

    xs = [point[0] for point in projected]
    ys = [point[1] for point in projected]
    min_x = max(0.0, min(xs))
    max_x = min(float(frame.image_width), max(xs))
    min_y = max(0.0, min(ys))
    max_y = min(float(frame.image_height), max(ys))
    width = max_x - min_x
    height = max_y - min_y
    if width < 4 or height < 4:
        return None
    return {
        "x": round(min_x, 2),
        "y": round(min_y, 2),
        "width": round(width, 2),
        "height": round(height, 2),
        "imageWidth": frame.image_width,
        "imageHeight": frame.image_height,
        "depth": round(min(point[2] for point in projected), 2),
    }


def local_xy(point: list[float], ego_pose: dict[str, Any] | None) -> tuple[float, float, float]:
    if not ego_pose:
        return 0.0, 0.0, 0.0
    ego_translation = ego_pose.get("translation") or [0.0, 0.0, 0.0]
    dx = float(point[0]) - float(ego_translation[0])
    dy = float(point[1]) - float(ego_translation[1])
    dz = float(point[2]) - float(ego_translation[2]) if len(point) > 2 else 0.0
    return (*rotate_xy(dx, dy, -yaw_from_quaternion(ego_pose.get("rotation"))), dz)


def annotation_category(
    annotation: dict[str, Any],
    categories_by_token: dict[str, dict[str, Any]],
    instances_by_token: dict[str, dict[str, Any]],
) -> str:
    category_token = annotation.get("category_token")
    if not category_token:
        instance = instances_by_token.get(annotation.get("instance_token", ""), {})
        category_token = instance.get("category_token")
    category = categories_by_token.get(category_token or "", {})
    return category.get("name", "")


def label_for_category(name: str) -> str:
    if "pedestrian" in name:
        return "行人"
    if "bicycle" in name:
        return "自行车"
    if "motorcycle" in name:
        return "摩托车"
    if "truck" in name:
        return "卡车"
    if "bus" in name:
        return "公交"
    if "trailer" in name:
        return "挂车"
    if "traffic_cone" in name:
        return "锥桶"
    if "barrier" in name:
        return "路障"
    if name.startswith("vehicle."):
        return "车辆"
    return name.split(".")[-1] if name else "目标"


def walk_scene_samples(scene: dict[str, Any], samples_by_token: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    token = scene.get("first_sample_token")
    seen: set[str] = set()
    while token and token not in seen:
        seen.add(token)
        sample = samples_by_token[token]
        samples.append(sample)
        token = sample.get("next") or ""
    return samples


def scene_score(
    scene: dict[str, Any],
    samples_by_token: dict[str, dict[str, Any]],
    annotations_by_sample: dict[str, list[dict[str, Any]]],
    camera_keyframes_by_sample: dict[str, dict[str, Any]],
) -> int:
    samples = walk_scene_samples(scene, samples_by_token)
    score = len(samples) * 3
    for sample in samples:
        if sample["token"] not in camera_keyframes_by_sample:
            continue
        anns = annotations_by_sample.get(sample["token"], [])
        score += min(len(anns), 40)
    return score


def choose_scene(
    tables: dict[str, Any],
    scene_name: str | None,
    annotations_by_sample: dict[str, list[dict[str, Any]]],
    camera_keyframes_by_sample: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    scenes = tables["scene"]
    samples_by_token = table_by_token(tables["sample"])
    if scene_name:
        for scene in scenes:
            if scene.get("name") == scene_name or scene.get("token") == scene_name:
                return scene
        raise ValueError(f"Scene {scene_name!r} not found.")
    return max(scenes, key=lambda scene: scene_score(scene, samples_by_token, annotations_by_sample, camera_keyframes_by_sample))


def resolve_image_path(dataroot: Path, sample_data: dict[str, Any]) -> Path:
    path = dataroot / sample_data["filename"]
    if not path.exists():
        raise FileNotFoundError(path)
    return path


def collect_camera_frames(
    dataroot: Path,
    scene: dict[str, Any],
    tables: dict[str, Any],
    camera: str,
    max_frames: int | None,
    use_sweeps: bool,
    annotations_by_sample: dict[str, list[dict[str, Any]]],
) -> list[FrameRecord]:
    samples_by_token = table_by_token(tables["sample"])
    sample_data_by_token = table_by_token(tables["sample_data"])
    ego_pose_by_token = table_by_token(tables["ego_pose"])
    calibrated_by_token = table_by_token(tables["calibrated_sensor"])
    camera_keyframes_by_sample = camera_keyframes(tables, camera)
    samples = walk_scene_samples(scene, samples_by_token)

    key_camera: list[dict[str, Any]] = []
    key_times: list[tuple[int, str]] = []
    for sample in samples:
        cam = camera_keyframes_by_sample.get(sample["token"])
        if not cam:
            continue
        timestamp = int(cam.get("timestamp") or sample.get("timestamp") or 0)
        key_camera.append(cam)
        key_times.append((timestamp, sample["token"]))

    if not key_camera:
        raise ValueError(f"No {camera} frames in scene {scene.get('name')}")

    camera_records: list[dict[str, Any]] = []
    if use_sweeps:
        token = key_camera[0]["token"]
        end_time = int(key_camera[-1].get("timestamp") or 0)
        seen: set[str] = set()
        while token and token not in seen:
            seen.add(token)
            cam = sample_data_by_token[token]
            timestamp = int(cam.get("timestamp") or 0)
            if timestamp > end_time:
                break
            camera_records.append(cam)
            token = cam.get("next") or ""
            if max_frames and len(camera_records) >= max_frames:
                break
    else:
        camera_records = key_camera[:max_frames]

    first_timestamp = int(camera_records[0].get("timestamp") or 0)
    frames: list[FrameRecord] = []
    for cam in camera_records:
        timestamp = int(cam.get("timestamp") or 0)
        nearest_sample_token = min(key_times, key=lambda item: abs(item[0] - timestamp))[1]
        frames.append(
            FrameRecord(
                time=(timestamp - first_timestamp) / 1_000_000.0,
                timestamp_us=timestamp,
                sample_token=nearest_sample_token,
                sample_data_token=cam["token"],
                image_path=resolve_image_path(dataroot, cam),
                ego_pose=ego_pose_by_token.get(cam.get("ego_pose_token", "")),
                camera_calibration=calibrated_by_token.get(cam.get("calibrated_sensor_token", "")),
                image_width=int(cam.get("width") or 1600),
                image_height=int(cam.get("height") or 900),
                annotations=annotations_by_sample.get(nearest_sample_token, []),
            )
        )
    return frames


def camera_keyframes(tables: dict[str, Any], camera: str) -> dict[str, dict[str, Any]]:
    calibrated_by_token = table_by_token(tables["calibrated_sensor"])
    sensors_by_token = table_by_token(tables["sensor"])
    result: dict[str, dict[str, Any]] = {}
    for row in tables["sample_data"]:
        calibrated = calibrated_by_token.get(row.get("calibrated_sensor_token", ""), {})
        sensor = sensors_by_token.get(calibrated.get("sensor_token", ""), {})
        if sensor.get("channel") == camera and row.get("is_key_frame"):
            result[row["sample_token"]] = row
    return result


def speed_kmh(prev_pose: dict[str, Any] | None, pose: dict[str, Any] | None, dt: float) -> float:
    if not prev_pose or not pose or dt <= 0:
        return 0.0
    p0 = prev_pose.get("translation") or [0.0, 0.0, 0.0]
    p1 = pose.get("translation") or [0.0, 0.0, 0.0]
    return math.hypot(float(p1[0]) - float(p0[0]), float(p1[1]) - float(p0[1])) / dt * 3.6


def steering(prev_pose: dict[str, Any] | None, pose: dict[str, Any] | None) -> float:
    if not prev_pose or not pose:
        return 0.0
    yaw0 = yaw_from_quaternion(prev_pose.get("rotation"))
    yaw1 = yaw_from_quaternion(pose.get("rotation"))
    return min(max(normalize_angle(yaw1 - yaw0) / 0.32, -1.0), 1.0)


def controls(speed: float, previous_speed: float | None, dt: float) -> tuple[float, float, float]:
    if previous_speed is None or dt <= 0:
        return 0.0, 0.16 if speed > 1 else 0.0, 0.0
    accel = ((speed - previous_speed) / 3.6) / dt
    brake = min(max(-accel / 4.5, 0.0), 1.0)
    throttle = min(max(accel / 3.5, 0.0), 1.0)
    if speed > 4 and brake < 0.04 and throttle < 0.04:
        throttle = 0.14
    return brake, throttle, accel


def scene_text(
    frame: FrameRecord,
    categories_by_token: dict[str, dict[str, Any]],
    instances_by_token: dict[str, dict[str, Any]],
) -> str:
    categories = [annotation_category(ann, categories_by_token, instances_by_token) for ann in frame.annotations]
    humans = sum(1 for name in categories if "pedestrian" in name)
    vehicles = sum(1 for name in categories if name.startswith("vehicle."))
    cones = sum(1 for name in categories if "traffic_cone" in name or "barrier" in name)
    parts = ["nuScenes mini 连续前视实景"]
    if humans:
        parts.append(f"前方/周边标注到 {humans} 个行人")
    if vehicles:
        parts.append(f"可见 {vehicles} 个车辆目标")
    if cones:
        parts.append(f"道路边界/锥桶目标 {cones} 个")
    if len(parts) == 1:
        parts.append("当前帧未标注近距离重点目标")
    return "，".join(parts)


def build_telemetry(
    frames: list[FrameRecord],
    categories_by_token: dict[str, dict[str, Any]],
    instances_by_token: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    telemetry: list[dict[str, Any]] = []
    prev_frame: FrameRecord | None = None
    prev_speed: float | None = None
    for frame in frames:
        dt = frame.time - prev_frame.time if prev_frame else 0.0
        speed = speed_kmh(prev_frame.ego_pose if prev_frame else None, frame.ego_pose, dt)
        brake, throttle, accel = controls(speed, prev_speed, dt)
        value = {
            "time": round(frame.time, 3),
            "speedKmh": round(speed, 2),
            "brake": round(brake, 3),
            "throttle": round(throttle, 3),
            "steering": round(steering(prev_frame.ego_pose if prev_frame else None, frame.ego_pose), 3),
            "accel": round(accel, 3),
            "scene": scene_text(frame, categories_by_token, instances_by_token),
        }
        telemetry.append(value)
        prev_frame = frame
        prev_speed = float(value["speedKmh"])
    return telemetry


def object_risk(category_name: str, x: float, y: float) -> str:
    distance = math.hypot(x, y)
    if x > 0 and abs(y) < 3.2 and distance < 18:
        return "high"
    if "pedestrian" in category_name and x > 0 and abs(y) < 8.0 and distance < 35:
        return "high"
    if x > 0 and abs(y) < 9.0 and distance < 38:
        return "medium"
    return "low"


def lane_lines(steer: float) -> list[dict[str, Any]]:
    lanes: list[dict[str, Any]] = []
    for lane_id, offset in [("left", -3.6), ("ego", 0.0), ("right", 3.6)]:
        points = []
        for index in range(22):
            x = index * 4.2
            points.append({"x": round(x, 3), "y": round(offset + steer * x * x / 540.0, 3), "z": 0.03})
        lanes.append({"id": lane_id, "points": points})
    return lanes


def planned_path(steer: float, speed: float) -> list[dict[str, float]]:
    horizon = max(42.0, min(92.0, speed * 1.85 + 30.0))
    return [
        {"x": round(horizon * i / 21.0, 3), "y": round(steer * (horizon * i / 21.0) ** 2 / 360.0, 3), "z": 0.09}
        for i in range(22)
    ]


def build_perception(
    frames: list[FrameRecord],
    telemetry: list[dict[str, Any]],
    categories_by_token: dict[str, dict[str, Any]],
    instances_by_token: dict[str, dict[str, Any]],
    dataroot: Path,
) -> list[dict[str, Any]]:
    origin_pose = frames[0].ego_pose or {}
    origin_translation = origin_pose.get("translation") or [0.0, 0.0, 0.0]
    origin_yaw = yaw_from_quaternion(origin_pose.get("rotation"))
    base_lat = 42.336849
    base_lon = -71.057853
    perception: list[dict[str, Any]] = []

    for index, frame in enumerate(frames):
        ego_pose = frame.ego_pose or {}
        ego_translation = ego_pose.get("translation") or [0.0, 0.0, 0.0]
        map_x, map_y = rotate_xy(
            float(ego_translation[0]) - float(origin_translation[0]),
            float(ego_translation[1]) - float(origin_translation[1]),
            -origin_yaw,
        )
        ego_yaw = yaw_from_quaternion(ego_pose.get("rotation"))
        row = telemetry[index]
        objects = []
        for annotation in frame.annotations:
            category = annotation_category(annotation, categories_by_token, instances_by_token)
            x, y, z = local_xy(annotation.get("translation") or [0.0, 0.0, 0.0], frame.ego_pose)
            if x < -16 or x > 105 or abs(y) > 38:
                continue
            size = annotation.get("size") or [1.8, 4.2, 1.6]
            risk = object_risk(category, x, y)
            obj = {
                "id": annotation.get("instance_token") or annotation.get("token"),
                "label": label_for_category(category),
                "category": category,
                "x": round(x, 3),
                "y": round(y, 3),
                "z": round(z, 3),
                "width": round(float(size[0]), 3),
                "length": round(float(size[1]), 3),
                "height": round(float(size[2]), 3),
                "yaw": round(normalize_angle(yaw_from_quaternion(annotation.get("rotation")) - ego_yaw), 3),
                "risk": risk,
            }
            camera_box = project_camera_box(annotation, frame)
            if camera_box:
                obj["cameraBox"] = camera_box
            objects.append(obj)
        objects.sort(key=lambda obj: math.hypot(float(obj["x"]), float(obj["y"])))
        try:
            image_file = str(frame.image_path.relative_to(dataroot))
        except ValueError:
            image_file = frame.image_path.name

        perception.append(
            {
                "time": row["time"],
                "timestampUs": frame.timestamp_us,
                "sampleToken": frame.sample_token,
                "sampleDataToken": frame.sample_data_token,
                "imageFile": image_file,
                "ego": {
                    "x": round(map_x, 3),
                    "y": round(map_y, 3),
                    "yaw": round(normalize_angle(ego_yaw - origin_yaw), 3),
                    "latitude": round(base_lat + map_y / 111_111.0, 8),
                    "longitude": round(base_lon + map_x / (111_111.0 * math.cos(math.radians(base_lat))), 8),
                },
                "objects": objects[:28],
                "lanes": lane_lines(float(row["steering"])),
                "plannedPath": planned_path(float(row["steering"]), float(row["speedKmh"])),
            }
        )
    return perception


def find_ffmpeg(explicit: str | None) -> str:
    candidates = [
        explicit,
        os.getenv("IMAGEIO_FFMPEG_EXE"),
        str(DEFAULT_FFMPEG) if DEFAULT_FFMPEG.exists() else None,
        shutil.which("ffmpeg"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise FileNotFoundError("ffmpeg not found. Pass --ffmpeg /path/to/ffmpeg.")


def write_video(frames: list[FrameRecord], output_path: Path, source_fps: float, render_fps: float, ffmpeg: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="autodrive-rich-") as tmp:
        tmp_dir = Path(tmp)
        for index, frame in enumerate(frames):
            suffix = frame.image_path.suffix.lower() or ".jpg"
            target = tmp_dir / f"frame_{index:06d}{suffix}"
            try:
                os.symlink(frame.image_path, target)
            except OSError:
                shutil.copy2(frame.image_path, target)
        suffix = frames[0].image_path.suffix.lower() or ".jpg"
        command = [
            ffmpeg,
            "-y",
            "-framerate",
            str(source_fps),
            "-i",
            str(tmp_dir / f"frame_%06d{suffix}"),
            "-vf",
            f"scale=1600:-2,minterpolate=fps={render_fps:g}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        subprocess.run(command, check=True)


def write_outputs(
    output_dir: Path,
    scene: dict[str, Any],
    dataroot: Path,
    telemetry: list[dict[str, Any]],
    perception: list[dict[str, Any]],
    source_fps: float,
    render_fps: float,
    use_sweeps: bool,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "telemetry.json").open("w", encoding="utf-8") as f:
        json.dump(telemetry, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with (output_dir / "perception.json").open("w", encoding="utf-8") as f:
        json.dump(perception, f, ensure_ascii=False, indent=2)
        f.write("\n")
    metadata = {
        "sourceType": "nuScenes",
        "sourceLabel": f"nuScenes mini {scene.get('name', scene.get('token', 'scene'))}",
        "sceneName": scene.get("name"),
        "sceneDescription": scene.get("description", ""),
        "sampleCount": len(telemetry),
        "perceptionCount": len(perception),
        "fps": render_fps,
        "telemetryFps": source_fps,
        "videoFps": render_fps,
        "frameMode": "continuous CAM_FRONT sample_data sweeps" if use_sweeps else "2Hz key samples",
        "videoFile": "sample.mp4",
        "telemetryFile": "telemetry.json",
        "perceptionFile": "perception.json",
        "sourceRoot": "NUSCENES_DATAROOT",
        "fieldProvenance": {
            "camera": "real: nuScenes mini CAM_FRONT sample_data images",
            "objects": "real-derived: nearest nuScenes keyframe sample_annotation boxes, transformed to ego frame",
            "ego": "real: nuScenes ego_pose transformed to local map frame",
            "time": "real: CAM_FRONT sample_data timestamp",
            "speedKmh": "estimated: ego_pose translation delta",
            "brake": "estimated: negative speed delta",
            "throttle": "estimated: positive speed delta or cruise placeholder",
            "steering": "estimated: ego_pose yaw delta",
            "lanes": "demo visualization: generated lane guides from steering",
            "plannedPath": "demo visualization: generated path from speed and steering",
        },
        "notes": [
            "Front camera frames are real nuScenes mini images.",
            "3D object boxes are derived from nuScenes sample annotations at nearest keyframes.",
            "Lane guides and planned path are visualization overlays, not nuScenes HD map ground truth.",
            "nuScenes mini does not include CAN bus by default; control signals are estimated for demo diagnosis.",
        ],
    }
    with (output_dir / "dataset-meta.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        f.write("\n")


def update_scene_manifest(manifest_path: Path, output_dir: Path, scene: dict[str, Any], scene_id: str | None) -> None:
    """Upsert this converted scene in the frontend scene switcher manifest."""
    safe_id = scene_id or str(scene.get("name") or scene.get("token") or "scene")
    safe_id = "".join(char if char.isalnum() or char in "-_" else "-" for char in safe_id).strip("-") or "scene"
    try:
        relative_dir = output_dir.resolve().relative_to(manifest_path.parent.resolve())
    except ValueError as error:
        raise ValueError("--output-dir must be inside the directory containing --manifest.") from error
    relative_prefix = relative_dir.as_posix().strip("/")
    prefix = f"/{relative_prefix}" if relative_prefix and relative_prefix != "." else ""
    paths = {name: f"{prefix}/{name}" for name in ("sample.mp4", "telemetry.json", "perception.json", "dataset-meta.json")}
    entry = {
        "id": safe_id,
        "label": f"nuScenes {scene.get('name', safe_id)}",
        "description": scene.get("description", ""),
        "videoFile": paths["sample.mp4"],
        "telemetryFile": paths["telemetry.json"],
        "perceptionFile": paths["perception.json"],
        "metadataFile": paths["dataset-meta.json"],
    }
    manifest: dict[str, Any] = {"version": 1, "defaultSceneId": safe_id, "scenes": []}
    if manifest_path.exists():
        manifest = load_json(manifest_path)
        manifest.setdefault("version", 1)
        manifest.setdefault("defaultSceneId", safe_id)
        manifest.setdefault("scenes", [])
    manifest["scenes"] = [item for item in manifest["scenes"] if item.get("id") != safe_id] + [entry]
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a richer Autodrive demo from nuScenes mini.")
    parser.add_argument("--dataroot", type=Path, default=DEFAULT_DATAROOT)
    parser.add_argument("--version", default="v1.0-mini")
    parser.add_argument("--scene", help="nuScenes scene name/token. Default chooses a dense scene automatically.")
    parser.add_argument("--camera", default="CAM_FRONT")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--manifest", type=Path, help="Upsert the converted scene into this frontend scenes.json manifest.")
    parser.add_argument("--scene-id", help="Stable id used by --manifest (defaults to the nuScenes scene name).")
    parser.add_argument("--fps", type=float, default=12.0, help="Source image sequence FPS used to preserve the real scene duration.")
    parser.add_argument("--render-fps", type=float, default=24.0, help="MP4 output FPS after motion interpolation for smoother playback.")
    parser.add_argument("--max-frames", type=int, default=360)
    parser.add_argument("--keyframes-only", action="store_true")
    parser.add_argument("--ffmpeg")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dataroot = args.dataroot.resolve()
    version_dir = find_version_dir(dataroot, args.version)
    tables = load_tables(version_dir)
    categories_by_token = table_by_token(tables["category"])
    annotations_by_sample: dict[str, list[dict[str, Any]]] = {}
    for annotation in tables["sample_annotation"]:
        annotations_by_sample.setdefault(annotation["sample_token"], []).append(annotation)

    camera_keyframes_by_sample = camera_keyframes(tables, args.camera)
    scene = choose_scene(tables, args.scene, annotations_by_sample, camera_keyframes_by_sample)
    instances_by_token = table_by_token(tables["instance"])
    frames = collect_camera_frames(
        dataroot=dataroot,
        scene=scene,
        tables=tables,
        camera=args.camera,
        max_frames=args.max_frames,
        use_sweeps=not args.keyframes_only,
        annotations_by_sample=annotations_by_sample,
    )
    telemetry = build_telemetry(frames, categories_by_token, instances_by_token)
    perception = build_perception(frames, telemetry, categories_by_token, instances_by_token, dataroot)
    render_fps = max(args.render_fps, args.fps)
    write_outputs(args.output_dir.resolve(), scene, dataroot, telemetry, perception, args.fps, render_fps, not args.keyframes_only)
    write_video(frames, args.output_dir.resolve() / "sample.mp4", args.fps, render_fps, find_ffmpeg(args.ffmpeg))
    if args.manifest:
        update_scene_manifest(args.manifest.resolve(), args.output_dir.resolve(), scene, args.scene_id)

    print(f"[ok] scene: {scene.get('name')} - {scene.get('description', '')}")
    print(f"[ok] telemetry frames: {len(frames)} at {args.fps:g} FPS")
    print(f"[ok] rendered video: {render_fps:g} FPS")
    print(f"[ok] wrote: {args.output_dir.resolve() / 'sample.mp4'}")
    print(f"[ok] wrote: {args.output_dir.resolve() / 'telemetry.json'}")
    print(f"[ok] wrote: {args.output_dir.resolve() / 'perception.json'}")
    print(f"[ok] wrote: {args.output_dir.resolve() / 'dataset-meta.json'}")
    if args.manifest:
        print(f"[ok] updated scene manifest: {args.manifest.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
