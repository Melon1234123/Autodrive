# Autodrive

自动驾驶本地演示与复现资料。

## 文档

- [GitHub 下载复现教程](docs/github-reproduction-guide.md)
- [Windows 本地视频 + AI 诊断复现方案](docs/windows-local-ai-demo.md)
- [nuScenes 公开数据复现指南](docs/nuscenes-data-guide.md)
- [Foxglove + MCAP 实景演示指南](docs/foxglove-mcap-guide.md)

## 三屏诊断驾驶舱

从官网首屏点击“进入效果展示”后，驾驶舱按纵向三屏组织完整证据链：

1. **场景入口**：选择数据场景并预览真实前视视频。
2. **实时解析**：在同一时间轴上同步视频检测框、LiDAR 点云、地图轨迹、车辆状态和历史风险。
3. **全域诊断**：支持 WebSocket 当前帧诊断，也支持异步全场景报告。报告显示排队、特征提取、因果分析等进度，完成后自动展开；点击证据时间可回到同步视频帧。

三屏共用同一个视频播放节点，滚轮或键盘切屏不会重置时间、播放状态或倍速。场景库包含十个中文场景：工区左转跟车、人车混流待转、斑马线母婴穿越、停车场行人横穿、繁忙路口公交博弈、城市路口侧向超车、停车区人车密集、夜间主干道施工、雨夜行人横穿和低照路口混行。

全场景报告默认由本地确定性规则生成，无需 API Key；配置可用的模型后可进入模型增强模式。模型只能返回受约束的展示风格与重点项 ID 计划，不能改写分数、事件、证据或其他报告事实。模型不可达或返回不合法数据时，会保留完整本地报告并继续演示。

## 启动与测试

保持原有启动方式：

```bash
./dakai
```

前端地址为 `http://localhost:5173/`，后端健康检查为 `http://localhost:8080/health`。停止服务：

```bash
./guandiao
```

回归测试：

```bash
cd frontend
npm install
npx playwright install chromium
npm test -- --run
npm run build

cd ..
backend/.venv/bin/python -m pytest harness/tests tests -q

# E2E 默认自行启动并回收 5173/8080，先停掉手动启动的 Demo
./guandiao
cd frontend
npm run test:e2e
```

fresh checkout 首次运行前需要执行 `npx playwright install chromium`。`npm run test:e2e` 默认不复用现有端口进程，而是启动并回收本次验收专用的 5173/8080 服务，确保测试当前代码。只有在确认手动服务就是当前工作树时，才可显式使用 `PW_REUSE_EXISTING=1 npm run test:e2e` 复用它们。套件验证三屏、十场景、WebSocket 当前帧诊断、异步报告和四组桌面视口；验收截图写入已忽略的 `.run/playwright/screenshots/`。

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

## 多场景数据集

前端会读取 `frontend/public/scenes.json`，并在顶部“场景”下拉框同步切换视频、telemetry、感知数据和元数据。现有根目录数据已作为 `default` 场景保留，因此旧的单场景部署无需迁移。

将多个 nuScenes 场景导出到独立目录并自动登记到清单：

```bash
backend/.venv/bin/python scripts/convert_nuscenes_rich.py \
  --dataroot "$HOME/Datasets/nuscenes-mini-5gb" \
  --scene scene-0061 \
  --output-dir frontend/public/scenes/scene-0061 \
  --manifest frontend/public/scenes.json \
  --scene-id scene-0061
```

对每个目标场景重复该命令即可。每个条目必须包含 `sample.mp4`、`telemetry.json`、`perception.json`、`dataset-meta.json`；生成器会以 `id` 为键覆盖同名条目而不会影响其他场景。可选的 `riskEventsFile` 预留给历史风险事件模块使用。

### LiDAR 点云导出与回放

导出场景的视频/感知数据后，可为同一场景生成轻量 LiDAR TOP 关键帧。该命令会更新清单中的
`lidarIndexFile`，驾驶舱据此同步加载当前关键帧和前两帧历史点云：

```bash
backend/.venv/bin/python scripts/export_nuscenes_lidar.py \
  --dataroot "$HOME/Datasets/nuscenes-mini-5gb" \
  --scene scene-0061 \
  --perception frontend/public/scenes/scene-0061/perception.json \
  --manifest frontend/public/scenes.json \
  --scene-id scene-0061 \
  --output-dir frontend/public/scenes/scene-0061/lidar
```

生成路径为 `frontend/public/scenes/<scene-id>/lidar/index.json` 与
`frames/*.bin`。`index.json` 使用相对帧路径，并在清单中登记为
`"lidarIndexFile": "/scenes/<scene-id>/lidar/index.json"`。点云为裁剪、下采样后的
`xyzI float32 little-endian` 数据，目标是每个演示场景保持在约 5 GB 总数据预算内。
没有该字段的相机场景仍会正常加载视频、地图和诊断；BEV 面板会明确显示“仅相机”，不会沿用上一场景的点云。

API Key 请放在 `backend/.env`，不要提交。后端会读取：

```text
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

没有有效 Key 或模型调用失败时，后端会自动切换本地规则 fallback。
