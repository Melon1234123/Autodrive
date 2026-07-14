import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { RiskEventsList } from "./RiskEventsPanel";
import { deriveRiskEvents } from "./risk-events";
import type { RiskEvent } from "./risk-events";
import BorderGlow from "./BorderGlow";
import ContextCardsDemo, { ContextCardsSection } from "./ContextCardsDemo";
import MotionHeadline from "./MotionHeadline";
import PositioningSection from "./PositioningSection";
import PositioningOrbitDemo from "./PositioningOrbitDemo";
import ShowcaseNav from "./ShowcaseNav";
import ShowcaseOpening from "./ShowcaseOpening";
import TechnicalRouteSection from "./TechnicalRouteSection";
import { LidarBev, type LidarHistoryCloud } from "./LidarBev";
import TerrainBackdrop from "./TerrainBackdrop";
import { CockpitExperience } from "./cockpit/CockpitExperience";
import { createDiagnosisJob, pollDiagnosisJob } from "./cockpit/diagnosis-client";
import type { CockpitScreen, DiagnosisReport, DiagnosisStage } from "./cockpit/types";
import type { ShowcaseTerrainPreset } from "./terrain-presets";
import { useShowcaseMotion } from "./useShowcaseMotion";
import { useTerrainSectionPalette } from "./useTerrainSectionPalette";
import { ViewTransitionStage, type ViewTransitionPhase } from "./ViewTransitionStage";
import {
  findNearestLidarFrame,
  LidarFrameCache,
  LidarRequestGate,
  loadLidarIndex,
  resolveLidarRequestCommit,
} from "./lidar";
import type { LidarFrameIndex, LidarIndex } from "./lidar";
import {
  egoScreenYForForwardRange,
  forwardToScreenUp,
  screenXForLeft,
  verticalVisibleBoundsForForwardUp,
} from "./bev-orientation";
import { routeTangentAndNormal, selectMapGeometry, type EgoPoint } from "./map-geometry";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  CircleCheck,
  Database,
  FileSearch,
  Layers3,
  LoaderCircle,
  Map,
  LocateFixed,
  Minus,
  Move,
  Plus,
  ShieldCheck,
  Sparkles,
  History,
} from "lucide-react";

type RiskLevel = "low" | "medium" | "high" | "unknown";
type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type DiagnosisMode = "model" | "fallback" | "unknown";
type MapViewport = { zoom: number; offsetX: number; offsetY: number };
type LidarStatus = "loading" | "unavailable" | "ready" | "error";

export const DEFAULT_MAP_VIEWPORT: MapViewport = { zoom: 1, offsetX: 0, offsetY: 0 };
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

