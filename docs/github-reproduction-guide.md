# GitHub 源码复现教程

本教程从一个干净的 GitHub clone 开始，在本地生成真实 nuScenes mini 场景并运行 Autodrive。仓库是**源码优先**交付：生成后的场景媒体和数据不在提交中，Release 演示视频也不作为运行依赖。

## 1. 获取源码与环境

需要 Python 3.9+、Node.js 18+、npm、git 与 ffmpeg。macOS 上可安装 ffmpeg：

```bash
brew install ffmpeg
```

```bash
git clone https://github.com/Melon1234123/Autodrive.git
cd Autodrive
```

仓库不会包含 `backend/.env`、Python 虚拟环境、`node_modules`、nuScenes 原始数据，或下列由本机构建产生的文件：

- 各场景的 `sample.mp4`、`telemetry.json`、`perception.json`、`dataset-meta.json`
- 各场景 LiDAR 索引与点云帧
- `foxglove/*.mcap`

这些忽略项的缺失是设计如此，不是 clone 失败。

## 2. 准备 nuScenes mini

下载并解压 nuScenes mini。数据根目录应类似：

```text
/path/to/nuscenes-mini-5gb/
  v1.0-mini/
    scene.json
    sample.json
    sample_data.json
    ego_pose.json
  samples/
    CAM_FRONT/
  sweeps/
```

默认数据根目录是 `$HOME/Datasets/nuscenes-mini-5gb`。如果你的数据在其他位置，后面每次构建前都以 `NUSCENES_DATAROOT=/path/to/nuscenes-mini-5gb` 指定它。

## 3. 生成十个本地场景

先运行一次 `./dakai` 安装前后端依赖并创建 `backend/.venv`，再停止它。然后在**启动演示之前**执行场景构建器：

```bash
./dakai
./guandiao
NUSCENES_DATAROOT=/path/to/nuscenes-mini-5gb ./scripts/build_demo_assets.sh
```

若使用默认数据根目录，最后一行改为：

```bash
./scripts/build_demo_assets.sh
```

`build_demo_assets.sh` 会将十个 nuScenes 场景转换到本机：`default`（对应 `scene-0796`）以及 `scene-0061`、`scene-0103`、`scene-0553`、`scene-0655`、`scene-0757`、`scene-0916`、`scene-1077`、`scene-1094`、`scene-1100`。每个场景会有本地视频、车辆状态、感知数据和 LiDAR 回放；脚本不会改写 `scenes.json` 中已写好的中文名称和描述。

构建用时取决于磁盘和 CPU。生成文件只用于你的本地运行，不应加入 Git 提交。

## 4. 启动与停止

```bash
./dakai
```

打开：

```text
http://localhost:5173/
```

后端健康检查：

```text
http://localhost:8080/health
```

停止服务：

```bash
./guandiao
```

## 5. 可选模型增强

不配置模型也可以完整运行，因为报告事实来自本地确定性规则。若要启用 OpenAI-compatible 的叙事增强：

```bash
cp backend/.env.example backend/.env
```

在 `backend/.env` 中填写你自己的配置，例如：

```text
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

模型只影响受约束的说明与重点展示；风险分数、事件、证据和其他报告事实始终由本地确定性结果决定。API 不可达、没有 Key 或模型输出不合法时，后端会自动保留完整的 fallback 报告。不要把 `backend/.env` 提交到 Git。

## 6. 运行测试

完成首次 `./dakai` 后可运行：

```bash
cd frontend
npm test -- --run
npm run build

cd ..
backend/.venv/bin/python -m pytest harness/tests tests -q
```

需要浏览器端到端测试时，第一次额外安装 Chromium：

```bash
cd frontend
npx playwright install chromium
```

E2E 会自行启动并回收端口，因此先停掉手动服务：

```bash
cd ..
./guandiao
cd frontend
npm run test:e2e
```

只有在确认已有服务来自当前工作树时，才使用 `PW_REUSE_EXISTING=1 npm run test:e2e`。

## 7. 数据来源、演示与限制

- Release 中的 [90 秒功能演示](https://github.com/Melon1234123/Autodrive/releases/tag/source-only-v1) 是观看入口，不是 clone 后的媒体依赖。
- 你本机下载的 nuScenes mini 是场景原始输入；仓库脚本把 CAM_FRONT、元数据和 LiDAR 转成前端所需格式。
- 本项目用于本地研究和可视化演示，不应作为车辆控制、安全认证或真实道路性能结论。

## 8. 常见问题

### 构建器提示找不到数据集

确认目录含有 `v1.0-mini/`，并以绝对路径指定：

```bash
NUSCENES_DATAROOT=/absolute/path/to/nuscenes-mini-5gb ./scripts/build_demo_assets.sh
```

### 构建器提示 Python 环境不存在

先执行 `./dakai`，等待它创建 `backend/.venv`，再执行 `./guandiao` 后重试构建器。

### 场景视频为空或 LiDAR 面板没有数据

确认十场景构建器已无错误完成，`ffmpeg` 已安装，且不要只运行 `./dakai` 就期待 GitHub clone 中已有生成数据。

### 诊断始终是 fallback

这是离线模式的正常行为。若需要模型增强，检查 `backend/.env` 中的 Key、URL 和模型名，并查看 `http://localhost:8080/health` 确认后端是否检测到凭据配置；该端点的 `mode` 不是某次诊断的实际执行结果。重新运行诊断后，以页面报告中的生成状态/降级原因（或对应诊断响应）确认实际是否使用模型。即使模型不可用，确定性报告仍可使用。

### 5173 或 8080 被占用

运行：

```bash
./guandiao
```

再执行 `./dakai`。
