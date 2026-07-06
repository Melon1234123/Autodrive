# Autodrive

自动驾驶本地演示与复现资料。

## 文档

- [Windows 本地视频 + AI 诊断复现方案](docs/windows-local-ai-demo.md)
- [nuScenes 公开数据复现指南](docs/nuscenes-data-guide.md)
- [Foxglove + MCAP 实景演示指南](docs/foxglove-mcap-guide.md)

## 快速说明

当前 Demo 保持 `frontend/public/sample.mp4 + frontend/public/telemetry.json + FastAPI WebSocket`
链路可运行，同时新增 `scripts/convert_nuscenes.py`，可把本地 nuScenes mini / scene 转换为同样的前端输入格式。

如果只需要 5GB 内的实景演示，可以使用 `scripts/convert_hf_nuscenes_qa.py`，它读取一个公开
Hugging Face nuScenes QA mini parquet shard，生成真实 CAM_FRONT 画面的 `sample.mp4`，同时用轻量估算
telemetry 保持前端链路可演示。

当前更推荐的高完成度演示是 nuScenes mini：

```bash
cd Autodrive
./dakai
```

停止服务：

```bash
./guandiao
```

如果 `$HOME/Datasets/nuscenes-mini-5gb/v1.0-mini` 已存在，`dakai` 会在缺少 rich 数据时自动生成。
也可以通过 `NUSCENES_DATAROOT=/path/to/nuscenes-mini ./dakai` 指定本地数据集路径。

生成产物包括：

- `frontend/public/sample.mp4`：真实连续 CAM_FRONT 视频
- `frontend/public/telemetry.json`：车辆状态
- `frontend/public/perception.json`：BEV 目标框、车道线、轨迹、地图数据
- `foxglove/autodrive_nuscenes_mini.mcap`：Foxglove 可播放文件

也可以手动生成：

```bash
backend/.venv/bin/python scripts/convert_nuscenes_rich.py \
  --dataroot "$HOME/Datasets/nuscenes-mini-5gb" \
  --fps 12 \
  --render-fps 24 \
  --max-frames 360
backend/.venv/bin/python scripts/export_foxglove_mcap.py
```

API Key 请放在 `backend/.env`，不要提交。后端会读取：

```text
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

没有有效 Key 或模型调用失败时，后端会自动切换本地规则 fallback。
