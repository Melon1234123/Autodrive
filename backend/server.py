from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

app = FastAPI(title="Autodrive AI Diagnosis Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "deepseek-chat").strip()


def has_model_credentials() -> bool:
    if not OPENAI_API_KEY:
        return False

    placeholder_markers = ("your-api-key", "sk-your-api-key", "changeme", "replace-me")
    lowered = OPENAI_API_KEY.lower()
    return not any(marker in lowered for marker in placeholder_markers)


class TelemetryFrame(BaseModel):
    time: float = 0.0
    speedKmh: float = 0.0
    brake: float = 0.0
    throttle: float = 0.0
    steering: float = 0.0
    accel: float = 0.0
    scene: str = ""


class DiagnosisResult(BaseModel):
    riskLevel: str = Field(pattern="^(low|medium|high|unknown)$")
    thought: str
    conclusion: str
    mode: str = Field(default="fallback", pattern="^(model|fallback)$")
    model: Optional[str] = None
    diagnostics: Optional[str] = None


def build_prompt(frame: TelemetryFrame) -> str:
    return f"""
你是一个自动驾驶安全诊断助手。请根据当前视频帧附近的车辆状态，判断是否存在安全风险。

车辆状态：
- 时间：{frame.time:.2f} 秒
- 车速：{frame.speedKmh:.1f} km/h
- 刹车：{frame.brake:.2f}
- 油门：{frame.throttle:.2f}
- 转向：{frame.steering:.2f}
- 纵向加速度：{frame.accel:.2f} m/s²
- 场景描述：{frame.scene}

请只返回 JSON，不要使用 Markdown 代码块。JSON 格式：
{{
  "riskLevel": "low | medium | high | unknown",
  "thought": "诊断分析",
  "conclusion": "最终结论"
}}
""".strip()


def fallback_diagnose(frame: TelemetryFrame) -> DiagnosisResult:
    scene = frame.scene or ""

    if frame.brake > 0.4 and frame.throttle > 0.2:
        return DiagnosisResult(
            riskLevel="high",
            thought=(
                "规则诊断：当前帧同时存在较高制动和油门输入，控制意图冲突明显。"
                f" brake={frame.brake:.2f}, throttle={frame.throttle:.2f}。"
            ),
            conclusion="判定为高风险帧：建议立即检查制动优先、油门抑制和接管策略。",
            mode="fallback",
            model=OPENAI_MODEL,
        )

    if frame.speedKmh > 30 and "行人" in scene:
        return DiagnosisResult(
            riskLevel="high",
            thought=(
                "规则诊断：车辆速度高于 30 km/h，且场景描述包含行人目标，"
                "当前安全裕度偏低，属于中高风险。"
            ),
            conclusion="判定为中高风险帧：建议降低车速并提高行人避让策略优先级。",
            mode="fallback",
            model=OPENAI_MODEL,
        )

    if abs(frame.steering) > 0.5 and frame.speedKmh > 40:
        return DiagnosisResult(
            riskLevel="medium",
            thought=(
                "规则诊断：高速状态下转向角较大，横向稳定性和路径跟踪需要重点关注。"
                f" speed={frame.speedKmh:.1f} km/h, steering={frame.steering:.2f}。"
            ),
            conclusion="判定为中风险帧：建议检查横向控制输出是否平顺，必要时降低速度。",
            mode="fallback",
            model=OPENAI_MODEL,
        )

    return DiagnosisResult(
        riskLevel="low",
        thought="规则诊断：当前帧未触发油门刹车冲突、行人高速接近或高速大转向规则。",
        conclusion="判定为低风险帧：车辆状态整体平稳，可继续观察后续时间段。",
        mode="fallback",
        model=OPENAI_MODEL,
    )


def get_openai_client() -> OpenAI | None:
    if not has_model_credentials():
        return None

    return OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL, timeout=4.0, max_retries=0)


def normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def parse_model_response(content: str) -> DiagnosisResult:
    raw = content.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()

    try:
        data = json.loads(raw)
        return DiagnosisResult(
            riskLevel=data.get("riskLevel", "unknown"),
            thought=data.get("thought", raw),
            conclusion=data.get("conclusion", raw),
            mode="model",
            model=OPENAI_MODEL,
        )
    except Exception:
        return DiagnosisResult(
            riskLevel="unknown",
            thought=content,
            conclusion="模型返回了非 JSON 内容，已原样展示诊断分析。",
            mode="model",
            model=OPENAI_MODEL,
        )


