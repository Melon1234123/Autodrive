#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PARQUET = Path(os.getenv("NUSCENES_QA_PARQUET", str(Path.home() / "Datasets" / "nuscenes-lite" / "qa-day-train-0.parquet")))
DEFAULT_OUTPUT_DIR = ROOT / "frontend" / "public"
DEFAULT_FFMPEG = Path("/tmp/autodrive-video/node_modules/ffmpeg-static/ffmpeg")


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


def image_from_array(array: Any) -> Image.Image:
    image = Image.fromarray(np.asarray(array, dtype=np.uint8))
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def scene_label(question: str, answer: str) -> str:
    q = question.strip().replace("\n", " ")
    a = answer.strip().replace("\n", " ")
    if len(a) > 120:
        a = a[:117] + "..."
    if q:
        return f"nuScenes 实景帧，问答标注：{q}；答案：{a}"
    return f"nuScenes 实景帧，标注：{a}" if a else "nuScenes 实景前向相机画面"


def synthetic_telemetry(index: int, total: int, question: str, answer: str) -> dict[str, Any]:
    time_s = index * 0.5
    phase = index / max(total - 1, 1)
    speed = 18 + 20 * math.sin(min(phase, 1.0) * math.pi)
    brake = 0.08
    throttle = 0.26
    steering = 0.18 * math.sin(index / 3.0)
    accel = 0.35 * math.cos(index / 4.0)

    text = f"{question} {answer}".lower()
    if any(word in text for word in ["pedestrian", "traffic cone", "barrier", "bus", "trailer"]):
        brake = max(brake, 0.22)
        throttle = min(throttle, 0.18)
    if "pedestrian" in text or "traffic cone" in text:
        speed = min(speed, 28)
        scene = scene_label(question, answer) + "，前方存在需要重点关注的动态或静态目标"
    else:
        scene = scene_label(question, answer)

    return {
        "time": round(time_s, 2),
        "speedKmh": round(speed, 2),
        "brake": round(brake, 2),
        "throttle": round(throttle, 2),
        "steering": round(steering, 3),
        "accel": round(accel, 3),
        "scene": scene,
    }


def run_ffmpeg(image_pattern: Path, fps: float, output_path: Path, ffmpeg: str) -> None:
    command = [
        ffmpeg,
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(image_pattern),
        "-vf",
        "scale=1280:-2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    subprocess.run(command, check=True)


def convert(parquet_path: Path, output_dir: Path, max_frames: int, fps: float, ffmpeg: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    table = pq.read_table(parquet_path, columns=["token", "CAM_FRONT", "question", "answer"])
    count = min(max_frames, table.num_rows)

    telemetry = []
    with tempfile.TemporaryDirectory(prefix="autodrive-hf-nuscenes-") as tmp:
        tmp_dir = Path(tmp)
        for index in range(count):
            row = table.slice(index, 1)
            data = row.to_pydict()
            image = image_from_array(data["CAM_FRONT"][0])
            image.save(tmp_dir / f"frame_{index:06d}.jpg", quality=92)
            telemetry.append(
                synthetic_telemetry(
                    index=index,
                    total=count,
                    question=data["question"][0] or "",
                    answer=data["answer"][0] or "",
                )
            )

        run_ffmpeg(tmp_dir / "frame_%06d.jpg", fps, output_dir / "sample.mp4", ffmpeg)

    with (output_dir / "telemetry.json").open("w", encoding="utf-8") as f:
        json.dump(telemetry, f, ensure_ascii=False, indent=2)
        f.write("\n")

    metadata = {
        "sourceType": "nuScenes",
        "sourceLabel": "nuScenes QA mini 实景子集",
        "sceneName": "huggingface-KevinNotSmile/nuscenes-qa-mini-day-train-0",
        "sceneDescription": "Real nuScenes CAM_FRONT image frames from a small public Hugging Face parquet shard.",
        "sampleCount": count,
        "videoFile": "sample.mp4",
        "telemetryFile": "telemetry.json",
        "sourceRoot": "NUSCENES_QA_PARQUET",
        "fieldProvenance": {
            "time": "derived: fixed 2 FPS frame index",
            "speedKmh": "estimated placeholder for demo",
            "brake": "estimated placeholder from QA scene text",
            "throttle": "estimated placeholder from QA scene text",
            "steering": "estimated placeholder sinusoidal demo signal",
            "accel": "estimated placeholder demo signal",
            "scene": "real-derived: nuScenes QA question/answer text",
        },
        "notes": [
            "CAM_FRONT video frames are real nuScenes images.",
            "This small public shard does not include CAN bus or ego pose, so vehicle state fields are estimated placeholders.",
            "For stronger telemetry, use scripts/convert_nuscenes.py with official nuScenes mini plus ego_pose/CAN bus data.",
        ],
    }
    with (output_dir / "dataset-meta.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[ok] wrote {output_dir / 'sample.mp4'}")
    print(f"[ok] wrote {output_dir / 'telemetry.json'}")
    print(f"[ok] wrote {output_dir / 'dataset-meta.json'}")
    print(f"[info] frames: {count}, source: {parquet_path}")
    print("[info] video frames are real nuScenes CAM_FRONT images; telemetry is estimated because this shard has no CAN bus.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a small Hugging Face nuScenes QA parquet shard into Autodrive demo inputs.")
    parser.add_argument("--parquet", type=Path, default=DEFAULT_PARQUET)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--max-frames", type=int, default=40)
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()

    convert(
        parquet_path=args.parquet.resolve(),
        output_dir=args.output_dir.resolve(),
        max_frames=args.max_frames,
        fps=args.fps,
        ffmpeg=find_ffmpeg(args.ffmpeg),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
