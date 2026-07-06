# GitHub 下载复现教程

这份教程面向从 GitHub clone 本仓库的用户，目标是在 macOS 上稳定复现本项目的“本地视频 + 车辆状态 + 前端页面 + Python AI 后端 + 可选 Foxglove”的智驾诊断 Demo。

## 仓库不包含什么

为了避免提交敏感信息和大文件，GitHub 仓库不包含：

- `backend/.env`：API Key 配置文件。
- `backend/.venv/`：Python 虚拟环境。
- `frontend/node_modules/`、`foxglove-extension/node_modules/`：npm 依赖。
- `frontend/public/sample.mp4`：本地生成的视频。
- `foxglove/*.mcap`：本地生成的 Foxglove 回放文件。
- nuScenes 原始数据集。

仓库已经包含前端、后端、转换脚本、示例 telemetry/perception JSON、Foxglove 扩展源码和启动脚本。真实视频和 MCAP 需要在本地根据 nuScenes mini 生成。

## 环境要求

macOS 推荐环境：

- Python 3.9+
- Node.js 18+
- npm
- ffmpeg
- git

如果没有 ffmpeg，可以用 Homebrew 安装：

```bash
brew install ffmpeg
```

## 下载代码

```bash
git clone https://github.com/Melon1234123/Autodrive.git
cd Autodrive
```

## 配置 GLM / OpenAI-compatible API

复制示例环境变量：

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：

```text
OPENAI_API_KEY=你的API_KEY
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
OPENAI_MODEL=glm-5.2
```

如果不配置 Key，后端不会崩溃，会自动使用本地规则 fallback；配置成功后，页面右下角会显示真实模型模式。

## 准备 nuScenes mini

要复现本地实景效果，需要下载 nuScenes mini，并解压成类似结构：

```text
$HOME/Datasets/nuscenes-mini-5gb/
  v1.0-mini/
    scene.json
    sample.json
    sample_data.json
    ego_pose.json
    sample_annotation.json
    category.json
    instance.json
    calibrated_sensor.json
    sensor.json
  samples/
    CAM_FRONT/
  sweeps/
    CAM_FRONT/
```

默认启动脚本会查找：

```text
$HOME/Datasets/nuscenes-mini-5gb
```

如果放在其他位置，启动时指定：

```bash
NUSCENES_DATAROOT=/path/to/nuscenes-mini-5gb ./dakai
```

## 一键启动

```bash
./dakai
```

启动脚本会自动完成：

- 创建 `backend/.venv`
- 安装 Python 依赖
- 如果检测到 nuScenes mini 且缺少 `sample.mp4`，自动生成真实 CAM_FRONT 视频和感知数据
- 安装前端 npm 依赖
- 启动 FastAPI 后端
- 启动 Vite React 前端

打开：

```text
http://localhost:5173/
```

后端健康检查：

```text
http://localhost:8080/health
```

## 验证完整链路

页面加载后检查：

- 左侧能播放前视视频。
- 右侧能看到车速、刹车、油门、转向、加速度、场景状态。
- BEV 和地图面板不是空白。
- 地图面板车头朝上，只显示局部道路和前方轨迹。
- 点击“全域诊断”后，后端返回风险等级、诊断分析、最终结论。

如果 API 配置正确，诊断结果应显示 `真实模型` 和对应模型名；如果 API 不可达，会显示规则 fallback。

## 停止服务

```bash
./guandiao
```

## 手动重新生成实景数据

```bash
backend/.venv/bin/python scripts/convert_nuscenes_rich.py \
  --dataroot "$HOME/Datasets/nuscenes-mini-5gb" \
  --scene scene-0796 \
  --fps 12 \
  --render-fps 24 \
  --max-frames 360
```

生成内容：

```text
frontend/public/sample.mp4
frontend/public/telemetry.json
frontend/public/perception.json
frontend/public/dataset-meta.json
```

这些生成文件中的 `sample.mp4` 不提交到 GitHub。

## 生成 Foxglove MCAP

```bash
backend/.venv/bin/python scripts/export_foxglove_mcap.py
```

生成：

```text
foxglove/autodrive_nuscenes_mini.mcap
```

然后在 Foxglove Studio 里打开这个本地文件，并加载 `foxglove-extension` 扩展。

## 常见问题

视频区域空白：

- 检查 `frontend/public/sample.mp4` 是否存在。
- 检查 `NUSCENES_DATAROOT` 是否指向 nuScenes mini 根目录。
- 检查是否安装 ffmpeg。

诊断一直 fallback：

- 检查 `backend/.env` 是否存在。
- 检查 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。
- 可访问 `http://localhost:8080/health` 查看后端识别到的模式。

端口被占用：

- 默认端口是前端 `5173`、后端 `8080`。
- 可先执行 `./guandiao`。

想清理本地生成文件：

```bash
./guandiao
rm -rf .run frontend/dist frontend/node_modules foxglove-extension/node_modules backend/.venv
```

保留 `backend/.env`、`frontend/public/sample.mp4` 和 `foxglove/autodrive_nuscenes_mini.mcap`，可以避免下次重新配置和重新生成大文件。
