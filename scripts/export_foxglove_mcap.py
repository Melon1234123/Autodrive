#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import math
import os
from pathlib import Path
from typing import Any

from mcap.writer import CompressionType, Writer


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "frontend" / "public"
OUTPUT_DIR = ROOT / "foxglove"
OUTPUT_PATH = OUTPUT_DIR / "autodrive_nuscenes_mini.mcap"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def time_obj(time_s: float) -> dict[str, int]:
    sec = int(time_s)
    nsec = int(round((time_s - sec) * 1_000_000_000))
    return {"sec": sec, "nsec": nsec}


def log_time_ns(time_s: float) -> int:
    return int(round(time_s * 1_000_000_000))


def q_from_yaw(yaw: float) -> dict[str, float]:
    return {"x": 0.0, "y": 0.0, "z": math.sin(yaw / 2.0), "w": math.cos(yaw / 2.0)}


def color_for_risk(risk: str) -> dict[str, float]:
    if risk == "high":
        return {"r": 1.0, "g": 0.23, "b": 0.16, "a": 0.82}
    if risk == "medium":
        return {"r": 1.0, "g": 0.78, "b": 0.22, "a": 0.72}
    return {"r": 0.22, "g": 0.85, "b": 0.48, "a": 0.56}


def pose(x: float, y: float, z: float = 0.0, yaw: float = 0.0) -> dict[str, Any]:
    return {"position": {"x": x, "y": y, "z": z}, "orientation": q_from_yaw(yaw)}


def line(points: list[dict[str, float]], color: dict[str, float], thickness: float, line_type: int = 0) -> dict[str, Any]:
    return {
        "type": line_type,
        "pose": pose(0.0, 0.0, 0.0),
        "thickness": thickness,
        "scale_invariant": False,
        "points": [{"x": p["x"], "y": p["y"], "z": p.get("z", 0.0)} for p in points],
        "color": color,
        "colors": [],
        "indices": [],
    }


def empty_entity(timestamp: dict[str, int], frame_id: str, entity_id: str) -> dict[str, Any]:
    return {
        "timestamp": timestamp,
        "frame_id": frame_id,
        "id": entity_id,
        "lifetime": {"sec": 0, "nsec": 250_000_000},
        "frame_locked": False,
        "metadata": [],
        "arrows": [],
        "cubes": [],
        "spheres": [],
        "cylinders": [],
        "lines": [],
        "triangles": [],
        "texts": [],
        "models": [],
    }


def scene_update(perception: dict[str, Any], telemetry: dict[str, Any]) -> dict[str, Any]:
    timestamp = time_obj(float(perception["time"]))
    entities: list[dict[str, Any]] = []

    ego = empty_entity(timestamp, "ego", "ego_vehicle")
    ego["cubes"].append(
        {
            "pose": pose(0.0, 0.0, 0.8),
            "size": {"x": 4.7, "y": 1.9, "z": 1.6},
            "color": {"r": 0.78, "g": 0.95, "b": 0.32, "a": 0.78},
        }
    )
    ego["texts"].append(
        {
            "pose": pose(0.0, -2.5, 2.2),
            "billboard": True,
            "font_size": 12.0,
            "scale_invariant": True,
            "color": {"r": 0.91, "g": 0.98, "b": 0.83, "a": 1.0},
            "text": f"ego {telemetry['speedKmh']:.1f} km/h",
        }
    )
    entities.append(ego)

    guide = empty_entity(timestamp, "ego", "lane_and_plan")
    for lane in perception.get("lanes", []):
        guide["lines"].append(
            line(
                lane.get("points", []),
                {"r": 0.54, "g": 0.86, "b": 0.62, "a": 0.52},
                0.09,
                1,
            )
        )
    guide["lines"].append(
        line(
            perception.get("plannedPath", []),
            {"r": 0.2, "g": 0.74, "b": 1.0, "a": 0.92},
            0.22,
            0,
        )
    )
    entities.append(guide)

    for index, obj in enumerate(perception.get("objects", [])[:24]):
        entity = empty_entity(timestamp, "ego", f"object_{index}_{obj.get('id', '')}")
        color = color_for_risk(obj.get("risk", "low"))
        entity["metadata"] = [
            {"key": "label", "value": str(obj.get("label", "object"))},
            {"key": "risk", "value": str(obj.get("risk", "low"))},
            {"key": "category", "value": str(obj.get("category", ""))},
        ]
        entity["cubes"].append(
            {
                "pose": pose(float(obj["x"]), float(obj["y"]), max(float(obj.get("height", 1.5)) / 2.0, 0.4), float(obj.get("yaw", 0.0))),
                "size": {
                    "x": max(float(obj.get("length", 4.0)), 0.3),
                    "y": max(float(obj.get("width", 1.8)), 0.3),
                    "z": max(float(obj.get("height", 1.5)), 0.3),
                },
                "color": color,
            }
        )
        if obj.get("risk") != "low":
            entity["texts"].append(
                {
                    "pose": pose(float(obj["x"]), float(obj["y"]), float(obj.get("height", 1.5)) + 1.2),
                    "billboard": True,
                    "font_size": 12.0,
                    "scale_invariant": True,
                    "color": {"r": color["r"], "g": color["g"], "b": color["b"], "a": 1.0},
                    "text": f"{obj.get('label')} {obj.get('risk')}",
                }
            )
        entities.append(entity)

    return {"deletions": [], "entities": entities}


