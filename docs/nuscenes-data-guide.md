# nuScenes 公开数据复现指南

本项目当前已经可以用 `sample.mp4 + telemetry.json + React 前端 + Python WebSocket 后端` 跑通智驾诊断闭环。为了更接近飞书原方案，可以把本地模拟数据替换成 nuScenes mini 或完整 nuScenes scene 转换出的公开数据。

## 为什么选 nuScenes

飞书原方案的数据形态是自动驾驶回放数据：前向相机画面、车辆状态、目标/场景信息，再由前端面板把当前帧发给 Python AI 后端诊断。nuScenes 是公开自动驾驶数据集，包含多相机图像、ego pose、3D annotations，也有可选 CAN bus expansion。它不能完全等价于项目里的 `.mcap`，但能公开复现“真实道路数据回放 + 当前帧诊断”的核心链路。

## 需要下载的数据

最低可用：

- nuScenes mini metadata：`v1.0-mini/*.json`
- nuScenes mini samples：至少需要 `samples/CAM_FRONT/*.jpg`

建议额外下载：

- nuScenes CAN bus expansion，用于尽量提取车辆速度、加速度、转向等车辆状态。

下载后建议放在仓库外，例如：

```text
$HOME/Datasets/nuscenes/
  v1.0-mini/
    scene.json
    sample.json
    sample_data.json
    ego_pose.json
    sample_annotation.json
    category.json
  samples/
    CAM_FRONT/
      n015-2018-07-18-11-07-57+0800__CAM_FRONT__...

$HOME/Datasets/nuscenes-canbus/
  can_bus/
    scene-0061_vehicle_monitor.json
    scene-0061_pose.json
    scene-0061_steeranglefeedback.json
```

不要把 nuScenes 原始数据放进 Git 仓库。

## 转换命令

在仓库根目录运行：

```bash
cd /path/to/Autodrive
backend/.venv/bin/python scripts/convert_nuscenes.py \
  --dataroot "$HOME/Datasets/nuscenes" \
  --version v1.0-mini \
  --scene scene-0061 \
  --can-bus-root "$HOME/Datasets/nuscenes-canbus" \
  --max-frames 40
```

## 5GB 内实景演示方案

如果只需要少量实景画面演示，不想下载完整 `v1.0-mini.tgz`，可以使用本项目的小数据转换脚本：

```bash
cd /path/to/Autodrive
backend/.venv/bin/python scripts/convert_hf_nuscenes_qa.py \
  --parquet "$HOME/Datasets/nuscenes-lite/qa-day-train-0.parquet" \
  --max-frames 40
```

这个方案使用公开 Hugging Face `KevinNotSmile/nuscenes-qa-mini` 的小 shard。它的 CAM_FRONT 图像是真实
nuScenes 实景图像，但该 shard 没有 CAN bus 或 ego pose，所以 `speedKmh`、`brake`、`throttle`、
`steering`、`accel` 是为了前端演示估算出来的占位信号。转换后页面会显示数据源为
`nuScenes QA mini 实景子集`。

输出会覆盖：

```text
frontend/public/sample.mp4
frontend/public/telemetry.json
frontend/public/dataset-meta.json
```

如果本机没有系统 `ffmpeg`，脚本仍会生成 `telemetry.json` 和 `dataset-meta.json`，但会提示跳过视频。可以通过 `--ffmpeg /path/to/ffmpeg` 指定可执行文件。

只想恢复 demo 元信息时：

```bash
backend/.venv/bin/python scripts/convert_nuscenes.py --metadata-only
```

转换生成的 `frontend/public/sample.mp4` 可能会变大，仓库的 `.gitignore` 已默认忽略 `frontend/public/*.mp4`。本地演示可以继续使用它，但不要把大型转换视频提交到 Git。

## 字段来源

前端继续使用兼容字段：

```json
{
  "time": 0.0,
  "speedKmh": 18.5,
  "brake": 0.0,
  "throttle": 0.22,
  "steering": 0.01,
  "accel": 0.8,
  "scene": "..."
}
```

字段来源：

- `time`：来自 CAM_FRONT `sample_data.timestamp`。
- `scene`：根据 `sample_annotation + category` 汇总行人、车辆、两轮车等目标。
- `speedKmh`：优先来自 CAN bus；没有 CAN bus 时由相邻帧 `ego_pose.translation` 推算。
- `accel`：优先来自 CAN bus；没有 CAN bus 时由速度差推算。
- `steering`：优先来自 CAN bus；没有 CAN bus 时由相邻帧 ego yaw 变化估算。
- `brake` / `throttle`：优先来自 CAN bus；没有 CAN bus 时根据加减速估算，平稳巡航会使用低油门占位。

转换脚本会在终端输出字段 provenance，并写入 `frontend/public/dataset-meta.json`，前端页面会显示当前数据源。

CAN bus expansion 不同版本的文件命名可能略有差异。脚本会优先查找以下形式：

```text
<can-bus-root>/<scene>.json
<can-bus-root>/can_bus/<scene>_vehicle_monitor.json
<can-bus-root>/can_bus/<scene>_pose.json
<can-bus-root>/can_bus/<scene>_steeranglefeedback.json
```

如果没有找到 CAN bus 文件，脚本不会中断，会退回到 ego pose 和 annotations 估算，并在日志里说明哪些字段是估算或占位。

## 和飞书 Foxglove/.mcap 方案的差距

相似点：

- 都是自动驾驶数据回放。
- 都在当前帧读取车辆/场景状态。
- 都通过 WebSocket 把当前帧发送给 Python 后端。
- 后端都支持 DeepSeek / OpenAI-compatible 模型诊断。

差距：

- 本项目前端是普通 React 页面，不是 Foxglove 自定义 Panel。
- 当前数据输出是 `sample.mp4 + telemetry.json`，不是 `.mcap topic`。
- nuScenes 图像和 telemetry 的时间同步由转换脚本做静态对齐，不是 Foxglove runtime topic 同步。
- 没有 CAN bus expansion 时，刹车、油门、转向等控制量只能估算或占位。

## 后续升级到 Foxglove/.mcap

1. 将 nuScenes 或项目真实数据转换为 `.mcap`，至少包含 camera image topic、ego state topic、annotation/risk topic。
2. 把 `frontend/src/App.tsx` 中的普通页面逻辑迁移到 Foxglove custom panel。
3. Panel 从 Foxglove subscribe 当前 timestamp 附近 topic，组装与现在一致的 frame JSON。
4. 继续复用 `backend/server.py` 的 WebSocket `/ws` 协议。
5. 如果要保留普通网页 Demo，可以让 Foxglove Panel 与当前 React 页面共享 telemetry schema 和诊断结果 schema。
