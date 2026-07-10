import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { RiskEventsPanel } from "./RiskEventsPanel";
import { deriveRiskEvents } from "./risk-events";
import type { RiskEvent } from "./risk-events";
import { LidarBev } from "./LidarBev";
import { findNearestLidarFrame, LidarFrameCache, loadLidarIndex } from "./lidar";
import type { LidarIndex } from "./lidar";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  Camera,
  CircleCheck,
  Database,
  FileSearch,
  Gauge,
  GitBranch,
  Layers3,
  LoaderCircle,
  Map,
  LocateFixed,
  Minus,
  Move,
  Plus,
  Radio,
  Route,
  ChevronDown,
  ServerCog,
  Shield,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

type RiskLevel = "low" | "medium" | "high" | "unknown";
type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type DiagnosisMode = "model" | "fallback" | "unknown";
type MapViewport = { zoom: number; offsetX: number; offsetY: number };

const DEFAULT_MAP_VIEWPORT: MapViewport = { zoom: 1, offsetX: 0, offsetY: 0 };
const clampMapZoom = (zoom: number) => Math.min(2.6, Math.max(0.55, zoom));

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

type SceneManifestEntry = {
  id: string;
  label: string;
  description?: string;
  videoFile: string;
  telemetryFile: string;
  perceptionFile: string;
  metadataFile?: string;
  lidarIndexFile?: string;
  /** Optional cue for event history; other modules may consume this unchanged. */
  riskEventsFile?: string;
};

type SceneManifest = {
  version: number;
  defaultSceneId: string;
  scenes: SceneManifestEntry[];
};

type HealthStatus = {
  status: string;
  mode: Exclude<DiagnosisMode, "unknown">;
  model: string;
};

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const LEGACY_SCENE: SceneManifestEntry = {
  id: "default",
  label: "默认实景",
  videoFile: "/sample.mp4",
  telemetryFile: "/telemetry.json",
  perceptionFile: "/perception.json",
  metadataFile: "/dataset-meta.json",
};

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

/** Returns null for camera-only scenes so stale LiDAR data is never retained. */
export function resolveLidarSource(scene: Pick<SceneManifestEntry, "lidarIndexFile">): string | null {
  return scene.lidarIndexFile ?? null;
}

/** Keep every replay consumer on the risk event's recorded peak timestamp. */
export function resolveReplayTime(event: Pick<RiskEvent, "seekTime">): number {
  return event.seekTime;
}

export type OptionalLidarLoadResult = {
  index: LidarIndex | null;
  errorMessage: string | null;
};

/** Load the optional LiDAR index without allowing its failure to reject scene data loading. */
export async function loadOptionalLidarIndex(
  lidarSource: string,
  signal?: AbortSignal,
  loader: (url: string, signal?: AbortSignal) => Promise<LidarIndex> = loadLidarIndex,
): Promise<OptionalLidarLoadResult> {
  try {
    return { index: await loader(lidarSource, signal), errorMessage: null };
  } catch (error: unknown) {
    return { index: null, errorMessage: error instanceof Error ? error.message : String(error) };
  }
}

function resolveLidarFrameUrl(indexFile: string, frameFile: string): string {
  return new URL(frameFile, new URL(indexFile, window.location.origin)).toString();
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

function drawEgoCar(ctx: CanvasRenderingContext2D, x: number, y: number, size = 1, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(255, 53, 123, .72)";
  ctx.shadowBlur = 18 * size;
  const body = ctx.createLinearGradient(0, -18 * size, 0, 18 * size);
  body.addColorStop(0, "#ff7ba9");
  body.addColorStop(.45, "#f34886");
  body.addColorStop(1, "#c91f60");
  ctx.fillStyle = body;
  ctx.strokeStyle = "#ffd5e4";
  ctx.lineWidth = 1.4 * size;
  ctx.beginPath();
  ctx.roundRect(-8 * size, -17 * size, 16 * size, 34 * size, 5 * size);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#5f183b";
  ctx.beginPath();
  ctx.roundRect(-5.2 * size, -9.5 * size, 10.4 * size, 13 * size, 3 * size);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.68)";
  ctx.fillRect(-4.1 * size, -8.1 * size, 8.2 * size, 1.6 * size);
  ctx.fillStyle = "#311126";
  [-1, 1].forEach((side) => {
    ctx.beginPath(); ctx.roundRect(side * 8 * size - (side > 0 ? 0 : 2 * size), -11 * size, 2 * size, 7 * size, 1 * size); ctx.fill();
    ctx.beginPath(); ctx.roundRect(side * 8 * size - (side > 0 ? 0 : 2 * size), 5 * size, 2 * size, 7 * size, 1 * size); ctx.fill();
  });
  ctx.fillStyle = "#ffe2ec";
  ctx.fillRect(-5.2 * size, -15.1 * size, 10.4 * size, 2.1 * size);
  ctx.restore();
}