def call_model_with_curl(frame: TelemetryFrame) -> DiagnosisResult:
    curl = shutil.which("curl")
    if not curl:
        raise RuntimeError("curl is not available")

    base_url = normalize_base_url(OPENAI_BASE_URL)
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": "你是自动驾驶安全审计专家。"},
            {"role": "user", "content": build_prompt(frame)},
        ],
        "temperature": 0.2,
    }

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=True) as payload_file:
        json.dump(payload, payload_file, ensure_ascii=False)
        payload_file.flush()

        curl_config = "\n".join(
            [
                "silent",
                "show-error",
                "connect-timeout = 15",
                "max-time = 45",
                'write-out = "\\n__HTTP_STATUS__:%{http_code}\\n"',
                f'header = "Authorization: Bearer {OPENAI_API_KEY}"',
                'header = "Content-Type: application/json"',
                f"data = @{payload_file.name}",
                f"url = {base_url}/chat/completions",
            ]
        )
        completed = subprocess.run(
            [curl, "--config", "-"],
            input=curl_config,
            text=True,
            capture_output=True,
            timeout=50,
            check=False,
        )

    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"curl exited with {completed.returncode}")

    stdout = completed.stdout
    marker = "\n__HTTP_STATUS__:"
    if marker not in stdout:
        raise RuntimeError("curl response did not include HTTP status")

    body, status_text = stdout.rsplit(marker, 1)
    status_code = int(status_text.strip() or "0")
    if status_code < 200 or status_code >= 300:
        raise RuntimeError(f"HTTP {status_code}: {body[:500]}")

    data = json.loads(body)
    content = data["choices"][0]["message"].get("content") or ""
    result = parse_model_response(content)
    return DiagnosisResult(
        riskLevel=result.riskLevel,
        thought=result.thought,
        conclusion=result.conclusion,
        mode="model",
        model=OPENAI_MODEL,
        diagnostics="model via curl transport",
    )


async def model_diagnose(frame: TelemetryFrame) -> DiagnosisResult:
    client = get_openai_client()
    if client is None:
        return fallback_diagnose(frame)

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.chat.completions.create,
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": "你是自动驾驶安全审计专家。"},
                    {"role": "user", "content": build_prompt(frame)},
                ],
                temperature=0.2,
            ),
            timeout=5.0,
        )
        content = response.choices[0].message.content or ""
        return parse_model_response(content)
    except Exception as sdk_exc:
        try:
            return await asyncio.to_thread(call_model_with_curl, frame)
        except Exception as curl_exc:
            fallback = fallback_diagnose(frame)
            return DiagnosisResult(
                riskLevel=fallback.riskLevel,
                thought=(
                    "云端模型暂时不可达，系统已自动切换到本地规则诊断，当前演示链路不中断。\n\n"
                    f"{fallback.thought}"
                ),
                conclusion=fallback.conclusion,
                mode="fallback",
                model=OPENAI_MODEL,
                diagnostics=(
                    f"SDK {sdk_exc.__class__.__name__}: model endpoint unavailable; "
                    f"curl {curl_exc.__class__.__name__}: model endpoint unavailable"
                ),
            )


def extract_frame(payload: dict[str, Any]) -> TelemetryFrame:
    frame_data = payload.get("frame", payload)
    return TelemetryFrame.model_validate(frame_data)


@app.get("/")
async def root() -> dict[str, str]:
    mode = "model" if has_model_credentials() else "fallback"
    return {"service": "Autodrive AI Diagnosis Backend", "mode": mode}


@app.get("/health")
async def health() -> dict[str, str]:
    mode = "model" if has_model_credentials() else "fallback"
    return {"status": "ok", "mode": mode, "model": OPENAI_MODEL}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
                frame = extract_frame(payload)
                result = await model_diagnose(frame)
                await websocket.send_text(result.model_dump_json())
            except Exception as exc:
                error = DiagnosisResult(
                    riskLevel="unknown",
                    thought=f"后端无法解析当前帧数据：{exc}",
                    conclusion="请检查前端发送的 telemetry frame 字段是否完整。",
                    mode="fallback",
                    model=OPENAI_MODEL,
                )
                await websocket.send_text(error.model_dump_json())
    except WebSocketDisconnect:
        print("WebSocket disconnected")
