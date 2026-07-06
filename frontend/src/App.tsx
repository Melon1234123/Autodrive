import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Camera,
  Database,
  Gauge,
  GitBranch,
  Layers3,
  LoaderCircle,
  Map,
  Radio,
  Route,
  ServerCog,
  ShieldCheck,
  Zap,
} from "lucide-react";

type RiskLevel = "low" | "medium" | "high" | "unknown";
type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type DiagnosisMode = "model" | "fallback" | "unknown";

type TelemetryFrame = {
  time: number;
  speedKmh: number;
  brake: number;
  throttle: number;
  steering: number;
  accel: number;
  scene: string;
};

type PerceptionObject = {
  id: string;
  label: string;
  category: string;
  x: number;
  y: number;
  z: number;
  width: number;
  length: number;
  height: number;
  yaw: number;
  risk: RiskLevel;
  cameraBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
    depth: number;
  };
};

type Point3 = { x: number; y: number; z: number };

type PerceptionFrame = {
  time: number;
  timestampUs: number;
  ego: {
    x: number;
    y: number;
    yaw: number;
    latitude: number;
    longitude: number;
  };
  objects: PerceptionObject[];
  lanes: Array<{ id: string; points: Point3[] }>;
  plannedPath: Point3[];
};

type DiagnosisResult = {
  riskLevel: RiskLevel;
  thought: string;
  conclusion: string;
  mode?: Exclude<DiagnosisMode, "unknown">;
  model?: string | null;
  diagnostics?: string | null;
};

type DatasetMeta = {
  sourceType?: string;
  sourceLabel?: string;
  sceneName?: string;
  sceneDescription?: string;
  sampleCount?: number | null;
  perceptionCount?: number | null;
  fps?: number;
  videoFps?: number;
  telemetryFps?: number;
  frameMode?: string;
};

type HealthStatus = {
  status: string;
  mode: Exclude<DiagnosisMode, "unknown">;
  model: string;
};

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

const riskText: Record<RiskLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  unknown: "未知",
};

const statusText: Record<ConnectionStatus, string> = {
  connecting: "连接中",
  connected: "已连接",
  disconnected: "已断开",
  error: "连接错误",
};

const modeText: Record<DiagnosisMode, string> = {
  model: "真实模型",
  fallback: "规则 fallback",
  unknown: "未知",
};

function findNearestFrame<T extends { time: number }>(frames: T[], currentTime: number) {
  if (frames.length === 0) {
    return null;
  }

  return frames.reduce((nearest, frame) => {
    const currentDistance = Math.abs(frame.time - currentTime);
    const nearestDistance = Math.abs(nearest.time - currentTime);
    return currentDistance < nearestDistance ? frame : nearest;
  }, frames[0]);
}

