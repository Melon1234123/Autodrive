# Windows 本地视频 + AI 诊断复现方案

本文档说明两件事：

1. 如何访问原始飞书复现文档。
2. 如何在 Windows 上用“本地视频 + 前端页面 + Python AI 后端”的方式复现核心效果。

该方案不依赖 Foxglove、不依赖 `.mcap` 数据，也不需要安装 Foxglove 插件。目标是先跑通一个可演示闭环：本地视频播放、车辆状态展示、点击诊断、后端调用大模型并返回结果。

## 1. 访问飞书文档

原始飞书文档地址：

```text
https://guanghe-studio.feishu.cn/wiki/J5oawYDAVi1LhCkf9hhcBOL6nFR?from=from_copylink
```

访问方式：

1. 在浏览器中打开上述链接。
2. 如果页面提示登录，使用飞书账号登录。
3. 如果登录后仍然无法查看，说明文档权限没有对当前账号开放，需要联系文档所有者开启分享权限。
4. 推荐让文档所有者设置为“获得链接的人可阅读”，或者把页面导出为 PDF / Word / Markdown 后放进仓库。

原文档的主题是“智驾卫士 - 系统复现与开发环境搭建指南”。它的原始方案是：

- 用 Foxglove Studio 播放自动驾驶 `.mcap` 数据。
- 用 Foxglove 自定义面板读取车辆状态。
- 用 Python WebSocket 后端接收当前帧数据。
- 后端调用 DeepSeek / OpenAI 兼容接口生成诊断结论。

本文档采用简化复现：不用 Foxglove，先用本地视频和模拟车辆状态跑通同样的交互链路。

## 2. 最终效果

本地运行后，页面大致由两部分组成：

- 左侧：本地自动驾驶视频播放器。
- 右侧：智驾诊断面板。

诊断面板显示：

- 后端连接状态。
- 当前播放时间。
- 车速。
- 刹车状态。
- 油门开度。
- 转向角。
- 纵向加速度。
- 风险等级。
- “全域诊断”按钮。
- 大模型返回的诊断说明和安全结论。

点击“全域诊断”后，前端把当前时间点附近的车辆状态通过 WebSocket 发给后端，后端调用大模型并把诊断结果返回给前端显示。

## 3. 推荐目录结构

建议在仓库中按下面结构组织 Demo：

```text
Autodrive/
  frontend/
    package.json
    src/
      App.tsx
      main.tsx
      styles.css
    public/
      sample.mp4
      telemetry.json
  backend/
    server.py
    requirements.txt
    .env.example
  docs/
    windows-local-ai-demo.md
```

其中：

- `sample.mp4` 是本地演示视频。
- `telemetry.json` 是车辆状态时间序列。
- `frontend` 负责播放视频和展示诊断面板。
- `backend` 负责 WebSocket 服务和大模型调用。

## 4. Windows 环境准备

安装以下软件：

1. Node.js 20 LTS
2. Python 3.10 或更新版本
3. Git
4. VS Code

验证命令：

```powershell
node -v
npm -v
python --version
pip --version
git --version
```

如果团队里有人使用 WSL2，也可以把后端放在 WSL2 里跑。但本方案为了降低门槛，默认直接在 Windows PowerShell 中运行。

## 5. 准备本地素材

### 5.1 视频文件

可以使用任意本地驾驶视频，先不要求真实自动驾驶数据。文件放到：

```text
frontend/public/sample.mp4
```

推荐视频特征：

- 10 秒到 2 分钟。
- 能看到道路、车辆、行人、路口或刹车场景。
- 文件大小控制在 200 MB 以内，便于仓库外传输和本地调试。

注意：不要把大视频直接提交到 GitHub。仓库里可以只保留说明，视频用网盘或 Releases 管理。

### 5.2 车辆状态 JSON

用一个本地 JSON 文件模拟车辆状态：

```json
[
  {
    "time": 0.0,
    "speedKmh": 18.5,
    "brake": 0.0,
    "throttle": 0.22,
    "steering": 0.01,
    "accel": 0.8,
    "scene": "车辆低速直行，前方道路通畅"
  },
  {
    "time": 4.2,
    "speedKmh": 32.1,
    "brake": 0.0,
    "throttle": 0.45,
    "steering": -0.03,
    "accel": 1.4,
    "scene": "车辆加速接近路口"
  },
  {
    "time": 8.5,
    "speedKmh": 29.8,
    "brake": 0.65,
    "throttle": 0.38,
    "steering": 0.12,
    "accel": -0.2,
    "scene": "前方出现行人，刹车和油门同时存在"
  }
]
```

保存为：

```text
frontend/public/telemetry.json
```

前端根据视频当前播放时间，选择最接近的一条状态作为当前帧数据。

## 6. 前端实现流程

推荐使用 Vite + React + TypeScript。

初始化：

```powershell
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install lucide-react
```

前端核心逻辑：

1. 页面加载时读取 `/telemetry.json`。
2. 使用 `<video>` 播放 `/sample.mp4`。
3. 监听视频 `timeupdate` 事件。
4. 根据 `video.currentTime` 找到最近的车辆状态。
5. 在右侧面板显示当前状态。
6. 页面启动时连接后端 WebSocket：`ws://localhost:8080/ws`。
7. 点击“全域诊断”时，把当前状态发送给后端。
8. 接收后端返回的诊断结果并渲染。

前端发送给后端的消息格式建议如下：