const diagnosisStageText: Record<DiagnosisStage, string> = {
  queued: "等待调度",
  validation: "数据校验",
  timeline: "时间线对齐",
  features: "特征提取",
  events: "风险事件",
  causality: "因果分析",
  report: "报告生成",
  enhancement: "模型增强",
  complete: "已完成",
  failed: "失败",
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

export function resolveLidarRequestKey(
  sceneId: string,
  frame: Pick<LidarFrameIndex, "file">,
): string {
  return `${sceneId}:${frame.file}`;
}

export type OwnedLidarIndex = { sceneId: string; index: LidarIndex };

export type DiagnosisRequestOwner = {
  sceneGeneration: number;
  requestGeneration: number;
  socketGeneration: number;
};

export type DiagnosisJobOwner = {
  sceneGeneration: number;
  sceneKey: string;
  jobId: string;
};

export function shouldAcceptDiagnosisResponse(
  pending: DiagnosisRequestOwner | null,
  activeSceneGeneration: number,
  activeRequestGeneration: number,
  responseSocketGeneration: number,
): boolean {
  return Boolean(
    pending
    && pending.sceneGeneration === activeSceneGeneration
    && pending.requestGeneration === activeRequestGeneration
    && pending.socketGeneration === responseSocketGeneration,
  );
}

export function shouldAcceptDiagnosisJobUpdate(
  owner: DiagnosisJobOwner | null,
  activeSceneGeneration: number,
  activeSceneKey: string,
  jobId: string,
): boolean {
  return Boolean(
    owner
    && owner.sceneGeneration === activeSceneGeneration
    && owner.sceneKey === activeSceneKey
    && owner.jobId === jobId,
  );
}

export function advanceDiagnosisProgress(current: number, next: number): number {
  return Math.max(current, next);
}

export function resolveLidarDisplayState(
  status: LidarStatus,
  candidateKey: string | null,
  renderedKey: string | null,
  hasPointCloud: boolean,
): { tone: LidarStatus; text: string } {
  if (status === "unavailable") return { tone: "unavailable", text: "仅相机" };
  if (status === "error") return { tone: "error", text: "读取失败" };
  if (status === "ready" && hasPointCloud && candidateKey !== null && candidateKey === renderedKey) {
    return { tone: "ready", text: "已同步" };
  }
  return { tone: "loading", text: "同步中" };
}

export function resolveLidarRequestCandidate(
  selectedSceneId: string,
  ownedIndex: OwnedLidarIndex | null,
  currentTime: number,
): { frame: LidarFrameIndex; key: string } | null {
  if (!ownedIndex || ownedIndex.sceneId !== selectedSceneId) return null;
  const frame = findNearestLidarFrame(ownedIndex.index, currentTime);
  return frame ? { frame, key: resolveLidarRequestKey(selectedSceneId, frame) } : null;
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

export function clearMapCanvasBitmap(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();
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

function drawEgoCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = 1,
  alpha = 1,
  variant: "pink" | "white" = "pink",
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  const whiteCar = variant === "white";
  ctx.shadowColor = whiteCar ? "rgba(1, 8, 22, .92)" : "rgba(255, 53, 123, .72)";
  ctx.shadowBlur = 18 * size;
  const body = ctx.createLinearGradient(0, -18 * size, 0, 18 * size);
  body.addColorStop(0, whiteCar ? "#ffffff" : "#ff7ba9");
  body.addColorStop(.45, whiteCar ? "#dce4ed" : "#f34886");
  body.addColorStop(1, whiteCar ? "#aebbc9" : "#c91f60");
  ctx.fillStyle = body;
  ctx.strokeStyle = whiteCar ? "#70839c" : "#ffd5e4";
  ctx.lineWidth = 1.4 * size;
  ctx.beginPath();
  ctx.roundRect(-8 * size, -17 * size, 16 * size, 34 * size, 5 * size);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = whiteCar ? "#1d293a" : "#5f183b";
  ctx.beginPath();
  ctx.roundRect(-5.2 * size, -9.5 * size, 10.4 * size, 13 * size, 3 * size);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.68)";
  ctx.fillRect(-4.1 * size, -8.1 * size, 8.2 * size, 1.6 * size);
  ctx.fillStyle = whiteCar ? "#101721" : "#311126";
  [-1, 1].forEach((side) => {
    ctx.beginPath(); ctx.roundRect(side * 8 * size - (side > 0 ? 0 : 2 * size), -11 * size, 2 * size, 7 * size, 1 * size); ctx.fill();
    ctx.beginPath(); ctx.roundRect(side * 8 * size - (side > 0 ? 0 : 2 * size), 5 * size, 2 * size, 7 * size, 1 * size); ctx.fill();
  });
  ctx.fillStyle = whiteCar ? "#ffffff" : "#ffe2ec";
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
  active: boolean,
  renderOwner: CockpitScreen,
) {
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!active) {
      return;
    }

    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) {
      return;
    }

    const updateCanvasSize = (observedWidth?: number, observedHeight?: number) => {
      const bounds = parent.getBoundingClientRect();
      const width = Math.max(observedWidth || parent.clientWidth || bounds.width || 320, 280);
      const height = Math.max(observedHeight || parent.clientHeight || bounds.height || 220, 180);
      setCanvasSize((currentSize) => (
        currentSize.width === width && currentSize.height === height
          ? currentSize
          : { width, height }
      ));
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateCanvasSize(entry?.contentRect.width, entry?.contentRect.height);
    });
    resizeObserver.observe(parent);

    return () => resizeObserver.disconnect();
  }, [active, canvasRef, renderOwner]);

  useEffect(() => {
    if (!active || canvasSize.width <= 0 || canvasSize.height <= 0) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const cssWidth = canvasSize.width;
    const cssHeight = canvasSize.height;
    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.round(cssWidth * dpr);
    const backingHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const mapBackground = ctx.createLinearGradient(0, 0, 0, cssHeight);
    mapBackground.addColorStop(0, "#0a1719");
    mapBackground.addColorStop(1, "#050b0d");
    ctx.fillStyle = mapBackground;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const panel = { x: 18, y: 18, width: cssWidth - 36, height: cssHeight - 36 };
    const view = { front: 76, rear: 12, side: 22 };
    const scale = Math.min(panel.width / (view.side * 2), panel.height / (view.front + view.rear)) * viewport.zoom;
    const egoCanvas = {
      x: panel.x + panel.width / 2 + viewport.offsetX,
      y: egoScreenYForForwardRange(panel.y, panel.height, scale, view.front, view.rear) + viewport.offsetY,
    };
    const verticalBounds = verticalVisibleBoundsForForwardUp(panel.y, panel.y + panel.height, egoCanvas.y, scale);
    const visibleBounds = {
      minLeft: (egoCanvas.x - (panel.x + panel.width)) / scale,
      maxLeft: (egoCanvas.x - panel.x) / scale,
      minForward: verticalBounds.minForward,
      maxForward: verticalBounds.maxForward,
    };
    const toCanvas = (forward: number, left: number) => {
      const depth = Math.min(1, Math.max(0, (forward - visibleBounds.minForward) / (visibleBounds.maxForward - visibleBounds.minForward || 1)));
      const lateralScale = 1.12 - depth * .58;
      return {
        x: screenXForLeft(left, egoCanvas.x, scale, lateralScale),
        y: forwardToScreenUp(forward, egoCanvas.y, scale),
      };
    };
    const pointToCanvas = (point: EgoPoint) => toCanvas(point.forward, point.left);

    ctx.save();
    ctx.fillStyle = "rgba(6, 17, 19, 0.99)";
    ctx.strokeStyle = "rgba(104, 171, 167, 0.34)";
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
    localBackground.addColorStop(0, "rgba(10, 29, 31, 1)");
    localBackground.addColorStop(0.52, "rgba(7, 21, 24, 1)");
    localBackground.addColorStop(1, "rgba(4, 13, 15, 1)");
    ctx.fillStyle = localBackground;
    ctx.fillRect(panel.x, panel.y, panel.width, panel.height);

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

    ctx.save();
    ctx.strokeStyle = "rgba(117, 174, 171, 0.105)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    const firstGridLeft = Math.floor((visibleBounds.minLeft - 12) / 10) * 10;
    const lastGridLeft = Math.ceil((visibleBounds.maxLeft + 12) / 10) * 10;
    for (let left = firstGridLeft; left <= lastGridLeft; left += 10) {
      const start = toCanvas(visibleBounds.minForward - 12, left);
      const end = toCanvas(visibleBounds.maxForward + 12, left);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    const firstGridForward = Math.floor((visibleBounds.minForward - 12) / 10) * 10;
    const lastGridForward = Math.ceil((visibleBounds.maxForward + 12) / 10) * 10;
    for (let forward = firstGridForward; forward <= lastGridForward; forward += 10) {
      const start = toCanvas(forward, visibleBounds.maxLeft + 12);
      const end = toCanvas(forward, visibleBounds.minLeft - 12);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    ctx.restore();

    const current = currentFrame ?? frames[0];
    if (!current) {
      ctx.restore();
      return;
    }

    const currentIndex = currentFrame ? Math.max(0, frames.indexOf(currentFrame)) : 0;
    const heading = current.ego.yaw;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const toEgo = (frame: PerceptionFrame): EgoPoint => {
      const dx = frame.ego.x - current.ego.x;
      const dy = frame.ego.y - current.ego.y;
      return {
        forward: cos * dx + sin * dy,
        left: -sin * dx + cos * dy,
      };
    };
    const routeStart = Math.max(0, currentIndex - 18);
    const routeEnd = Math.min(frames.length - 1, currentIndex + 82);
    const measuredEgoRoute = frames.slice(routeStart, routeEnd + 1).map(toEgo);
    const measuredHistory = frames.slice(routeStart, currentIndex + 1).map(toEgo);
    const geometry = selectMapGeometry(measuredEgoRoute, current.plannedPath, current.lanes);

    const offsetRoute = (points: EgoPoint[], halfWidth: number) => {
      const leftEdge: EgoPoint[] = [];
      const rightEdge: EgoPoint[] = [];
      points.forEach((point, index) => {
        const { normal } = routeTangentAndNormal(points, index);
        leftEdge.push({
          forward: point.forward + normal.forward * halfWidth,
          left: point.left + normal.left * halfWidth,
        });
        rightEdge.push({
          forward: point.forward - normal.forward * halfWidth,
          left: point.left - normal.left * halfWidth,
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
    roadFill.addColorStop(0, "rgba(17, 34, 38, 0.98)");
    roadFill.addColorStop(0.55, "rgba(12, 27, 31, 0.98)");
    roadFill.addColorStop(1, "rgba(8, 21, 24, 0.98)");
    const shoulderFill = ctx.createLinearGradient(0, panel.y, 0, panel.y + panel.height);
    shoulderFill.addColorStop(0, "rgba(29, 51, 55, 0.95)");
    shoulderFill.addColorStop(1, "rgba(18, 37, 41, 0.92)");
    const roadShadow = geometry.road.map((point) => ({ forward: point.forward - .65, left: point.left }));
    drawRoadStrip(roadShadow, 10.9, "rgba(1, 7, 9, .58)", "rgba(72, 119, 118, .22)", 3);
    drawRoadStrip(geometry.road, 10.1, shoulderFill, "rgba(83, 139, 136, 0.36)");
    const roadEdges = drawRoadStrip(geometry.road, 6.2, roadFill, "rgba(103, 164, 160, 0.46)", 2);

    drawPolyline(roadEdges.leftEdge, "rgba(197, 226, 222, 0.48)", 1.2);
    drawPolyline(roadEdges.rightEdge, "rgba(197, 226, 222, 0.48)", 1.2);
    geometry.lanes.forEach((lane) => {
      drawPolyline(
        lane.points,
        lane.id === "ego" ? "rgba(126, 183, 179, 0.3)" : "rgba(206, 231, 226, 0.58)",
        lane.id === "ego" ? 1 : 1.25,
        0,
        [7, 8],
      );
    });

    drawPolyline(measuredHistory, "rgba(20, 108, 232, 0.3)", 7, 5);
    drawPolyline(measuredHistory, "#1687e8", 3.2, 6);
    drawPolyline(geometry.plannedPath, "rgba(153, 229, 86, 0.24)", 9, 7);
    drawPolyline(geometry.plannedPath, "#9be556", 3.8, 8);

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

    drawEgoCar(ctx, egoCanvas.x, egoCanvas.y, 1.05, 1, "white");

    ctx.restore();
  }, [active, canvasRef, canvasSize, currentFrame, frames, renderOwner, viewport]);
}

type ProjectSiteProps = {
  onOpenDemo: () => void;
  onTerrainPresetChange: (preset: ShowcaseTerrainPreset) => void;
  playOpening: boolean;
  onOpeningComplete: () => void;
  active: boolean;
  onShowcaseRootChange?: (root: HTMLElement | null) => void;
  restoreScrollTop?: number | null;
};

export function ProjectSite({
  onOpenDemo,
  onTerrainPresetChange,
  playOpening,
  onOpeningComplete,
  active,
  onShowcaseRootChange,
  restoreScrollTop = null,
}: ProjectSiteProps) {
  const showcaseRef = useRef<HTMLElement | null>(null);
  const setShowcaseRoot = useCallback((root: HTMLElement | null) => {
    showcaseRef.current = root;
    onShowcaseRootChange?.(root);
  }, [onShowcaseRootChange]);

  useLayoutEffect(() => {
    if (restoreScrollTop !== null && showcaseRef.current) {
      showcaseRef.current.scrollTop = restoreScrollTop;
    }
  }, [restoreScrollTop]);

  useTerrainSectionPalette(showcaseRef, onTerrainPresetChange);
  useShowcaseMotion({ rootRef: showcaseRef, playOpening, onOpeningComplete, enabled: active });
  return <main className="showcase" ref={setShowcaseRoot}>
    <ShowcaseOpening />
    <ShowcaseNav />

    <div className="showcase-scroll-content" data-lenis-content>
    <section className="showcase-hero" data-motion-hero data-terrain-preset="hidden" id="home">
      <video className="hero-video" data-motion-hero-media src="/sample.mp4" autoPlay muted loop playsInline />
      <div className="hero-wash" />
      <div className="hero-content content-width">
        <p className="kicker"><span /> 可解释自动驾驶</p>
        <MotionHeadline as="h1" label="让每一次自动驾驶决策有据可循" lines={[
          <>让每一次</>, <><em>自动驾驶决策</em>有据可循</>,
        ]} />
        <p className="hero-copy" data-motion-copy>面向智能驾驶研发、测试验证与安全审计的多智能体协作诊断平台。将不可见的失效路径，转化为可追溯、可复现、可优化的证据闭环。</p>
        <div className="hero-actions"><button className="primary-cta" type="button" onClick={onOpenDemo}>进入效果展示 <ArrowDownRight size={18} /></button><a className="text-cta" href="#product">了解系统架构 <ArrowUpRight size={17} /></a></div>
      </div>
      <div className="hero-foot content-width"><span>HANGZHOU DIANZI UNIVERSITY</span><span>2026 / RESEARCH PROTOTYPE</span><span>SCROLL TO EXPLORE ↓</span></div>
    </section>

    <PositioningSection />

    <ContextCardsSection embedded />

    <TechnicalRouteSection />

    <section className="demo-section" data-motion-section data-terrain-preset="demo" id="demo"><div className="content-width"><div className="demo-head"><div><div className="section-index" data-motion-index>04 / LIVE PROTOTYPE</div><MotionHeadline as="h2" label="真实场景中的证据链，直接进入驾驶舱" lines={[
      <>真实场景中的证据链，</>, <><em>直接进入驾驶舱</em></>,
    ]} /></div></div><BorderGlow as="div" className="demo-card motion-block" backgroundColor="#10292b"><div className="demo-visual" data-motion-media-frame><video data-motion-media src="/sample.mp4" autoPlay muted loop playsInline /><div className="demo-overlay"><b>风险诊断<br />驾驶舱</b><button type="button" onClick={onOpenDemo}>进入驾驶舱 <ArrowUpRight size={17} aria-hidden="true" /></button></div></div></BorderGlow></div></section>

    <section className="product-section" data-motion-section data-terrain-preset="product" id="product"><div className="content-width"><div className="product-top"><div><div className="section-index" data-motion-index>05 / PRODUCT CAPABILITY</div><MotionHeadline as="h2" label="把每一次异常沉淀为下一次进化" lines={[
      <>把每一次异常</>, <>沉淀为下一次<em>进化</em></>,
    ]} /></div><p data-motion-copy>产品能力围绕研发测试闭环展开：数据标准化接入、诊断任务编排、证据解码和训练数据包交付。</p></div><BorderGlow as="div" className="architecture-card motion-block" backgroundColor="#143235"><div className="architecture-title"><Sparkles size={18} /> 多智能体协作诊断引擎 <span>DIAGNOSIS ORCHESTRATION</span></div><div className="agent-flow" data-motion-stagger><BorderGlow as="div" className="agent-node" backgroundColor="rgba(255,255,255,.04)"><Database /><small>01</small><h3>诊断编排 Agent</h3><p>根据场景风险动态调度感知、决策与轨迹分析任务</p></BorderGlow><i /><BorderGlow as="div" className="agent-node active" backgroundColor="#d9f35b"><BrainCircuit /><small>02</small><h3>证据解码</h3><p>把模型偏差、目标风险和逻辑链组织成诊断病历</p></BorderGlow><i /><BorderGlow as="div" className="agent-node" backgroundColor="rgba(255,255,255,.04)"><FileSearch /><small>03</small><h3>训练数据包</h3><p>生成正确/错误推理对与高价值复盘样本</p></BorderGlow><i /><BorderGlow as="div" className="agent-node" backgroundColor="rgba(255,255,255,.04)"><ShieldCheck /><small>04</small><h3>工程化交付</h3><p>面向测试、审计和模型迭代输出可复用证据</p></BorderGlow></div></BorderGlow><div className="feature-grid" data-motion-stagger><BorderGlow as="article" backgroundColor="#f7faf7"><CircleCheck size={19} /><h3>算法结构描述协议</h3><p>不触碰模型权重，兼顾接入深度、数据主权与跨架构适配。</p></BorderGlow><BorderGlow as="article" backgroundColor="#f7faf7"><CircleCheck size={19} /><h3>数学 + 逻辑双重证据</h3><p>连接感知语义漂移与决策逻辑审计，让诊断结论可验证。</p></BorderGlow><BorderGlow as="article" backgroundColor="#f7faf7"><CircleCheck size={19} /><h3>诊断即训练</h3><p>从失效根因反向生成正确/错误推理对，驱动针对性迭代。</p></BorderGlow></div></div></section>

    <footer className="showcase-footer showcase-footer-centered" data-motion-section data-terrain-preset="closing" id="contact"><div className="content-width footer-content"><p className="kicker"><span /> LET'S MAKE AUTONOMY ACCOUNTABLE</p><MotionHeadline as="h2" label="安全不是一句承诺。它应当被证明。" lines={[
      <>安全不是一句承诺。</>, <><em>它应当被证明。</em></>,
    ]} /><p className="footer-value" data-motion-copy>把异常片段、感知证据、决策逻辑和优化样本沉淀到同一条可追溯链路里。</p><div className="footer-bottom" data-motion-stagger><span data-motion-stagger-item>智驾卫士 / DRIVEGUARD</span><span data-motion-stagger-item>杭州电子科技大学 · 计算机学院</span><span data-motion-stagger-item>2026 RESEARCH PROTOTYPE</span></div></div></footer>
    </div>
  </main>;
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapDragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const sceneLoadAbortRef = useRef<AbortController | null>(null);
  const lidarPlaybackAbortRef = useRef<AbortController | null>(null);
  const lidarRequestGateRef = useRef(new LidarRequestGate());
  const sceneGenerationRef = useRef(0);
  const diagnosisRequestGenerationRef = useRef(0);
  const socketGenerationRef = useRef(0);
  const pendingDiagnosisRef = useRef<DiagnosisRequestOwner | null>(null);
  const diagnosisJobAbortRef = useRef<AbortController | null>(null);
  const diagnosisJobOwnerRef = useRef<DiagnosisJobOwner | null>(null);
  const showcaseOpeningPlayedRef = useRef(false);
  const handleShowcaseOpeningComplete = useCallback(() => {
    showcaseOpeningPlayedRef.current = true;
  }, []);
  const [telemetry, setTelemetry] = useState<TelemetryFrame[]>([]);
  const [perception, setPerception] = useState<PerceptionFrame[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [diagnosisReport, setDiagnosisReport] = useState<DiagnosisReport | null>(null);
  const [reportRunning, setReportRunning] = useState(false);
  const [reportStage, setReportStage] = useState<DiagnosisStage>("queued");
  const [reportProgress, setReportProgress] = useState(0);
  const [reportError, setReportError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState("manifest-v1");
  const [datasetMeta, setDatasetMeta] = useState<DatasetMeta | null>(null);
  const [scenes, setScenes] = useState<SceneManifestEntry[]>([LEGACY_SCENE]);
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const [selectedSceneId, setSelectedSceneId] = useState(LEGACY_SCENE.id);
  const selectedSceneIdRef = useRef(selectedSceneId);
  selectedSceneIdRef.current = selectedSceneId;
  const [sceneLoading, setSceneLoading] = useState(true);
  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>("unknown");
  const [backendModel, setBackendModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapViewport, setMapViewport] = useState<MapViewport>(DEFAULT_MAP_VIEWPORT);
  const [viewPhase, setViewPhase] = useState<ViewTransitionPhase>("site");
  const returnTargetRef = useRef<"showcase" | "contact">("showcase");
  const showcaseRootRef = useRef<HTMLElement | null>(null);
  const showcaseScrollTopRef = useRef(0);
  const showDashboard = viewPhase !== "site";
  const [cockpitScreen, setCockpitScreen] = useState<CockpitScreen>("entry");
  const handleOpenDemo = useCallback(() => {
    if (viewPhase !== "site") return;
    showcaseScrollTopRef.current = showcaseRootRef.current?.scrollTop ?? 0;
    showcaseOpeningPlayedRef.current = true;
    setCockpitScreen("entry");
    setTerrainPreset("hidden");
    returnTargetRef.current = "showcase";
    setViewPhase("entering");
  }, [viewPhase]);
  const handleReturnSite = useCallback((target: "showcase" | "contact" = "showcase") => {
    if (viewPhase !== "cockpit") return;
    returnTargetRef.current = target;
    setViewPhase("exiting");
  }, [viewPhase]);
  const handleTransitionComplete = useCallback((phase: ViewTransitionPhase) => {
    if (phase === "entering") {
      setViewPhase("cockpit");
      return;
    }
    if (phase === "exiting") {
      setCockpitScreen("entry");
      setTerrainPreset("hidden");
      setViewPhase("site");
      if (returnTargetRef.current === "contact") {
        window.setTimeout(() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      }
    }
  }, []);
  const [terrainPreset, setTerrainPreset] = useState<ShowcaseTerrainPreset>("hidden");
  const [ownedLidarIndex, setOwnedLidarIndex] = useState<OwnedLidarIndex | null>(null);
  const [lidarStatus, setLidarStatus] = useState<LidarStatus>("loading");
  const [lidarError, setLidarError] = useState<string | null>(null);
  const [lidarCache] = useState(() => new LidarFrameCache());
  const [currentPointCloud, setCurrentPointCloud] = useState<Float32Array | null>(null);
  const [lidarHistory, setLidarHistory] = useState<LidarHistoryCloud[]>([]);
  const [renderedLidarFrame, setRenderedLidarFrame] = useState<LidarFrameIndex | null>(null);

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
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? LEGACY_SCENE;
  const riskEvents = useMemo(() => deriveRiskEvents(telemetry, perception), [telemetry, perception]);
  const completedRiskEvents = useMemo(
    () => riskEvents.filter((event) => event.endTime <= currentTime + 0.05),
    [currentTime, riskEvents],
  );
  const lidarRequestCandidate = useMemo(
    () => resolveLidarRequestCandidate(selectedScene.id, ownedLidarIndex, currentTime),
    [currentTime, ownedLidarIndex, selectedScene.id],
  );
  const candidateLidarFrame = lidarRequestCandidate?.frame ?? null;
  const candidateLidarKey = lidarRequestCandidate?.key ?? null;
  const renderedLidarKey = renderedLidarFrame
    ? resolveLidarRequestKey(selectedScene.id, renderedLidarFrame)
    : null;
  const lidarDisplayState = resolveLidarDisplayState(
    lidarStatus,
    candidateLidarKey,
    renderedLidarKey,
    currentPointCloud !== null,
  );

  useEffect(() => {
    if (viewPhase !== "cockpit") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleReturnSite();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [handleReturnSite, viewPhase]);

  useMapCanvas(
    perception,
    currentPerception,
    mapCanvasRef,
    mapViewport,
    showDashboard && cockpitScreen !== "entry",
    cockpitScreen,
  );

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

  const resetScenePresentation = useCallback(() => {
    setTelemetry([]);
    setPerception([]);
    setDatasetMeta(null);
    setMapViewport(DEFAULT_MAP_VIEWPORT);
    mapDragStartRef.current = null;
  }, []);

  const handleSceneSelection = useCallback((nextSceneId: string, nextSceneEntry?: SceneManifestEntry) => {
    if (nextSceneId === selectedSceneIdRef.current) return;
    selectedSceneIdRef.current = nextSceneId;
    sceneGenerationRef.current += 1;
    diagnosisRequestGenerationRef.current += 1;
    diagnosisJobAbortRef.current?.abort();
    diagnosisJobAbortRef.current = null;
    diagnosisJobOwnerRef.current = null;
    const pendingDiagnosis = pendingDiagnosisRef.current;
    pendingDiagnosisRef.current = null;
    const diagnosisSocket = socketRef.current;
    if (
      pendingDiagnosis
      && diagnosisSocket
      && pendingDiagnosis.socketGeneration === socketGenerationRef.current
    ) {
      diagnosisSocket.onmessage = null;
      if (diagnosisSocket.readyState !== WebSocket.CLOSED) diagnosisSocket.close();
      if (socketRef.current === diagnosisSocket) socketRef.current = null;
    }

    sceneLoadAbortRef.current?.abort();
    sceneLoadAbortRef.current = null;
    lidarPlaybackAbortRef.current?.abort();
    lidarPlaybackAbortRef.current = null;
    lidarRequestGateRef.current.reset();
    lidarCache.clear();

    clearMapCanvasBitmap(mapCanvasRef.current);
    resetScenePresentation();
    setSceneLoading(true);
    setDiagnosis(null);
    setDiagnosing(false);
    setDiagnosisReport(null);
    setReportRunning(false);
    setReportStage("queued");
    setReportProgress(0);
    setReportError(null);
    setError(null);
    setCurrentTime(0);
    setOwnedLidarIndex(null);
    setCurrentPointCloud(null);
    setLidarHistory([]);
    setRenderedLidarFrame(null);
    setLidarError(null);
    const nextScene = nextSceneEntry ?? scenesRef.current.find((scene) => scene.id === nextSceneId);
    setLidarStatus(nextScene && !resolveLidarSource(nextScene) ? "unavailable" : "loading");
    setSelectedSceneId(nextSceneId);
  }, [lidarCache, resetScenePresentation]);

  const connectSocket = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus("connecting");
    const socket = new WebSocket(WS_URL);
    const socketGeneration = ++socketGenerationRef.current;
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      setConnectionStatus("connected");
      setError(null);
    };

    socket.onmessage = (event) => {
      if (!shouldAcceptDiagnosisResponse(
        pendingDiagnosisRef.current,
        sceneGenerationRef.current,
        diagnosisRequestGenerationRef.current,
        socketGeneration,
      )) return;
      pendingDiagnosisRef.current = null;
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
      if (socketRef.current !== socket) return;
      if (pendingDiagnosisRef.current?.socketGeneration === socketGeneration) {
        pendingDiagnosisRef.current = null;
      }
      setConnectionStatus("error");
      setDiagnosing(false);
      setError("WebSocket 连接异常，请确认后端服务是否启动。");
    };

    socket.onclose = () => {
      if (socketRef.current && socketRef.current !== socket) return;
      if (socketRef.current === socket) socketRef.current = null;
      if (pendingDiagnosisRef.current?.socketGeneration === socketGeneration) {
        pendingDiagnosisRef.current = null;
      }
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
        setDataVersion(`manifest-v${manifest.version}`);
        const nextScene = manifest.defaultSceneId
          ? manifest.scenes.find((scene) => scene.id === manifest.defaultSceneId) ?? manifest.scenes[0]
          : manifest.scenes[0];
        handleSceneSelection(nextScene.id, nextScene);
      })
      // The original single-file demo remains usable when a manifest is absent.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [handleSceneSelection]);

  useEffect(() => {
    clearMapCanvasBitmap(mapCanvasRef.current);
    resetScenePresentation();
    sceneLoadAbortRef.current?.abort();
    const controller = new AbortController();
    sceneLoadAbortRef.current = controller;
    const sceneGeneration = sceneGenerationRef.current;
    const ownsScene = () => !controller.signal.aborted && sceneGenerationRef.current === sceneGeneration;
    lidarPlaybackAbortRef.current?.abort();
    const lidarPlaybackController = new AbortController();
    lidarPlaybackAbortRef.current = lidarPlaybackController;
    lidarRequestGateRef.current.reset();
    const lidarSource = resolveLidarSource(selectedScene);
    setSceneLoading(true);
    setDiagnosis(null);
    setError(null);
    setCurrentTime(0);
    lidarCache.clear();
    setOwnedLidarIndex(null);
    setCurrentPointCloud(null);
    setLidarHistory([]);
    setRenderedLidarFrame(null);
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
        if (!ownsScene()) return;
        setTelemetry(nextTelemetry);
        setPerception(nextPerception);
        setDatasetMeta(nextMeta);
      })
      .catch((fetchError: unknown) => {
        if (ownsScene()) {
          setTelemetry([]);
          setPerception([]);
          setDatasetMeta(null);
          setError(`读取场景“${selectedScene.label}”失败：${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
      })
      .finally(() => {
        if (ownsScene()) setSceneLoading(false);
      });

    // LiDAR is optional: an unavailable or malformed index must not prevent the
    // camera replay, telemetry, perception, map, or diagnosis data from loading.
    if (lidarSource) {
      loadOptionalLidarIndex(lidarSource, controller.signal)
        .then(({ index, errorMessage }) => {
          if (!ownsScene()) return;
          setOwnedLidarIndex(index ? { sceneId: selectedScene.id, index } : null);
          if (errorMessage) {
            setLidarStatus("error");
            setLidarError(errorMessage);
          } else {
            setLidarStatus("loading");
          }
        });
    }

    return () => {
      controller.abort();
      if (sceneLoadAbortRef.current === controller) sceneLoadAbortRef.current = null;
      if (lidarPlaybackAbortRef.current === lidarPlaybackController) {
        lidarPlaybackController.abort();
        lidarPlaybackAbortRef.current = null;
      }
    };
  }, [lidarCache, resetScenePresentation, selectedScene]);

  useEffect(() => {
    const lidarSource = resolveLidarSource(selectedScene);
    const playbackSignal = lidarPlaybackAbortRef.current?.signal;
    const lidarIndex = ownedLidarIndex?.sceneId === selectedScene.id ? ownedLidarIndex.index : null;
    if (!lidarIndex || !lidarSource || !candidateLidarFrame || !candidateLidarKey || !playbackSignal || lidarIndex.frames.length === 0) {
      if (lidarSource && lidarIndex && lidarIndex.frames.length === 0) setLidarStatus("error");
      return;
    }
    const currentIndex = lidarIndex.frames.indexOf(candidateLidarFrame);
    if (currentIndex < 0) return;
    const ticket = lidarRequestGateRef.current.issue();
    const frames = lidarIndex.frames.slice(Math.max(0, currentIndex - 2), currentIndex + 1);
    // Keep the last successful point cloud visible while the next keyframe is fetched.
    // Switching to the loading branch here used to unmount the WebGL canvas every 100 ms.
    if (!currentPointCloud) {
      setLidarStatus("loading");
    }
    Promise.allSettled(frames.map((frame) => lidarCache.load(resolveLidarFrameUrl(lidarSource, frame.file), playbackSignal)))
      .then((results) => {
        if (playbackSignal.aborted) return;
        const currentCommit = resolveLidarRequestCommit(lidarRequestGateRef.current, ticket, results.at(-1));
        if (currentCommit.status === "stale") return;
        if (currentCommit.status === "rejected") {
          const loadError = currentCommit.reason;
          const errorMessage = loadError instanceof Error ? loadError.message : String(loadError ?? "unknown error");
          setLidarStatus("error");
          setLidarError(errorMessage);
          return;
        }

        setCurrentPointCloud(currentCommit.value);
        const currentPose = findNearestFrame(perception, candidateLidarFrame.time)?.ego;
        const history = results.slice(0, -1).flatMap((result, index): LidarHistoryCloud[] => {
          if (result.status === "rejected") return [];
          const source = frames[index];
          const sourcePose = findNearestFrame(perception, source.time)?.ego;
          if (!currentPose || !sourcePose) return [];
          const dx = sourcePose.x - currentPose.x;
          const dy = sourcePose.y - currentPose.y;
          const cos = Math.cos(currentPose.yaw);
          const sin = Math.sin(currentPose.yaw);
          return [{
            points: result.value,
            forward: cos * dx + sin * dy,
            left: -sin * dx + cos * dy,
            headingDelta: sourcePose.yaw - currentPose.yaw,
          }];
        });
        setLidarHistory(history);
        setRenderedLidarFrame(candidateLidarFrame);
        setLidarStatus("ready");
        setLidarError(null);
      });
  }, [candidateLidarKey, lidarCache, ownedLidarIndex, perception, selectedScene.id, selectedScene.lidarIndexFile]);

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
        reconnectTimerRef.current = null;
      }
      pendingDiagnosisRef.current = null;
      diagnosisJobAbortRef.current?.abort();
      diagnosisJobAbortRef.current = null;
      diagnosisJobOwnerRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onmessage = null;
        socket.onclose = null;
        socket.close();
      }
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

    const requestGeneration = ++diagnosisRequestGenerationRef.current;
    pendingDiagnosisRef.current = {
      sceneGeneration: sceneGenerationRef.current,
      requestGeneration,
      socketGeneration: socketGenerationRef.current,
    };
    setDiagnosing(true);
    setError(null);
    try {
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
    } catch (sendError: unknown) {
      pendingDiagnosisRef.current = null;
      setDiagnosing(false);
      setError(`诊断请求发送失败：${sendError instanceof Error ? sendError.message : String(sendError)}`);
    }
  };

  const handleGenerateReport = () => {
    diagnosisJobAbortRef.current?.abort();
    const controller = new AbortController();
    diagnosisJobAbortRef.current = controller;
    diagnosisJobOwnerRef.current = null;
    const sceneGeneration = sceneGenerationRef.current;
    const sceneKey = selectedScene.id;
    let capturedOwner: DiagnosisJobOwner | null = null;
    const ownsCreation = () => (
      !controller.signal.aborted
      && diagnosisJobAbortRef.current === controller
      && sceneGenerationRef.current === sceneGeneration
      && selectedSceneIdRef.current === sceneKey
    );
    const ownsJob = (owner: DiagnosisJobOwner, responseJobId: string) => (
      diagnosisJobOwnerRef.current === owner
      && shouldAcceptDiagnosisJobUpdate(
        owner,
        sceneGenerationRef.current,
        selectedSceneIdRef.current,
        responseJobId,
      )
    );

    setDiagnosisReport(null);
    setReportRunning(true);
    setReportStage("queued");
    setReportProgress(0);
    setReportError(null);

    void createDiagnosisJob(API_URL, sceneKey, dataVersion, controller.signal)
      .then(async (created) => {
        if (!ownsCreation()) return null;
        const owner = { sceneGeneration, sceneKey, jobId: created.jobId };
        capturedOwner = owner;
        diagnosisJobOwnerRef.current = owner;
        setReportStage(created.stage);
        setReportProgress(created.percent);
        if (created.stage === "failed") throw new Error(created.error ?? "诊断任务失败");
        if (created.stage === "complete" && created.report) return created.report;

        return pollDiagnosisJob(API_URL, created.jobId, controller.signal, (snapshot) => {
          if (!ownsJob(owner, snapshot.jobId)) return;
          setReportStage(snapshot.stage);
          setReportProgress((current) => advanceDiagnosisProgress(current, snapshot.percent));
        });
      })
      .then((completedReport) => {
        if (
          !completedReport
          || !capturedOwner
          || !ownsJob(capturedOwner, capturedOwner.jobId)
        ) return;
        setDiagnosisReport(completedReport);
        setReportStage("complete");
        setReportProgress(100);
      })
      .catch((reportFailure: unknown) => {
        if (reportFailure instanceof DOMException && reportFailure.name === "AbortError") return;
        if (!ownsCreation()) return;
        setReportStage("failed");
        setReportError(reportFailure instanceof Error ? reportFailure.message : String(reportFailure));
      })
      .finally(() => {
        if (!ownsCreation()) return;
        setReportRunning(false);
        diagnosisJobOwnerRef.current = null;
        diagnosisJobAbortRef.current = null;
      });
  };

  const handleSeekRiskEvent = (time: number, event?: RiskEvent) => {
    const replayTime = resolveReplayTime(event ?? { seekTime: time });
    const video = videoRef.current;
    if (video) {
      video.currentTime = replayTime;
      void video.play().catch(() => undefined);
    }
    setCurrentTime(replayTime);
  };

  const demoParam = new URLSearchParams(window.location.search).get("demo");
  const positioningOrbitDemo = demoParam === "positioning-orbit";
  const contextCardsDemo = demoParam === "context-cards";
  const lidarSlot = (
    <div className="cockpit-lidar-slot">
      <div className="panel-title">
        <Layers3 size={18} aria-hidden="true" />
        <span>激光雷达三维点云</span>
        <strong>高危 {highRiskObjects} / 中危 {mediumRiskObjects}</strong>
      </div>
      <LidarBev
        sceneId={selectedScene.id}
        pointCloud={currentPointCloud}
        frame={currentPerception}
        history={lidarHistory}
        status={lidarDisplayState.tone}
        errorMessage={lidarError}
      />
      <div className="lidar-metadata" aria-label="LiDAR 数据状态">
        <span>源 {resolveLidarSource(selectedScene) ? "nuScenes 激光雷达" : "仅相机"}</span>
        <span>点 {renderedLidarFrame?.pointCount.toLocaleString() ?? "--"}</span>
        <span>关键帧 {renderedLidarFrame ? `${formatNumber(renderedLidarFrame.time, 2)}s` : "--"}</span>
        <span className={`lidar-status lidar-status-${lidarDisplayState.tone}`}>{lidarDisplayState.text}</span>
      </div>
    </div>
  );
  const mapSlot = (
    <div className="cockpit-map-slot">
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
          <button type="button" onClick={() => updateMapZoom(1.2)} title="放大地图" aria-label="放大地图"><Plus size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => updateMapZoom(1 / 1.2)} title="缩小地图" aria-label="缩小地图"><Minus size={16} aria-hidden="true" /></button>
          <button type="button" onClick={resetMapViewport} title="回到自车当前位置" aria-label="回到自车当前位置"><LocateFixed size={16} aria-hidden="true" /></button>
        </div>
        <div className="map-interaction-hint"><Move size={13} aria-hidden="true" /> 拖拽平移 · 滚轮缩放</div>
      </div>
    </div>
  );
  const historySlot = (
    <div className="diagnosis-history-panel">
      <div className="result-title">
        <History size={18} aria-hidden="true" />
        <span>历史风险事件</span>
        <strong>{completedRiskEvents.length} 条</strong>
      </div>
      <p className="risk-events-hint">事件结束后自动归档；点击即可回到风险峰值帧，并同步视频、感知与轨迹视图。</p>
      <RiskEventsList events={completedRiskEvents} currentTime={currentTime} onSeek={handleSeekRiskEvent} />
    </div>
  );
  const diagnosisSlot = (
    <aside className="diagnosis-panel">
      <div className="panel-title">
        <BrainCircuit size={18} aria-hidden="true" />
        <span>AI 全域诊断</span>
        <strong className={`status-dot status-${connectionStatus}`}>{statusText[connectionStatus]}</strong>
      </div>
      <div className="cockpit-diagnosis-progress" aria-label="诊断进度">
        <span>全场景报告</span>
        <strong>{reportRunning ? `${reportProgress}%` : diagnosisReport ? "已完成" : reportError ? "失败" : "等待启动"}</strong>
        <i style={{ width: `${reportProgress}%` }} />
      </div>
      <div className="cockpit-diagnosis__buttons">
        <button
          className="diagnose-button diagnose-button--secondary"
          type="button"
          onClick={handleDiagnose}
          disabled={diagnosing || connectionStatus !== "connected" || !currentFrame}
          title="通过 WebSocket 诊断当前视频帧"
          aria-label="全域诊断"
        >
          {diagnosing ? <LoaderCircle className="spin" size={17} /> : <BrainCircuit size={17} />}
          {diagnosing ? "当前帧诊断中" : "当前帧诊断"}
        </button>
        <button
          className="diagnose-button"
          type="button"
          onClick={handleGenerateReport}
          disabled={reportRunning || sceneLoading}
        >
          {reportRunning ? <LoaderCircle className="spin" size={17} /> : <FileSearch size={17} />}
          {reportRunning ? "报告生成中" : "生成全场景报告"}
        </button>
      </div>
      {error && <div className="message error-message"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div>}
      {reportError && <div className="message error-message"><AlertTriangle size={18} aria-hidden="true" /><span>{reportError}</span></div>}
      <span className="cockpit-diagnosis__stage" aria-live="polite">任务阶段：{diagnosisStageText[reportStage]}</span>
      <div className="result-panel">
        <div className="result-title"><BrainCircuit size={18} aria-hidden="true" /><span>诊断分析</span></div>
        <p>{diagnosis?.thought ?? "点击全域诊断后，这里会展示后端返回的风险分析。"}</p>
      </div>
      <div className="result-panel conclusion-panel">
        <div className="result-title"><ShieldCheck size={18} aria-hidden="true" /><span>最终结论</span></div>
        <p>{diagnosis?.conclusion ?? "等待当前帧诊断结果。"}</p>
      </div>
    </aside>
  );
  const siteView = viewPhase === "cockpit" ? null : positioningOrbitDemo ? <PositioningOrbitDemo /> : contextCardsDemo ? <ContextCardsDemo /> : <ProjectSite
      onOpenDemo={handleOpenDemo}
      onTerrainPresetChange={setTerrainPreset}
      playOpening={!showcaseOpeningPlayedRef.current}
      onOpeningComplete={handleShowcaseOpeningComplete}
      active={viewPhase === "site" || viewPhase === "exiting"}
      onShowcaseRootChange={(root) => {
        showcaseRootRef.current = root;
      }}
      restoreScrollTop={viewPhase === "exiting" ? showcaseScrollTopRef.current : null}
    />;
  const cockpitView = viewPhase === "site" ? null : (
    <CockpitExperience
      scenes={scenes}
      selectedSceneKey={selectedScene.id}
      sceneVideoSrc={selectedScene.videoFile}
      sceneLoading={sceneLoading}
      objects={visibleCameraObjects}
      monitoring={{
        currentObjects: currentPerception?.objects.length ?? 0,
        highRiskObjects,
        mediumRiskObjects,
        frameRiskLabel: riskText[frameRisk],
        errorMessage: error,
        details: [
          { label: "车速", value: `${formatNumber(currentFrame?.speedKmh ?? NaN)} km/h` },
          { label: "刹车", value: formatNumber(currentFrame?.brake ?? NaN, 2) },
          { label: "油门", value: formatNumber(currentFrame?.throttle ?? NaN, 2) },
          { label: "转向", value: formatNumber(currentFrame?.steering ?? NaN, 2) },
          { label: "加速度", value: `${formatNumber(currentFrame?.accel ?? NaN, 2)} m/s²` },
          { label: "感知目标", value: `${currentPerception?.objects.length ?? 0}` },
          { label: "场景状态", value: currentFrame?.scene ?? "等待车辆状态" },
        ],
      }}
      lidarSlot={lidarSlot}
      mapSlot={mapSlot}
      historySlot={historySlot}
      diagnosisSlot={diagnosisSlot}
      report={diagnosisReport}
      reportExpanded={diagnosisReport !== null}
      videoRef={videoRef}
      onSceneSelect={handleSceneSelection}
      onSeekReportEvidence={handleSeekRiskEvent}
      onScreenChange={setCockpitScreen}
      onReturnSite={handleReturnSite}
      onContact={() => {
        handleReturnSite("contact");
      }}
    />
  );

  return (
    <>
      <TerrainBackdrop
        view={showDashboard ? "dashboard" : "showcase"}
        preset={terrainPreset}
        risk={panelRisk}
      />
      <ViewTransitionStage
        phase={viewPhase}
        site={siteView}
        cockpit={cockpitView}
        onTransitionComplete={handleTransitionComplete}
      />
    </>
  );
}

export default App;
