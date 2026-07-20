#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC="$ROOT/frontend/public"
DATASET="${NUSCENES_DATAROOT:-$HOME/Datasets/nuscenes-mini-5gb}"
PYTHON="${PYTHON_BIN:-$ROOT/backend/.venv/bin/python}"

[[ -d "$DATASET/v1.0-mini" ]] || {
  print -u2 "Missing nuScenes mini at $DATASET"
  exit 2
}
[[ -x "$PYTHON" ]] || {
  print -u2 "Run ./dakai once to create backend/.venv"
  exit 2
}

# The left side is the authored frontend id; the right side is the nuScenes id.
# Do not pass --manifest to convert_nuscenes_rich.py: scenes.json owns the
# Chinese labels and descriptions. The LiDAR exporter only refreshes each
# scene's lidarIndexFile while retaining those authored fields.
scene_pairs=(
  "default:scene-0796"
  "scene-0061:scene-0061"
  "scene-0103:scene-0103"
  "scene-0553:scene-0553"
  "scene-0655:scene-0655"
  "scene-0757:scene-0757"
  "scene-0916:scene-0916"
  "scene-1077:scene-1077"
  "scene-1094:scene-1094"
  "scene-1100:scene-1100"
)

for pair in "${scene_pairs[@]}"; do
  scene_id="${pair%%:*}"
  nu_scene="${pair##*:}"
  output="$PUBLIC/scenes/$scene_id"
  [[ "$scene_id" == "default" ]] && output="$PUBLIC"

  "$PYTHON" "$ROOT/scripts/convert_nuscenes_rich.py" \
    --dataroot "$DATASET" \
    --scene "$nu_scene" \
    --output-dir "$output" \
    --fps 12 \
    --render-fps 24 \
    --max-frames 360

  "$PYTHON" "$ROOT/scripts/export_nuscenes_lidar.py" \
    --dataroot "$DATASET" \
    --scene "$nu_scene" \
    --perception "$output/perception.json" \
    --manifest "$PUBLIC/scenes.json" \
    --scene-id "$scene_id" \
    --output-dir "$PUBLIC/scenes/$scene_id/lidar" \
    --include-sweeps
done