function useBevCanvas(frames: PerceptionFrame[], frame: PerceptionFrame | null, canvasRef: React.RefObject<HTMLCanvasElement | null>) {
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
    background.addColorStop(0, "#f9fcf8");
    background.addColorStop(.58, "#edf4ef");
    background.addColorStop(1, "#e1ece5");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    // Oblique ground-plane projection: the far grid compresses toward the horizon.
    const toCanvas = (point: { x: number; y: number }) => {
      const depth = Math.min(1, Math.max(0, (point.x + view.rear) / (view.front + view.rear)));
      const lateralScale = 1.18 - depth * .68;
      return {
        x: origin.x + point.y * scale * lateralScale,
        y: origin.y - point.x * scale * (.74 + depth * .26),
      };
    };

    ctx.strokeStyle = "rgba(72, 111, 106, 0.15)";
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
        ctx.fillStyle = "rgba(62, 96, 91, 0.52)";
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText(`${longitudinal}m`, b.x - 30, b.y - 6);
      }
    }

    const leftFov = toCanvas({ x: 66, y: 36 });
    const rightFov = toCanvas({ x: 66, y: -36 });
    ctx.save();
    ctx.fillStyle = "rgba(104, 169, 148, 0.10)";
    ctx.strokeStyle = "rgba(66, 129, 119, 0.34)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(leftFov.x, leftFov.y);
    ctx.lineTo(rightFov.x, rightFov.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const currentIndex = frame ? frames.indexOf(frame) : -1;
    // A short temporal stack makes it explicit that this is fused BEV, not a single-frame top view.
    if (currentIndex > 0) {
      for (let age = 4; age >= 1; age -= 1) {
        const source = frames[currentIndex - age];
        if (!source) continue;
        source.objects.slice(0, 18).forEach((object) => {
          if (object.x < -view.rear || object.x > view.front || Math.abs(object.y) > view.side) return;
          const p = toCanvas(object);
          ctx.save(); ctx.globalAlpha = .07 + (4 - age) * .035;
          ctx.fillStyle = "#7fa99d"; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, object.width * scale * .28), 0, Math.PI * 2); ctx.fill(); ctx.restore();
        });
      }
    }
    const drawObject = (object: PerceptionObject) => {
      const distance = Math.hypot(object.x, object.y);
      if (object.x < -view.rear || object.x > view.front || Math.abs(object.y) > view.side) {
        return;
      }
      if (object.risk === "low" && distance > 52) {
        return;
      }
      const color = object.risk === "high" ? "#f05a91" : object.risk === "medium" ? "#d9a83d" : "#4f9188";
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

      // Extruded object prism: ground footprint, lifted top face and visible side faces.
      const lift = Math.max(5, Math.min(18, object.height * scale * .75));
      const topCorners = corners.map((corner) => ({ x: corner.x, y: corner.y - lift }));
      ctx.save();
      ctx.fillStyle = object.risk === "high" ? "rgba(240, 90, 145, .19)" : object.risk === "medium" ? "rgba(217, 168, 61, .16)" : "rgba(79,145,136,.13)";
      ctx.beginPath(); ctx.ellipse(corners.reduce((sum, point) => sum + point.x, 0) / 4, corners.reduce((sum, point) => sum + point.y, 0) / 4 + 4, Math.max(5, object.width * scale * .65), Math.max(2, object.width * scale * .2), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.globalAlpha = .18;
      ctx.beginPath(); ctx.moveTo(corners[1].x, corners[1].y); ctx.lineTo(corners[2].x, corners[2].y); ctx.lineTo(topCorners[2].x, topCorners[2].y); ctx.lineTo(topCorners[1].x, topCorners[1].y); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = .28;
      ctx.beginPath(); ctx.moveTo(corners[2].x, corners[2].y); ctx.lineTo(corners[3].x, corners[3].y); ctx.lineTo(topCorners[3].x, topCorners[3].y); ctx.lineTo(topCorners[2].x, topCorners[2].y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = color;
      ctx.fillStyle = object.risk === "high" ? "rgba(240, 90, 145, 0.16)" : object.risk === "medium" ? "rgba(217, 168, 61, 0.14)" : "rgba(79, 145, 136, 0.11)";
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
      ctx.globalAlpha = .92;
      ctx.beginPath(); topCorners.forEach((corner, index) => index ? ctx.lineTo(corner.x, corner.y) : ctx.moveTo(corner.x, corner.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
      [0, 1, 2, 3].forEach((index) => { ctx.beginPath(); ctx.moveTo(corners[index].x, corners[index].y); ctx.lineTo(topCorners[index].x, topCorners[index].y); ctx.stroke(); });
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

    drawEgoCar(ctx, origin.x, origin.y, Math.max(.68, scale / 11));

    ctx.fillStyle = "rgba(39, 72, 68, .9)";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText("BEV / nuScenes 感知目标", 14, 24);
    const legendY = h - 16;
    const legend = [
      { color: "#4f9188", label: "常规" },
      { color: "#d9a83d", label: "关注" },
      { color: "#f05a91", label: "高危" },
    ];
    let legendX = 14;
    legend.forEach((item) => {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(legendX + 4, legendY - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(39, 72, 68, .72)";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(item.label, legendX + 12, legendY);
      legendX += 48;
    });
    ctx.fillStyle = "rgba(39, 72, 68, .58)";
    ctx.textAlign = "right";
    ctx.fillText(`对象 ${frame?.objects.length ?? 0}`, w - 14, legendY);
    ctx.textAlign = "left";
  }, [canvasRef, frame, frames]);
}

function useMapCanvas(
  frames: PerceptionFrame[],
  currentFrame: PerceptionFrame | null,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewport: MapViewport,
  highlightedRiskEvent: RiskEvent | null,
) {
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
    mapBackground.addColorStop(0, "#f8fcf8");
    mapBackground.addColorStop(1, "#e5efe8");
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
    const scale = Math.min(panel.width / (view.side * 2), panel.height / (view.front + view.rear)) * viewport.zoom;
    const egoCanvas = {
      x: panel.x + panel.width / 2 + viewport.offsetX,
      y: panel.y + panel.height - view.rear * scale + viewport.offsetY,
    };
    const visibleBounds = {
      minLeft: (panel.x - egoCanvas.x) / scale,
      maxLeft: (panel.x + panel.width - egoCanvas.x) / scale,
      minForward: (egoCanvas.y - (panel.y + panel.height)) / scale,
      maxForward: (egoCanvas.y - panel.y) / scale,
    };
    const toEgo = (frame: PerceptionFrame) => {
      const dx = frame.ego.x - current.ego.x;
      const dy = frame.ego.y - current.ego.y;
      return {
        forward: cos * dx + sin * dy,
        left: -sin * dx + cos * dy,
      };
    };
    const toCanvas = (forward: number, left: number) => {
      const depth = Math.min(1, Math.max(0, (forward - visibleBounds.minForward) / (visibleBounds.maxForward - visibleBounds.minForward || 1)));
      const lateralScale = 1.12 - depth * .58;
      return {
        x: egoCanvas.x + left * scale * lateralScale,
        y: egoCanvas.y - forward * scale * (.76 + depth * .24),
      };
    };
    const pointToCanvas = (point: { forward: number; left: number }) => toCanvas(point.forward, point.left);

    ctx.save();
    ctx.fillStyle = "rgba(251, 253, 250, 0.94)";
    ctx.strokeStyle = "rgba(83, 125, 118, 0.22)";
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
    localBackground.addColorStop(0, "rgba(244, 249, 245, 0.98)");
    localBackground.addColorStop(0.48, "rgba(233, 242, 236, 0.99)");
    localBackground.addColorStop(1, "rgba(220, 233, 225, 1)");
    ctx.fillStyle = localBackground;
    ctx.fillRect(panel.x, panel.y, panel.width, panel.height);

    ctx.strokeStyle = "rgba(70, 112, 105, 0.10)";
    ctx.lineWidth = 1;
    const lateralStart = Math.floor(visibleBounds.minLeft / 5) * 5;
    const lateralEnd = Math.ceil(visibleBounds.maxLeft / 5) * 5;
    for (let lateral = lateralStart; lateral <= lateralEnd; lateral += 5) {
      const x = egoCanvas.x + lateral * scale;
      ctx.beginPath();
      ctx.moveTo(x, panel.y);
      ctx.lineTo(x, panel.y + panel.height);
      ctx.stroke();
    }
    const forwardStart = Math.ceil(visibleBounds.minForward / 10) * 10;
    const forwardEnd = Math.floor(visibleBounds.maxForward / 10) * 10;
    for (let forward = forwardStart; forward <= forwardEnd; forward += 10) {
      const y = egoCanvas.y - forward * scale;
      ctx.beginPath();
      ctx.moveTo(panel.x, y);
      ctx.lineTo(panel.x + panel.width, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(78, 119, 111, 0.30)";
      ctx.font = "11px Inter, sans-serif";
      if (forward > 0 && y > panel.y + 12 && y < panel.y + panel.height - 8) {
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
    localRoute = localRoute.filter(
      (point) =>
        point.forward >= visibleBounds.minForward - 12 &&
        point.forward <= visibleBounds.maxForward + 12 &&
        point.left >= visibleBounds.minLeft - 12 &&
        point.left <= visibleBounds.maxLeft + 12,
    );
    if (localRoute.length < 2) {
      localRoute = [
        { forward: visibleBounds.minForward, left: 0 },
        { forward: visibleBounds.maxForward, left: 0 },
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
    roadFill.addColorStop(0, "rgba(211, 222, 214, 0.97)");
    roadFill.addColorStop(0.55, "rgba(192, 207, 197, 0.98)");
    roadFill.addColorStop(1, "rgba(178, 195, 184, 1)");
    const shoulderFill = ctx.createLinearGradient(0, panel.y, 0, panel.y + panel.height);
    shoulderFill.addColorStop(0, "rgba(157, 190, 171, 0.42)");
    shoulderFill.addColorStop(1, "rgba(137, 173, 152, 0.30)");
    // Raised sand-table road layers: offset shadows create a tangible roadbed.
    const roadShadow = localRoute.map((point) => ({ forward: point.forward - .85, left: point.left }));
    drawRoadStrip(roadShadow, 11.2, "rgba(107, 139, 121, .16)", "rgba(82, 114, 99, .16)", 4);
    drawRoadStrip(localRoute, 10.4, shoulderFill, "rgba(73, 122, 111, 0.18)");
    const laneEdges = drawRoadStrip(localRoute, 6.3, roadFill, "rgba(75, 111, 102, 0.22)", 3);
    drawPolyline(laneEdges.leftEdge, "rgba(255, 255, 251, 0.76)", 1.4);
    drawPolyline(laneEdges.rightEdge, "rgba(255, 255, 251, 0.76)", 1.4);

    for (let marker = Math.max(10, Math.ceil(visibleBounds.minForward / 10) * 10); marker <= visibleBounds.maxForward; marker += 10) {
      const routePoint = localRoute.reduce((nearest, point) => (Math.abs(point.forward - marker) < Math.abs(nearest.forward - marker) ? point : nearest), localRoute[0]);
      const y = pointToCanvas(routePoint).y;
      if (y > panel.y + 8 && y < panel.y + panel.height - 8) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 251, 0.74)";
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
    drawPolyline(pastRoute, "rgba(82, 122, 115, 0.25)", 7);
    drawPolyline(futureRoute, "rgba(105, 160, 149, 0.19)", 11, 4);
    drawPolyline(futureRoute, "#4e9388", 3.2, 6);
    drawPolyline(futureRoute, "rgba(250, 255, 248, 0.84)", 1.1, 0, [10, 13]);

    current.objects.forEach((object) => {
      if (
        object.x < visibleBounds.minForward ||
        object.x > visibleBounds.maxForward ||
        object.y < visibleBounds.minLeft ||
        object.y > visibleBounds.maxLeft
      ) {
        return;
      }
      const point = toCanvas(object.x, object.y);
      const color = object.risk === "high" ? "#f05a91" : object.risk === "medium" ? "#d9a83d" : "#4f9188";
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
        ctx.fillStyle = "rgba(29, 59, 55, 0.88)";
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText(object.label, point.x + 8, point.y - 7);
      }
      ctx.restore();
    });

    drawEgoCar(ctx, egoCanvas.x, egoCanvas.y - 4, 1.1);

    ctx.save();
    ctx.fillStyle = "rgba(32, 68, 63, 0.88)";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText("局部道路跟随 / 车头朝上", panel.x + 12, panel.y + 22);
    ctx.fillStyle = "rgba(62, 104, 97, 0.72)";
    ctx.fillText(`前方 ${Math.max(0, Math.round(visibleBounds.maxForward))}m`, panel.x + panel.width - 72, panel.y + 22);
    ctx.restore();
    ctx.restore();

    // Persistent scene overview: the complete path remains visible as the ego car advances.
    const overview = { x: panel.x + 12, y: panel.y + 34, width: Math.min(150, panel.width * .36), height: Math.min(108, panel.height * .34) };
    const xs = frames.map((item) => item.ego.x);
    const ys = frames.map((item) => item.ego.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const range = Math.max(maxX - minX, maxY - minY, 1);
    const overviewPoint = (item: PerceptionFrame) => ({
      x: overview.x + 10 + ((item.ego.x - minX) / range) * (overview.width - 20),
      y: overview.y + overview.height - 10 - ((item.ego.y - minY) / range) * (overview.height - 20),
    });
    ctx.save();
    ctx.fillStyle = "rgba(249, 252, 249, .86)";
    ctx.strokeStyle = "rgba(111, 151, 139, .30)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(overview.x, overview.y, overview.width, overview.height, 7); ctx.fill(); ctx.stroke();
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = "rgba(48, 85, 78, .78)";
    ctx.fillText("SCENE TRAIL · PERSISTENT", overview.x + 9, overview.y + 15);
    ctx.beginPath();
    frames.forEach((item, index) => {
      const p = overviewPoint(item);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = "rgba(78, 147, 136, .45)"; ctx.lineWidth = 2.2; ctx.stroke();
    if (highlightedRiskEvent) {
      const riskSegment = frames.filter((item) => item.time >= highlightedRiskEvent.startTime && item.time <= highlightedRiskEvent.endTime);
      if (riskSegment.length > 0) {
        ctx.beginPath();
        riskSegment.forEach((item, index) => {
          const point = overviewPoint(item);
          if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
        });
        ctx.strokeStyle = highlightedRiskEvent.risk === "high" ? "#f05a91" : "#d9a83d";
        ctx.lineWidth = 4; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 9; ctx.stroke();
      }
    }
    const traveled = frames.slice(0, currentIndex + 1);
    ctx.beginPath(); traveled.forEach((item, index) => { const p = overviewPoint(item); if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.strokeStyle = "#f05a91"; ctx.lineWidth = 2.8; ctx.shadowColor = "#f05a91"; ctx.shadowBlur = 8; ctx.stroke();
    const marker = overviewPoint(current);
    ctx.fillStyle = "#f05a91"; ctx.beginPath(); ctx.arc(marker.x, marker.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }, [canvasRef, currentFrame, frames, highlightedRiskEvent, viewport]);
}

function ProjectSite({ onOpenDemo }: { onOpenDemo: () => void }) {
  const navItems = [["项目缘起", "#origin"], ["安全命题", "#context"], ["产品体系", "#product"], ["效果展示", "#demo"]];
  return <main className="showcase">
    <section className="showcase-hero" id="home">
      <video className="hero-video" src="/sample.mp4" autoPlay muted loop playsInline />
      <div className="hero-wash" />
      <nav className="showcase-nav">
        <a className="brand" href="#home"><span className="brand-mark"><Shield size={18} /></span><span>智驾卫士</span><small>DRIVEGUARD</small></a>
        <div className="nav-links">{navItems.map(([label, href]) => <a href={href} key={href}>{label}</a>)}</div>
        <a className="contact-link" href="mailto:23050824@hdu.edu.cn">联系我们 <ArrowUpRight size={15} /></a>
      </nav>
      <div className="hero-content content-width">
        <p className="kicker"><span /> EXPLAINABLE AUTONOMY · 01</p>
        <h1>让每一次<br /><em>自动驾驶决策</em>有据可循</h1>
        <p className="hero-copy">面向智能驾驶研发、测试验证与安全审计的多智能体协作诊断平台。将不可见的失效路径，转化为可追溯、可复现、可优化的证据闭环。</p>
        <div className="hero-actions"><button className="primary-cta" type="button" onClick={onOpenDemo}>进入效果展示 <ArrowDownRight size={18} /></button><a className="text-cta" href="#product">了解系统架构 <ArrowUpRight size={17} /></a></div>
      </div>
      <div className="hero-foot content-width"><span>HANGZHOU DIANZI UNIVERSITY</span><span>2026 / RESEARCH PROTOTYPE</span><span>SCROLL TO EXPLORE ↓</span></div>
    </section>

    <section className="intro-section content-width" id="origin">
      <div className="section-index">01 / WHY NOW</div>
      <div className="intro-grid"><h2>从“能跑”到<br />“<em>说得清</em>为什么这样跑”</h2><div className="intro-copy"><p>智能驾驶正从功能验证迈向规模化应用。真正的安全，不止是识别一个目标，更在于能够还原关键时刻的感知、决策与控制链路。</p><p>智驾卫士将事故复盘从依赖经验的手工劳动，变成由多智能体协同完成的结构化诊断。</p></div></div>
      <div className="proof-strip"><span><b>非侵入</b>接入</span><span><b>跨层</b>归因</span><span><b>闭环</b>优化</span><span><b>可审计</b>交付</span></div>
    </section>

    <section className="policy-section" id="context"><div className="content-width">
      <div className="section-index">02 / THE CONTEXT</div><div className="context-head"><h2>安全监管正在要求<br /><em>过程可信</em></h2><p>从智能网联汽车准入与上路通行试点，到“车路云一体化”应用试点，行业评价标准正由单一功能表现，转向运行边界、关键决策与安全响应的可验证能力。</p></div>
      <div className="policy-grid"><article><span>2020</span><h3>智能汽车创新发展战略</h3><p>智能汽车体系建设进入国家战略视野。</p></article><article><span>2023</span><h3>准入与上路通行试点</h3><p>L3/L4 产品在限定区域开展验证与试点。</p></article><article><span>2024</span><h3>车路云一体化应用试点</h3><p>以数据处理与安全保障加快规模化落地。</p></article></div>
    </div></section>

    <section className="pain-section content-width"><div className="section-index">03 / THE GAP</div><div className="pain-header"><h2>复杂系统的失效，<br />不该只得到一句<em>“未识别”</em></h2><p>在长尾场景里，感知偏差、决策误判和控制策略会发生级联放大。现有“人工日志回放 + 规则匹配”的方式，很难回答根因，也难以沉淀为下一次的修复路径。</p></div><div className="pain-grid"><article><b>01</b><h3>数据孤岛</h3><p>多源数据分散在传感器、模型特征与控制链路中，难以时空对齐。</p></article><article><b>02</b><h3>黑箱归因</h3><p>系统只留下结果，研发人员无法定位“为什么在此刻做出这个决策”。</p></article><article><b>03</b><h3>被动修复</h3><p>海量正常日志淹没高价值失效样本，模型迭代仍依赖经验与猜测。</p></article></div></section>

    <section className="product-section" id="product"><div className="content-width"><div className="product-top"><div><div className="section-index">04 / OUR ANSWER</div><h2>把每一次异常<br />沉淀为下一次<em>进化</em></h2></div><p>以标准化协议连接数据，以协同智能体组织证据，以自动化闭环推动模型优化。</p></div><div className="architecture-card"><div className="architecture-title"><Sparkles size={18} /> 多智能体协作诊断引擎 <span>DIAGNOSIS ORCHESTRATION</span></div><div className="agent-flow"><div className="agent-node"><Database /><small>01</small><h3>协议接入</h3><p>非侵入式汇集多模态数据流</p></div><i /><div className="agent-node active"><BrainCircuit /><small>02</small><h3>诊断编排</h3><p>动态调度感知与决策分析</p></div><i /><div className="agent-node"><FileSearch /><small>03</small><h3>证据解码</h3><p>量化偏差，审计逻辑链</p></div><i /><div className="agent-node"><ShieldCheck /><small>04</small><h3>闭环优化</h3><p>产出高价值修复数据包</p></div></div></div><div className="feature-grid"><article><CircleCheck size={19} /><h3>算法结构描述协议</h3><p>不触碰模型权重，兼顾接入深度、数据主权与跨架构适配。</p></article><article><CircleCheck size={19} /><h3>数学 + 逻辑双重证据</h3><p>连接感知语义漂移与决策逻辑审计，让诊断结论可验证。</p></article><article><CircleCheck size={19} /><h3>诊断即训练</h3><p>从失效根因反向生成正确/错误推理对，驱动针对性迭代。</p></article></div></div></section>

    <section className="demo-section" id="demo"><div className="content-width"><div className="demo-head"><div><div className="section-index">05 / LIVE PROTOTYPE</div><h2>让证据，<em>看得见</em></h2></div><p>当前效果展示基于 nuScenes 真实连续场景：视频、目标感知、BEV、局部轨迹与 AI 风险诊断在同一时间轴联动。完整工程平台仍在持续建设。</p></div><div className="demo-card"><div className="demo-card-top"><span><i /> DRIVEGUARD / LIVE DEMO</span><span>nuScenes mini · CAM_FRONT</span></div><div className="demo-visual"><video src="/sample.mp4" autoPlay muted loop playsInline /><div className="demo-overlay"><span>前视相机 · 实时目标感知</span><b>风险诊断<br />驾驶舱</b><div className="demo-metrics"><span>12.4 km/h</span><span>BEV 14 objects</span><span>LOW RISK</span></div></div><div className="mini-map"><Map size={18}/><i/><i/><i/><b /></div></div><div className="demo-card-bottom"><p>这是当前可运行的工程 Demo。点击进入后，可查看真实感知框、历史风险事件、多场景数据入口与可交互地图。</p><button type="button" onClick={onOpenDemo}>打开驾驶舱 <ArrowUpRight size={17}/></button></div></div></div></section>

    <footer className="showcase-footer" id="contact"><div className="content-width"><p className="kicker"><span /> LET'S MAKE AUTONOMY ACCOUNTABLE</p><h2>安全不是一句承诺。<br /><em>它应当被证明。</em></h2><a href="mailto:23050824@hdu.edu.cn">23050824@hdu.edu.cn <ArrowUpRight /></a><div className="footer-bottom"><span>智驾卫士 / DRIVEGUARD</span><span>杭州电子科技大学 · 计算机学院</span><span>© 2026</span></div></div></footer>
  </main>;
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapDragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryFrame[]>([]);
  const [perception, setPerception] = useState<PerceptionFrame[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [datasetMeta, setDatasetMeta] = useState<DatasetMeta | null>(null);
  const [scenes, setScenes] = useState<SceneManifestEntry[]>([LEGACY_SCENE]);
  const [selectedSceneId, setSelectedSceneId] = useState(LEGACY_SCENE.id);
  const [sceneLoading, setSceneLoading] = useState(true);
  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>("unknown");
  const [backendModel, setBackendModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapViewport, setMapViewport] = useState<MapViewport>(DEFAULT_MAP_VIEWPORT);
  const [showDashboard, setShowDashboard] = useState(false);
  const [lidarIndex, setLidarIndex] = useState<LidarIndex | null>(null);
  const [lidarStatus, setLidarStatus] = useState<"loading" | "unavailable" | "ready" | "error">("loading");
  const [lidarError, setLidarError] = useState<string | null>(null);
  const [lidarCache] = useState(() => new LidarFrameCache());
  const [currentPointCloud, setCurrentPointCloud] = useState<Float32Array | null>(null);
  const [lidarHistory, setLidarHistory] = useState<Float32Array[]>([]);
  const [selectedRiskEventId, setSelectedRiskEventId] = useState<string | null>(null);

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
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? LEGACY_SCENE;
  const riskEvents = useMemo(() => deriveRiskEvents(telemetry, perception), [telemetry, perception]);
  const completedRiskEvents = useMemo(
    () => riskEvents.filter((event) => event.endTime <= currentTime + 0.05),
    [currentTime, riskEvents],
  );
  const highlightedRiskEvent = useMemo(
    () => riskEvents.find((event) => event.id === selectedRiskEventId)
      ?? riskEvents.find((event) => currentTime >= event.startTime && currentTime <= event.endTime)
      ?? null,
    [currentTime, riskEvents, selectedRiskEventId],
  );
  const currentLidarFrame = useMemo(
    () => lidarIndex ? findNearestLidarFrame(lidarIndex, currentTime) : null,
    [currentTime, lidarIndex],
  );

  useMapCanvas(perception, currentPerception, mapCanvasRef, mapViewport, highlightedRiskEvent);

  const updateMapZoom = useCallback((factor: number) => {
    setMapViewport((viewport) => ({ ...viewport, zoom: clampMapZoom(viewport.zoom * factor) }));
  }, []);

  const resetMapViewport = useCallback(() => setMapViewport(DEFAULT_MAP_VIEWPORT), []);

  const handleMapPointerDown = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    mapDragStartRef.current = { x: event.clientX, y: event.clientY, offsetX: mapViewport.offsetX, offsetY: mapViewport.offsetY };
  }, [mapViewport.offsetX, mapViewport.offsetY]);

  const handleMapPointerMove = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const dragStart = mapDragStartRef.current;
    if (!dragStart) return;
    setMapViewport((viewport) => ({
      ...viewport,
      offsetX: Math.max(-360, Math.min(360, dragStart.offsetX + event.clientX - dragStart.x)),
      offsetY: Math.max(-360, Math.min(360, dragStart.offsetY + event.clientY - dragStart.y)),
    }));
  }, []);

  const handleMapPointerEnd = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    mapDragStartRef.current = null;
    if (mapCanvasRef.current?.hasPointerCapture(event.pointerId)) mapCanvasRef.current.releasePointerCapture(event.pointerId);
  }, []);

  const handleMapWheel = useCallback((event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    updateMapZoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, [updateMapZoom]);

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
    let active = true;
    fetch("/scenes.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<SceneManifest>;
      })
      .then((manifest) => {
        if (!active || !manifest.scenes?.length) {
          return;
        }
        setScenes(manifest.scenes);
        setSelectedSceneId(manifest.defaultSceneId && manifest.scenes.some((scene) => scene.id === manifest.defaultSceneId)
          ? manifest.defaultSceneId
          : manifest.scenes[0].id);
      })
      // The original single-file demo remains usable when a manifest is absent.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const lidarSource = resolveLidarSource(selectedScene);
    setSceneLoading(true);
    setDiagnosis(null);
    setError(null);
    setCurrentTime(0);
    setSelectedRiskEventId(null);
    lidarCache.clear();
    setLidarIndex(null);
    setCurrentPointCloud(null);
    setLidarHistory([]);
    setLidarStatus(lidarSource ? "loading" : "unavailable");
    setLidarError(null);

    Promise.all([
      fetch(selectedScene.telemetryFile, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`telemetry HTTP ${response.status}`);
        return response.json() as Promise<TelemetryFrame[]>;
      }),
      fetch(selectedScene.perceptionFile, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`perception HTTP ${response.status}`);
        return response.json() as Promise<PerceptionFrame[]>;
      }),
      selectedScene.metadataFile
        ? fetch(selectedScene.metadataFile, { signal: controller.signal }).then((response) => (response.ok ? response.json() as Promise<DatasetMeta> : null))
        : Promise.resolve(null),
    ])
      .then(([nextTelemetry, nextPerception, nextMeta]) => {
        if (controller.signal.aborted) return;
        setTelemetry(nextTelemetry);
        setPerception(nextPerception);
        setDatasetMeta(nextMeta);
        videoRef.current?.load();
      })
      .catch((fetchError: unknown) => {
        if (!controller.signal.aborted) {
          setTelemetry([]);
          setPerception([]);
          setDatasetMeta(null);
          setLidarIndex(null);
          setLidarStatus(lidarSource ? "error" : "unavailable");
          setError(`读取场景“${selectedScene.label}”失败：${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSceneLoading(false);
      });

    // LiDAR is optional: an unavailable or malformed index must not prevent the
    // camera replay, telemetry, perception, map, or diagnosis data from loading.
    if (lidarSource) {
      loadOptionalLidarIndex(lidarSource, controller.signal)
        .then(({ index, errorMessage }) => {
          if (controller.signal.aborted) return;
          setLidarIndex(index);
          if (errorMessage) {
            setLidarStatus("error");
            setLidarError(errorMessage);
          } else {
            setLidarStatus("ready");
          }
        });
    }

    return () => controller.abort();
  }, [selectedScene]);

  useEffect(() => {
    const lidarSource = resolveLidarSource(selectedScene);
    if (!lidarIndex || !lidarSource || lidarIndex.frames.length === 0) {
      if (lidarSource && lidarIndex && lidarIndex.frames.length === 0) setLidarStatus("error");
      return;
    }
    const current = findNearestLidarFrame(lidarIndex, currentTime);
    if (!current) return;
    const controller = new AbortController();
    const currentIndex = lidarIndex.frames.indexOf(current);
    const frames = lidarIndex.frames.slice(Math.max(0, currentIndex - 2), currentIndex + 1);
    setLidarStatus("loading");
    Promise.all(frames.map((frame) => lidarCache.load(resolveLidarFrameUrl(lidarSource, frame.file), controller.signal)))
      .then((clouds) => {
        if (controller.signal.aborted) return;
        setCurrentPointCloud(clouds.at(-1) ?? null);
        setLidarHistory(clouds.slice(0, -1));
        setLidarStatus("ready");
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setCurrentPointCloud(null);
          setLidarHistory([]);
          setLidarStatus("error");
          setError(`读取 LiDAR 点云失败：${loadError instanceof Error ? loadError.message : String(loadError)}`);
        }
      });
    return () => controller.abort();
  }, [currentTime, lidarCache, lidarIndex, selectedScene]);

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

  const handleSeekRiskEvent = (time: number, event?: RiskEvent) => {
    const replayTime = resolveReplayTime(event ?? { seekTime: time });
    const video = videoRef.current;
    if (video) {
      video.currentTime = replayTime;
      void video.play().catch(() => undefined);
    }
    setCurrentTime(replayTime);
    setSelectedRiskEventId(event?.id ?? null);
  };

  const metricItems = [
    { label: "车速", value: `${formatNumber(currentFrame?.speedKmh ?? NaN)} km/h`, icon: Gauge },
    { label: "刹车", value: formatNumber(currentFrame?.brake ?? NaN, 2), icon: ShieldCheck },
    { label: "油门", value: formatNumber(currentFrame?.throttle ?? NaN, 2), icon: Zap },
    { label: "转向", value: formatNumber(currentFrame?.steering ?? NaN, 2), icon: Activity },
    { label: "加速度", value: `${formatNumber(currentFrame?.accel ?? NaN, 2)} m/s²`, icon: Radio },
    { label: "目标", value: `${currentPerception?.objects.length ?? 0}`, icon: Layers3 },
  ];

  if (!showDashboard) {
    return <ProjectSite onOpenDemo={() => setShowDashboard(true)} />;
  }

  return (
    <main className="app-shell">
      <section className="command-grid">
        <header className="header-bar">
          <div>
            <p className="eyebrow">nuScenes mini real-scene diagnosis</p>
            <h1>智驾感知诊断驾驶舱</h1>
          </div>
          <div className="header-actions">
            <button className="back-site-button" type="button" onClick={() => setShowDashboard(false)}>项目官网</button>
            <label className="scene-selector" title="切换后会同步加载该场景的视频、车辆状态与感知数据">
              <Database size={15} aria-hidden="true" />
              <span>场景</span>
              <select
                value={selectedSceneId}
                onChange={(event) => setSelectedSceneId(event.target.value)}
                disabled={sceneLoading}
                aria-label="选择数据场景"
              >
                {scenes.map((scene) => <option value={scene.id} key={scene.id}>{scene.label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
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
              key={selectedScene.id}
              src={selectedScene.videoFile}
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
              <span>{sceneLoading ? "场景加载中…" : sceneName}</span>
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
            <span>LiDAR 3D/BEV 感知</span>
            <strong>高危 {highRiskObjects} / 中危 {mediumRiskObjects}</strong>
          </div>
          <LidarBev pointCloud={currentPointCloud} frame={currentPerception} history={lidarHistory} status={lidarStatus} errorMessage={lidarError} />
          <div className="lidar-metadata" aria-label="LiDAR 数据状态">
            <span>源 {resolveLidarSource(selectedScene) ?? "camera-only"}</span>
            <span>点 {currentLidarFrame?.pointCount.toLocaleString() ?? "--"}</span>
            <span>关键帧 {currentLidarFrame ? `${formatNumber(currentLidarFrame.time, 2)}s` : "--"}</span>
            <span className={`lidar-status lidar-status-${lidarStatus}`}>{lidarStatus === "ready" ? "已同步" : lidarStatus === "loading" ? "加载中" : lidarStatus === "unavailable" ? "仅相机" : "读取失败"}</span>
          </div>
        </section>

        <section className="map-panel">
          <div className="panel-title">
            <Map size={18} aria-hidden="true" />
            <span>地图与轨迹</span>
            <strong>{currentPerception ? `${formatNumber(currentPerception.ego.latitude, 5)}, ${formatNumber(currentPerception.ego.longitude, 5)}` : "--"}</strong>
          </div>
          <div className="canvas-stage map-stage">
            <canvas
              ref={mapCanvasRef}
              className="interactive-map-canvas"
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={handleMapPointerEnd}
              onPointerCancel={handleMapPointerEnd}
              onWheel={handleMapWheel}
              aria-label="可缩放和平移的局部地图"
            />
            <div className="map-controls" aria-label="地图控制">
              <button type="button" onClick={() => updateMapZoom(1.2)} title="放大地图" aria-label="放大地图">
                <Plus size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => updateMapZoom(1 / 1.2)} title="缩小地图" aria-label="缩小地图">
                <Minus size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={resetMapViewport} title="回到自车当前位置" aria-label="回到自车当前位置">
                <LocateFixed size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="map-interaction-hint">
              <Move size={13} aria-hidden="true" /> 拖拽平移 · 滚轮缩放
            </div>
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

        <RiskEventsPanel events={completedRiskEvents} currentTime={currentTime} onSeek={handleSeekRiskEvent} />
      </section>
    </main>
  );
}

export default App;