def grid_message(time_s: float) -> dict[str, Any]:
    columns = 80
    rows = 100
    data = bytearray()
    for y in range(rows):
        for x in range(columns):
            lane = abs(x - columns // 2) < 5 or abs(x - columns // 2 - 10) < 2 or abs(x - columns // 2 + 10) < 2
            if lane:
                data.extend([68, 96, 82, 255])
            else:
                shade = 22 + int(12 * (y / rows))
                data.extend([shade, shade + 4, shade, 210])
    return {
        "timestamp": time_obj(time_s),
        "frame_id": "ego",
        "pose": pose(0.0, -40.0, -0.03),
        "column_count": columns,
        "cell_size": {"x": 1.0, "y": 1.0},
        "row_stride": columns * 4,
        "cell_stride": 4,
        "fields": [
            {"name": "red", "offset": 0, "type": 1},
            {"name": "green", "offset": 1, "type": 1},
            {"name": "blue", "offset": 2, "type": 1},
            {"name": "alpha", "offset": 3, "type": 1},
        ],
        "data": base64.b64encode(bytes(data)).decode("ascii"),
    }


def geojson_message(perception: list[dict[str, Any]]) -> dict[str, str]:
    coords = [[frame["ego"]["longitude"], frame["ego"]["latitude"]] for frame in perception]
    feature = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Autodrive ego route", "stroke": "#56c2ff", "stroke-width": 4},
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        ],
    }
    return {"geojson": json.dumps(feature, ensure_ascii=False)}