function formatNumber(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function riskScore(risk: RiskLevel) {
  return risk === "high" ? 3 : risk === "medium" ? 2 : risk === "low" ? 1 : 0;
}

function deriveFrameRisk(frame: TelemetryFrame | null, perception: PerceptionFrame | null): RiskLevel {
  if (!frame) {
    return "unknown";
  }
  const topObjectRisk = perception?.objects.reduce<RiskLevel>(
    (risk, object) => (riskScore(object.risk) > riskScore(risk) ? object.risk : risk),
    "low",
  );
  if (topObjectRisk === "high") {
    return "high";
  }
  if (frame.brake > 0.4 && frame.throttle > 0.2) {
    return "high";
  }
  if (frame.speedKmh > 30 && frame.scene.includes("行人")) {
    return "high";
  }
  if (topObjectRisk === "medium" || (Math.abs(frame.steering) > 0.45 && frame.speedKmh > 35)) {
    return "medium";
  }
  return "low";
}

function useBevCanvas(frame: PerceptionFrame | null, canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const parent = canvas.parentElement;
    const cssWidth = Math.max(parent?.clientWidth ?? 420, 320);
    const cssHeight = Math.max(parent?.clientHeight ?? 420, 320);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const w = cssWidth;
    const h = cssHeight;
    const view = { front: 72, rear: 12, side: 32 };
    const margin = { top: 34, right: 22, bottom: 34, left: 22 };
    const usableWidth = w - margin.left - margin.right;
    const usableHeight = h - margin.top - margin.bottom;
    const scale = Math.min(usableWidth / (view.side * 2), usableHeight / (view.front + view.rear));
    const origin = { x: margin.left + usableWidth / 2, y: h - margin.bottom - view.rear * scale };

    const background = ctx.createLinearGradient(0, 0, 0, h);
    background.addColorStop(0, "#061012");
    background.addColorStop(0.54, "#07100d");
    background.addColorStop(1, "#040605");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    const toCanvas = (point: { x: number; y: number }) => ({
      x: origin.x + point.y * scale,
      y: origin.y - point.x * scale,
    });

    ctx.strokeStyle = "rgba(118, 208, 222, 0.14)";
    ctx.lineWidth = 1;
    for (let lateral = -30; lateral <= 30; lateral += 10) {
      const a = toCanvas({ x: -view.rear, y: lateral });
      const b = toCanvas({ x: view.front, y: lateral });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let longitudinal = -10; longitudinal <= 70; longitudinal += 10) {
      const a = toCanvas({ x: longitudinal, y: -view.side });
      const b = toCanvas({ x: longitudinal, y: view.side });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (longitudinal > 0) {
        ctx.fillStyle = "rgba(196, 230, 234, 0.48)";
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText(`${longitudinal}m`, b.x - 30, b.y - 6);
      }
    }

    const leftFov = toCanvas({ x: 66, y: 36 });
    const rightFov = toCanvas({ x: 66, y: -36 });
    ctx.save();
    ctx.fillStyle = "rgba(65, 211, 255, 0.055)";
    ctx.strokeStyle = "rgba(65, 211, 255, 0.24)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(leftFov.x, leftFov.y);
    ctx.lineTo(rightFov.x, rightFov.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const drawObject = (object: PerceptionObject) => {
      const distance = Math.hypot(object.x, object.y);
      if (object.x < -view.rear || object.x > view.front || Math.abs(object.y) > view.side) {
        return;
      }
      if (object.risk === "low" && distance > 52) {
        return;
      }
      const color = object.risk === "high" ? "#ff4e3f" : object.risk === "medium" ? "#ffd45a" : "#51e6d6";
      const cos = Math.cos(object.yaw);
      const sin = Math.sin(object.yaw);
      const corners = [
        { x: object.length / 2, y: object.width / 2 },
        { x: object.length / 2, y: -object.width / 2 },
        { x: -object.length / 2, y: -object.width / 2 },
        { x: -object.length / 2, y: object.width / 2 },
      ].map((corner) =>
        toCanvas({
          x: object.x + cos * corner.x - sin * corner.y,
          y: object.y + sin * corner.x + cos * corner.y,
        }),
      );

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = object.risk === "high" ? "rgba(255, 78, 63, 0.24)" : object.risk === "medium" ? "rgba(255, 212, 90, 0.18)" : "rgba(81, 230, 214, 0.14)";
      ctx.shadowColor = color;
      ctx.shadowBlur = object.risk === "low" ? 3 : 12;
      ctx.lineWidth = object.risk === "high" ? 2.6 : 1.8;
      ctx.beginPath();
      corners.forEach((corner, index) => {
        if (index === 0) {
          ctx.moveTo(corner.x, corner.y);
        } else {
          ctx.lineTo(corner.x, corner.y);
        }
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (object.risk !== "low" || distance < 24) {
        const p = toCanvas(object);
        ctx.fillStyle = color;
        ctx.font = "12px Inter, sans-serif";
        ctx.fillText(`${object.label} ${Math.round(distance)}m`, p.x + 7, p.y - 6);
      }
    };

    frame?.objects
      .slice()
      .sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y))
      .forEach(drawObject);

    const egoFront = toCanvas({ x: 2.4, y: 0 });
    const egoRearLeft = toCanvas({ x: -2.1, y: 1.0 });
    const egoRearRight = toCanvas({ x: -2.1, y: -1.0 });
    ctx.save();
    ctx.fillStyle = "#d8ff63";
    ctx.strokeStyle = "rgba(7, 9, 7, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(egoFront.x, egoFront.y);
    ctx.lineTo(egoRearLeft.x, egoRearLeft.y);
    ctx.lineTo(egoRearRight.x, egoRearRight.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(232, 246, 245, 0.72)";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText("BEV ego frame / nuScenes 标注目标", 14, 24);
  }, [canvasRef, frame]);
}

function useMapCanvas(frames: PerceptionFrame[], currentFrame: PerceptionFrame | null, canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const parent = canvas.parentElement;
    const cssWidth = Math.max(parent?.clientWidth ?? 320, 280);
    const cssHeight = Math.max(parent?.clientHeight ?? 220, 180);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const mapBackground = ctx.createLinearGradient(0, 0, cssWidth, cssHeight);
    mapBackground.addColorStop(0, "#071014");
    mapBackground.addColorStop(1, "#050806");
    ctx.fillStyle = mapBackground;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (frames.length < 2) {
      return;
    }

    const currentIndex = currentFrame ? Math.max(0, frames.indexOf(currentFrame)) : 0;
    const panel = { x: 18, y: 18, width: cssWidth - 36, height: cssHeight - 36 };
    const current = currentFrame ?? frames[0];
    const heading = current.ego.yaw;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const view = { front: 76, rear: 12, side: 22 };
    const scale = Math.min(panel.width / (view.side * 2), panel.height / (view.front + view.rear));
    const egoCanvas = {
      x: panel.x + panel.width / 2,
      y: panel.y + panel.height - view.rear * scale,
    };
    const toEgo = (frame: PerceptionFrame) => {
      const dx = frame.ego.x - current.ego.x;
      const dy = frame.ego.y - current.ego.y;
      return {
        forward: cos * dx + sin * dy,
        left: -sin * dx + cos * dy,
      };
    };
    const toCanvas = (forward: number, left: number) => ({
      x: egoCanvas.x + left * scale,
      y: egoCanvas.y - forward * scale,
    });
    const pointToCanvas = (point: { forward: number; left: number }) => toCanvas(point.forward, point.left);

    ctx.save();
    ctx.fillStyle = "rgba(2, 8, 9, 0.72)";
    ctx.strokeStyle = "rgba(116, 215, 231, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(panel.x, panel.y, panel.width, panel.height, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(panel.x, panel.y, panel.width, panel.height, 6);
    ctx.clip();

    const localBackground = ctx.createLinearGradient(0, panel.y, 0, panel.y + panel.height);
    localBackground.addColorStop(0, "rgba(13, 28, 30, 0.82)");
    localBackground.addColorStop(0.48, "rgba(8, 15, 14, 0.92)");
    localBackground.addColorStop(1, "rgba(4, 7, 6, 0.98)");
    ctx.fillStyle = localBackground;
    ctx.fillRect(panel.x, panel.y, panel.width, panel.height);

    ctx.strokeStyle = "rgba(116, 215, 231, 0.08)";
    ctx.lineWidth = 1;
    for (let lateral = -20; lateral <= 20; lateral += 5) {
      const x = egoCanvas.x + lateral * scale;
      ctx.beginPath();
      ctx.moveTo(x, panel.y);
      ctx.lineTo(x, panel.y + panel.height);
      ctx.stroke();
    }
    for (let forward = 0; forward <= view.front; forward += 10) {
      const y = egoCanvas.y - forward * scale;
      ctx.beginPath();
      ctx.moveTo(panel.x, y);
      ctx.lineTo(panel.x + panel.width, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(196, 230, 234, 0.34)";
      ctx.font = "11px Inter, sans-serif";
      if (forward > 0) {
        ctx.fillText(`${forward}m`, panel.x + panel.width - 42, y - 5);
      }
    }

    type EgoPoint = { forward: number; left: number };
    const drawPolyline = (points: EgoPoint[], color: string, width: number, glow = 0, dash: number[] = []) => {
      if (points.length < 2) {
        return;
      }
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      ctx.setLineDash(dash);
      ctx.beginPath();
      points.forEach((routePoint, index) => {
        const point = pointToCanvas(routePoint);
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      ctx.restore();
    };

    const routeStart = Math.max(0, currentIndex - 18);
    const routeEnd = Math.min(frames.length - 1, currentIndex + 82);
    let localRoute = frames.slice(routeStart, routeEnd + 1).map(toEgo);
    localRoute = localRoute.filter((point) => point.forward >= -view.rear - 8 && point.forward <= view.front + 12 && Math.abs(point.left) <= view.side + 16);
    if (localRoute.length < 2) {
      localRoute = [
        { forward: -view.rear, left: 0 },
        { forward: view.front, left: 0 },
      ];
    }

    const offsetRoute = (points: EgoPoint[], halfWidth: number) => {
      const leftEdge: EgoPoint[] = [];
      const rightEdge: EgoPoint[] = [];
      points.forEach((point, index) => {
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        const tangentForward = next.forward - previous.forward;
        const tangentLeft = next.left - previous.left;
        const tangentLength = Math.hypot(tangentForward, tangentLeft) || 1;
        const normalForward = -tangentLeft / tangentLength;
        const normalLeft = tangentForward / tangentLength;
        leftEdge.push({
          forward: point.forward + normalForward * halfWidth,
          left: point.left + normalLeft * halfWidth,
        });
        rightEdge.push({
          forward: point.forward - normalForward * halfWidth,
          left: point.left - normalLeft * halfWidth,
        });
      });
      return { leftEdge, rightEdge };
    };

    const drawRoadStrip = (points: EgoPoint[], halfWidth: number, fill: CanvasGradient | string, stroke: string, glow = 0) => {
      const edges = offsetRoute(points, halfWidth);
      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = stroke;
      ctx.shadowBlur = glow;
      ctx.beginPath();
      edges.leftEdge.forEach((edgePoint, index) => {
        const point = pointToCanvas(edgePoint);
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      edges.rightEdge
        .slice()
        .reverse()
        .forEach((edgePoint) => {
          const point = pointToCanvas(edgePoint);
          ctx.lineTo(point.x, point.y);
        });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return edges;
    };

    const roadFill = ctx.createLinearGradient(0, panel.y, 0, panel.y + panel.height);
    roadFill.addColorStop(0, "rgba(46, 57, 56, 0.88)");
    roadFill.addColorStop(0.55, "rgba(30, 38, 36, 0.92)");
    roadFill.addColorStop(1, "rgba(17, 24, 22, 0.98)");
    const shoulderFill = ctx.createLinearGradient(0, panel.y, 0, panel.y + panel.height);
    shoulderFill.addColorStop(0, "rgba(23, 45, 45, 0.54)");
    shoulderFill.addColorStop(1, "rgba(9, 16, 14, 0.38)");
    drawRoadStrip(localRoute, 10.4, shoulderFill, "rgba(75, 125, 130, 0.18)");
    const laneEdges = drawRoadStrip(localRoute, 6.3, roadFill, "rgba(160, 207, 205, 0.16)", 2);
    drawPolyline(laneEdges.leftEdge, "rgba(213, 230, 214, 0.42)", 1.4);
    drawPolyline(laneEdges.rightEdge, "rgba(213, 230, 214, 0.42)", 1.4);

    for (let marker = 10; marker <= view.front; marker += 10) {
      const routePoint = localRoute.reduce((nearest, point) => (Math.abs(point.forward - marker) < Math.abs(nearest.forward - marker) ? point : nearest), localRoute[0]);
      const y = pointToCanvas(routePoint).y;
      if (y > panel.y + 8 && y < panel.y + panel.height - 8) {
        ctx.save();
        ctx.strokeStyle = "rgba(244, 255, 225, 0.16)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 7]);
        ctx.beginPath();
        ctx.moveTo(egoCanvas.x - 5.8 * scale, y);
        ctx.lineTo(egoCanvas.x + 5.8 * scale, y);
        ctx.stroke();
        ctx.restore();
      }
    }

    const pastRoute = localRoute.filter((point) => point.forward <= 0.8);
    const futureRoute = localRoute.filter((point) => point.forward >= -0.4);
    drawPolyline(pastRoute, "rgba(107, 164, 166, 0.34)", 7);
    drawPolyline(futureRoute, "rgba(84, 211, 240, 0.18)", 11, 10);
    drawPolyline(futureRoute, "#47d9ff", 3.6, 12);
    drawPolyline(futureRoute, "rgba(240, 255, 241, 0.78)", 1.2, 0, [10, 13]);

    current.objects.forEach((object) => {
      if (object.x < -view.rear || object.x > view.front || Math.abs(object.y) > view.side) {
        return;
      }
      const point = toCanvas(object.x, object.y);
      const color = object.risk === "high" ? "#ff5c4a" : object.risk === "medium" ? "#ffd45a" : "#63f2d8";
      const size = object.risk === "low" ? 4 : 5.5;
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = object.risk === "low" ? 4 : 12;
      ctx.beginPath();
      ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
      ctx.fill();
      if (object.risk !== "low") {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(238, 249, 244, 0.84)";
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText(object.label, point.x + 8, point.y - 7);
      }
      ctx.restore();
    });

    ctx.save();
    ctx.shadowColor = "#d9ff63";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(217, 255, 99, 0.95)";
    ctx.strokeStyle = "rgba(4, 8, 6, 0.94)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(egoCanvas.x - 10, egoCanvas.y - 25, 20, 38, 5);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#f2ffbd";
    ctx.beginPath();
    ctx.moveTo(egoCanvas.x, egoCanvas.y - 33);
    ctx.lineTo(egoCanvas.x - 11, egoCanvas.y - 15);
    ctx.lineTo(egoCanvas.x + 11, egoCanvas.y - 15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(232, 246, 245, 0.82)";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText("局部道路跟随 / 车头朝上", panel.x + 12, panel.y + 22);
    ctx.fillStyle = "rgba(157, 218, 225, 0.74)";
    ctx.fillText(`前方 ${view.front}m`, panel.x + panel.width - 72, panel.y + 22);
    ctx.restore();
    ctx.restore();
  }, [canvasRef, currentFrame, frames]);
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const bevCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryFrame[]>([]);
  const [perception, setPerception] = useState<PerceptionFrame[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [datasetMeta, setDatasetMeta] = useState<DatasetMeta | null>(null);
  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>("unknown");
  const [backendModel, setBackendModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentFrame = useMemo(() => findNearestFrame(telemetry, currentTime), [telemetry, currentTime]);
  const currentPerception = useMemo(() => findNearestFrame(perception, currentTime), [perception, currentTime]);
  const frameRisk = deriveFrameRisk(currentFrame, currentPerception);
  const panelRisk = diagnosis?.riskLevel ?? frameRisk;
  const highRiskObjects = currentPerception?.objects.filter((object) => object.risk === "high").length ?? 0;
  const mediumRiskObjects = currentPerception?.objects.filter((object) => object.risk === "medium").length ?? 0;
  const visibleCameraObjects =
    currentPerception?.objects
      .filter((object) => object.cameraBox)
      .filter((object) => {
        const box = object.cameraBox;
        if (!box) {
          return false;
        }
        const areaRatio = (box.width * box.height) / (box.imageWidth * box.imageHeight);
        return object.risk !== "low" || areaRatio > 0.00045;
      })
      .sort((a, b) => riskScore(b.risk) - riskScore(a.risk) || (a.cameraBox?.depth ?? 999) - (b.cameraBox?.depth ?? 999))
      .slice(0, 14) ?? [];
  const sourceLabel = datasetMeta?.sourceLabel ?? "nuScenes mini";
  const sceneName = datasetMeta?.sceneName ?? "等待数据";
  const sampleCount = datasetMeta?.sampleCount ?? telemetry.length;
  const fps = datasetMeta?.videoFps ?? datasetMeta?.fps ?? 24;
  const telemetryFps = datasetMeta?.telemetryFps ?? 12;

  useBevCanvas(currentPerception, bevCanvasRef);
  useMapCanvas(perception, currentPerception, mapCanvasRef);

  const connectSocket = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus("connecting");
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnectionStatus("connected");
      setError(null);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as DiagnosisResult;
        setDiagnosis(payload);
        if (payload.mode) {
          setDiagnosisMode(payload.mode);
        }
        if (payload.model) {
          setBackendModel(payload.model);
        }
        setError(null);
      } catch {
        setError("后端返回的数据不是合法 JSON。");
      } finally {
        setDiagnosing(false);
      }
    };

    socket.onerror = () => {
      setConnectionStatus("error");
      setDiagnosing(false);
      setError("WebSocket 连接异常，请确认后端服务是否启动。");
    };

    socket.onclose = () => {
      setConnectionStatus("disconnected");
      setDiagnosing(false);
      if (reconnectTimerRef.current === null) {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectSocket();
        }, 1800);
      }
    };
  }, []);

  useEffect(() => {
    fetch("/telemetry.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data: TelemetryFrame[]) => setTelemetry(data))
      .catch((fetchError) => setError(`读取 telemetry.json 失败：${fetchError}`));
  }, []);

  useEffect(() => {
    fetch("/perception.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data: PerceptionFrame[]) => setPerception(data))
      .catch(() => setPerception([]));
  }, []);

  useEffect(() => {
    fetch("/dataset-meta.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data: DatasetMeta) => setDatasetMeta(data))
      .catch(() => setDatasetMeta(null));
  }, []);

  useEffect(() => {
    let active = true;

    const refreshHealth = () => {
      fetch(`${API_URL}/health`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((data: HealthStatus) => {
          if (!active) {
            return;
          }
          setDiagnosisMode(data.mode);
          setBackendModel(data.model);
        })
        .catch(() => {
          if (active) {
            setDiagnosisMode("unknown");
          }
        });
    };

    refreshHealth();
    const timer = window.setInterval(refreshHealth, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    connectSocket();
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, [connectSocket]);

  useEffect(() => {
    const tick = () => {
      setCurrentTime(videoRef.current?.currentTime ?? 0);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const handleDiagnose = () => {
    if (!currentFrame) {
      setError("当前没有可发送的车辆状态。");
      return;
    }

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("后端 WebSocket 尚未连接。");
      connectSocket();
      return;
    }

    setDiagnosing(true);
    setError(null);
    socket.send(
      JSON.stringify({
        type: "diagnose",
        frame: {
          ...currentFrame,
          perceptionSummary: {
            objectCount: currentPerception?.objects.length ?? 0,
            highRiskObjects,
            mediumRiskObjects,
          },
        },
      }),
    );
  };

  const metricItems = [
    { label: "车速", value: `${formatNumber(currentFrame?.speedKmh ?? NaN)} km/h`, icon: Gauge },
    { label: "刹车", value: formatNumber(currentFrame?.brake ?? NaN, 2), icon: ShieldCheck },
    { label: "油门", value: formatNumber(currentFrame?.throttle ?? NaN, 2), icon: Zap },
    { label: "转向", value: formatNumber(currentFrame?.steering ?? NaN, 2), icon: Activity },
    { label: "加速度", value: `${formatNumber(currentFrame?.accel ?? NaN, 2)} m/s²`, icon: Radio },
    { label: "目标", value: `${currentPerception?.objects.length ?? 0}`, icon: Layers3 },
  ];

  return (
    <main className="app-shell">
      <section className="command-grid">
        <header className="header-bar">
          <div>
            <p className="eyebrow">nuScenes mini real-scene diagnosis</p>
            <h1>智驾感知诊断驾驶舱</h1>
          </div>
          <div className="header-actions">
            <span className={`status-dot status-${connectionStatus}`}>{statusText[connectionStatus]}</span>
            <span className={`risk-pill risk-${panelRisk}`}>{riskText[panelRisk]}</span>
          </div>
        </header>

        <section className="camera-panel">
          <div className="panel-title">
            <Camera size={18} aria-hidden="true" />
            <span>前视相机 CAM_FRONT</span>
            <strong>{formatNumber(currentTime, 2)}s</strong>
          </div>
          <div className="video-frame">
            <video
              ref={videoRef}
              src="/sample.mp4"
              controls
              autoPlay
              muted
              playsInline
              loop
              preload="auto"
              onLoadedData={() => {
                void videoRef.current?.play().catch(() => undefined);
              }}
            />
            <div className="video-hud">
              <span>VIDEO {formatNumber(fps, 0)} FPS</span>
              <span>FRAME {currentPerception ? perception.indexOf(currentPerception) + 1 : "--"}/{sampleCount ?? telemetry.length}</span>
              <span>{sceneName}</span>
            </div>
            <div className="video-reticle" aria-hidden="true" />
            <div className="camera-targets">
              {visibleCameraObjects.map((object, index) => {
                const box = object.cameraBox;
                if (!box) {
                  return null;
                }
                return (
                  <span
                    className={`camera-target target-${object.risk}`}
                    key={`${object.id}-${index}`}
                    style={{
                      left: `${(box.x / box.imageWidth) * 100}%`,
                      top: `${(box.y / box.imageHeight) * 100}%`,
                      width: `${(box.width / box.imageWidth) * 100}%`,
                      height: `${(box.height / box.imageHeight) * 100}%`,
                    }}
                    title={`${object.label} ${formatNumber(box.depth, 1)}m`}
                  >
                    <span>{object.label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="diagnosis-panel">
          <div className="panel-title">
            <BrainCircuit size={18} aria-hidden="true" />
            <span>AI 全域诊断</span>
          </div>

          <div className="metrics-grid">
            {metricItems.map((item) => {
              const Icon = item.icon;
              return (
                <div className="metric-card" key={item.label}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              );
            })}
          </div>

          <div className="scene-box">
            <span>场景状态</span>
            <p>{currentFrame?.scene ?? "等待 nuScenes telemetry 加载..."}</p>
            <div className="risk-meter" aria-hidden="true">
              <span className={`meter-segment ${panelRisk === "low" ? "meter-active" : ""}`} />
              <span className={`meter-segment ${panelRisk === "medium" ? "meter-active" : ""}`} />
              <span className={`meter-segment ${panelRisk === "high" ? "meter-active" : ""}`} />
            </div>
          </div>

          <button
            className="diagnose-button"
            type="button"
            onClick={handleDiagnose}
            disabled={diagnosing || connectionStatus !== "connected" || !currentFrame}
          >
            {diagnosing ? <LoaderCircle className="spin" size={19} /> : <BrainCircuit size={19} />}
            {diagnosing ? "诊断中" : "全域诊断"}
          </button>

          {error && (
            <div className="message error-message">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="result-panel">
            <div className="result-title">
              <BrainCircuit size={18} aria-hidden="true" />
              <span>诊断分析</span>
            </div>
            <p>{diagnosis?.thought ?? "点击全域诊断后，这里会展示后端返回的风险分析。"}</p>
          </div>

          <div className="result-panel conclusion-panel">
            <div className="result-title">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>最终结论</span>
            </div>
            <p>{diagnosis?.conclusion ?? "等待当前帧诊断结果。"}</p>
          </div>
        </aside>

        <section className="bev-panel">
          <div className="panel-title">
            <Layers3 size={18} aria-hidden="true" />
            <span>3D/BEV 感知</span>
            <strong>高危 {highRiskObjects} / 中危 {mediumRiskObjects}</strong>
          </div>
          <div className="canvas-stage">
            <canvas ref={bevCanvasRef} />
          </div>
        </section>

        <section className="map-panel">
          <div className="panel-title">
            <Map size={18} aria-hidden="true" />
            <span>地图与轨迹</span>
            <strong>{currentPerception ? `${formatNumber(currentPerception.ego.latitude, 5)}, ${formatNumber(currentPerception.ego.longitude, 5)}` : "--"}</strong>
          </div>
          <div className="canvas-stage map-stage">
            <canvas ref={mapCanvasRef} />
          </div>
          <div className="metadata-strip">
            <span title={sceneName}>
              <Database size={15} aria-hidden="true" />
              {sourceLabel}
            </span>
            <span title={backendModel ?? "本地规则诊断"}>
              <ServerCog size={15} aria-hidden="true" />
              {modeText[diagnosisMode]} {backendModel ? `· ${backendModel}` : ""}
            </span>
            <span title={datasetMeta?.frameMode ?? ""}>
              <Route size={15} aria-hidden="true" />
              {datasetMeta?.frameMode ?? "continuous frames"}
            </span>
            <span title="视频插帧渲染帧率 / telemetry 原始时间轴">
              <GitBranch size={15} aria-hidden="true" />
              video {formatNumber(fps, 0)}fps · telemetry {formatNumber(telemetryFps, 0)}fps
            </span>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