```json
{
  "type": "diagnose",
  "frame": {
    "time": 8.5,
    "speedKmh": 29.8,
    "brake": 0.65,
    "throttle": 0.38,
    "steering": 0.12,
    "accel": -0.2,
    "scene": "前方出现行人，刹车和油门同时存在"
  }
}
```

后端返回格式建议如下：

```json
{
  "riskLevel": "high",
  "thought": "当前帧存在明显油门和刹车冲突，需要重点检查控制策略。",
  "conclusion": "建议判定为高风险帧：车辆在出现行人时仍保留较高油门输入，制动响应不充分。"
}
```

## 7. 后端实现流程

进入仓库根目录，新建后端目录：

```powershell
mkdir backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

如果 PowerShell 禁止执行虚拟环境脚本，先执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

安装依赖：

```powershell
pip install fastapi uvicorn python-dotenv openai
```

`requirements.txt` 建议写成：

```text
fastapi
uvicorn
python-dotenv
openai
```

`.env.example` 建议写成：

```text
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

实际运行时复制一份 `.env`：

```powershell
copy .env.example .env
```

然后把 `.env` 里的 Key 改成自己的。不要把 `.env` 提交到 GitHub。

后端建议使用 FastAPI WebSocket：

```python
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from openai import OpenAI

load_dotenv()

app = FastAPI()

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com"),
)

MODEL = os.getenv("OPENAI_MODEL", "deepseek-chat")


def build_prompt(frame: dict) -> str:
    return f"""
你是一个自动驾驶安全诊断助手。请根据当前视频帧附近的车辆状态，判断是否存在安全风险。

车辆状态：
- 时间：{frame.get("time")} 秒
- 车速：{frame.get("speedKmh")} km/h
- 刹车：{frame.get("brake")}
- 油门：{frame.get("throttle")}
- 转向：{frame.get("steering")}
- 纵向加速度：{frame.get("accel")}
- 场景描述：{frame.get("scene")}

请输出：
1. 风险等级：low / medium / high
2. 诊断分析
3. 最终结论
"""


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)
            frame = payload.get("frame", {})

            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": "你是自动驾驶安全审计专家。"},
                    {"role": "user", "content": build_prompt(frame)},
                ],
                temperature=0.2,
            )

            content = response.choices[0].message.content or ""
            await websocket.send_text(json.dumps({
                "riskLevel": "unknown",
                "thought": content,
                "conclusion": content,
            }, ensure_ascii=False))
    except WebSocketDisconnect:
        print("WebSocket disconnected")
```

运行后端：

```powershell
uvicorn server:app --host 0.0.0.0 --port 8080 --reload
```

看到下面信息代表后端启动成功：

```text
Uvicorn running on http://0.0.0.0:8080
```

## 8. 启动前端

在另一个 PowerShell 窗口：

```powershell
cd frontend
npm run dev
```

打开浏览器访问 Vite 输出的地址，通常是：

```text
http://localhost:5173
```

确认：

1. 视频可以播放。
2. 右侧车辆状态会随播放时间变化。
3. 后端状态显示已连接。
4. 点击“全域诊断”后，2 到 10 秒内能显示诊断结果。

## 9. 调试方法

### 9.1 WebSocket 连接失败

检查后端是否运行：

```powershell
curl http://localhost:8080
```

FastAPI 根路径没有定义时可能返回 `404`，这不代表服务没启动。只要终端里显示 Uvicorn 正在监听 `8080` 即可。

如果前端仍连不上：

- 确认前端 WebSocket 地址是 `ws://localhost:8080/ws`。
- 确认 Windows 防火墙没有拦截 Python。
- 确认后端终端没有报错退出。

### 9.2 大模型接口失败

检查 `.env`：

- `OPENAI_API_KEY` 是否正确。
- `OPENAI_BASE_URL` 是否和供应商一致。
- `OPENAI_MODEL` 是否可用。

如果使用 DeepSeek 官方接口，常见配置是：

```text
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

如果使用中转 API，按中转服务商提供的 base url 和 model 名填写。

### 9.3 视频可以播放但数据不变化

检查：

- `frontend/public/telemetry.json` 是否存在。
- JSON 是否是数组。
- 每条数据是否包含 `time` 字段。
- `time` 是否和视频时间轴匹配。

### 9.4 不想先接大模型

可以先在后端写规则诊断，等前后端闭环通了再接 DeepSeek。

示例规则：

- `brake > 0.4 && throttle > 0.2`：油门刹车冲突，高风险。
- `speedKmh > 30 && brake < 0.1 && scene` 包含“行人”：中高风险。
- `abs(steering) > 0.5 && speedKmh > 40`：高速大转向，中风险。

## 10. 和原始 Foxglove 方案的关系

本方案复现的是原始文档中的核心产品效果：

- 数据回放。
- 车辆状态展示。
- 当前帧诊断。
- AI 安全结论。

区别是：

- 原方案的数据源是 `.mcap`。
- 原方案展示平台是 Foxglove Studio。
- 本方案的数据源是 `视频 + telemetry.json`。
- 本方案展示平台是普通网页。

等本地 Demo 跑通后，可以再升级为 Foxglove 版本：

1. 把 `telemetry.json` 替换为 `.mcap` topic 读取。
2. 把普通 React 页面迁移为 Foxglove 自定义 Panel。
3. 复用同一个 Python WebSocket 后端。

这样可以降低第一阶段复现风险，先把“能演示的产品闭环”做出来。