def resolve_image_path(perception: dict[str, Any], metadata: dict[str, Any]) -> Path:
    if perception.get("imagePath"):
        image_path = Path(str(perception["imagePath"]))
        if image_path.exists():
            return image_path

    image_file = perception.get("imageFile")
    if not image_file:
        raise FileNotFoundError("perception frame does not include imageFile")

    candidates = [
        os.getenv("NUSCENES_DATAROOT"),
        metadata.get("sourceRoot") if metadata.get("sourceRoot") != "NUSCENES_DATAROOT" else None,
        str(Path.home() / "Datasets" / "nuscenes-mini-5gb"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(str(candidate)) / str(image_file)
        if path.exists():
            return path
    raise FileNotFoundError(f"Cannot resolve nuScenes image {image_file!r}; set NUSCENES_DATAROOT.")


SCHEMAS = {
    "foxglove.CompressedImage": {
        "type": "object",
        "properties": {
            "timestamp": {"type": "object"},
            "frame_id": {"type": "string"},
            "data": {"type": "string", "contentEncoding": "base64"},
            "format": {"type": "string"},
        },
        "required": ["timestamp", "frame_id", "data", "format"],
    },
    "foxglove.SceneUpdate": {"type": "object", "properties": {"deletions": {"type": "array"}, "entities": {"type": "array"}}, "required": ["deletions", "entities"]},
    "foxglove.Grid": {"type": "object"},
    "foxglove.GeoJSON": {"type": "object", "properties": {"geojson": {"type": "string"}}, "required": ["geojson"]},
    "foxglove.LocationFix": {"type": "object"},
    "autodrive.Telemetry": {"type": "object"},
}


def register_json_schema(writer: Writer, name: str) -> int:
    schema = {"title": name, **SCHEMAS[name]}
    return writer.register_schema(name=name, encoding="jsonschema", data=json.dumps(schema).encode("utf-8"))


def write_json(writer: Writer, channel_id: int, time_s: float, payload: dict[str, Any]) -> None:
    writer.add_message(
        channel_id=channel_id,
        log_time=log_time_ns(time_s),
        publish_time=log_time_ns(time_s),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    )


def main() -> int:
    telemetry = load_json(PUBLIC_DIR / "telemetry.json")
    perception = load_json(PUBLIC_DIR / "perception.json")
    metadata_path = PUBLIC_DIR / "dataset-meta.json"
    metadata = load_json(metadata_path) if metadata_path.exists() else {}
    if not telemetry or not perception:
        raise SystemExit("telemetry/perception are empty; run convert_nuscenes_rich.py first.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("wb") as stream:
        writer = Writer(stream, compression=CompressionType.ZSTD)
        writer.start(profile="foxglove")
        image_schema = register_json_schema(writer, "foxglove.CompressedImage")
        scene_schema = register_json_schema(writer, "foxglove.SceneUpdate")
        grid_schema = register_json_schema(writer, "foxglove.Grid")
        geo_schema = register_json_schema(writer, "foxglove.GeoJSON")
        fix_schema = register_json_schema(writer, "foxglove.LocationFix")
        telemetry_schema = register_json_schema(writer, "autodrive.Telemetry")

        image_ch = writer.register_channel("/camera/front/compressed", "json", image_schema, {"schemaName": "foxglove.CompressedImage"})
        scene_ch = writer.register_channel("/autodrive/scene", "json", scene_schema, {"schemaName": "foxglove.SceneUpdate"})
        grid_ch = writer.register_channel("/autodrive/map_grid", "json", grid_schema, {"schemaName": "foxglove.Grid"})
        geo_ch = writer.register_channel("/autodrive/map", "json", geo_schema, {"schemaName": "foxglove.GeoJSON"})
        fix_ch = writer.register_channel("/gps/fix", "json", fix_schema, {"schemaName": "foxglove.LocationFix"})
        telemetry_ch = writer.register_channel("/autodrive/telemetry", "json", telemetry_schema)

        write_json(writer, geo_ch, 0.0, geojson_message(perception))
        write_json(writer, grid_ch, 0.0, grid_message(0.0))

        for telem, percep in zip(telemetry, perception):
            time_s = float(telem["time"])
            image_path = resolve_image_path(percep, metadata)
            image_payload = {
                "timestamp": time_obj(time_s),
                "frame_id": "camera_front",
                "data": base64.b64encode(image_path.read_bytes()).decode("ascii"),
                "format": "jpeg",
            }
            write_json(writer, image_ch, time_s, image_payload)
            write_json(writer, telemetry_ch, time_s, telem)
            write_json(writer, scene_ch, time_s, scene_update(percep, telem))
            write_json(
                writer,
                fix_ch,
                time_s,
                {
                    "timestamp": time_obj(time_s),
                    "frame_id": "gps",
                    "latitude": percep["ego"]["latitude"],
                    "longitude": percep["ego"]["longitude"],
                    "altitude": 0.0,
                    "position_covariance": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0],
                    "position_covariance_type": 1,
                    "heading": percep["ego"]["yaw"],
                    "velocity": {"x": float(telem["speedKmh"]) / 3.6, "y": 0.0, "z": 0.0},
                    "color": {"r": 0.78, "g": 0.95, "b": 0.32, "a": 1.0},
                    "metadata": [{"key": "source", "value": "nuScenes mini"}],
                },
            )

        writer.add_metadata(
            "autodrive",
            {
                "source": "nuScenes mini",
                "frames": str(min(len(telemetry), len(perception))),
                "topics": "/camera/front/compressed,/autodrive/telemetry,/autodrive/scene,/autodrive/map,/gps/fix",
            },
        )
        writer.finish()

    print(f"[ok] wrote {OUTPUT_PATH}")
    print(f"[ok] size {OUTPUT_PATH.stat().st_size / 1024 / 1024:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
