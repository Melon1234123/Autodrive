/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const appTestHarness = vi.hoisted(() => ({
  lidarSnapshots: [] as Array<{
    sceneId: string;
    pointCloud: Float32Array | null;
    frame: unknown;
    history: unknown[];
    status: string;
  }>,
}));

vi.mock("./TerrainBackdrop", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ view, preset, risk }: { view: string; preset: string; risk: string }) => h("div", {
      "data-preset": preset,
      "data-risk": risk,
      "data-testid": "terrain-backdrop-mock",
      "data-view": view,
    }),
  };
});
vi.mock("./useShowcaseMotion", () => ({ useShowcaseMotion: vi.fn() }));
vi.mock("./LidarBev", async () => {
  const { createElement: h } = await import("react");
  return {
    LidarBev: (props: {
      sceneId: string;
      pointCloud: Float32Array | null;
      frame: unknown;
      history: unknown[];
      status: string;
    }) => {
      appTestHarness.lidarSnapshots.push(props);
      return h("div", {
        "data-cloud": props.pointCloud ? "present" : "empty",
        "data-frame": props.frame ? "present" : "empty",
        "data-history-count": String(props.history.length),
        "data-scene-id": props.sceneId,
        "data-status": props.status,
        "data-testid": "lidar-bev-mock",
      });
    },
  };
});

import App, {
  advanceDiagnosisProgress,
  clearMapCanvasBitmap,
  DEFAULT_MAP_VIEWPORT,
  loadOptionalLidarIndex,
  ProjectSite,
  resolveLidarDisplayState,
  resolveLidarRequestCandidate,
  resolveLidarRequestKey,
  resolveLidarSource,
  resolveReplayTime,
  shouldAcceptDiagnosisResponse,
  shouldAcceptDiagnosisJobUpdate,
} from "./App";
import type { DiagnosisReport } from "./cockpit/types";
import { selectMapGeometry } from "./map-geometry";

const resizeObserverInstances: ResizeObserverMock[] = [];
class ResizeObserverMock {
  constructor(public callback: ResizeObserverCallback) {
    resizeObserverInstances.push(this);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

class IntersectionObserverMock {
  constructor(_callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {}
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "0px";
  thresholds = [];
}

globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

function activateCockpitScreen(screenName: "实时解析" | "全域诊断") {
  const root = document.querySelector<HTMLElement>(".cockpit-experience")!;
  const sections = [
    screen.getByRole("region", { name: "场景入口" }),
    screen.getByRole("region", { name: "实时解析" }),
    screen.getByRole("region", { name: "全域诊断" }),
  ];
  const activeIndex = screenName === "实时解析" ? 1 : 2;
  Object.defineProperty(root, "scrollTop", { configurable: true, value: activeIndex * 1000, writable: true });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  sections.forEach((section, index) => {
    vi.spyOn(section, "getBoundingClientRect").mockReturnValue({
      top: (index - activeIndex) * 1000,
      height: 1000,
    } as DOMRect);
  });
  fireEvent.scroll(root);
}

function enterCockpit() {
  fireEvent.click(screen.getByRole("button", { name: /进入效果展示/ }));
  fireEvent.transitionEnd(screen.getByTestId("view-layer-cockpit"), { propertyName: "transform" });
}

class WebSocketMock {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: WebSocketMock[] = [];
  readyState = WebSocketMock.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor() {
    WebSocketMock.instances.push(this);
  }
}

globalThis.WebSocket = WebSocketMock as unknown as typeof WebSocket;

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => null),
});
Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});
Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

afterEach(() => {
  cleanup();
  appTestHarness.lidarSnapshots.length = 0;
  resizeObserverInstances.length = 0;
  WebSocketMock.instances.length = 0;
  vi.unstubAllGlobals();
});

it("does not mount a global aurora background", () => {
  render(createElement(App));
  expect(document.querySelector(".app-aurora")).not.toBeInTheDocument();
});

it("lazy-mounts the cockpit and showcase layers across transition phases", () => {
  render(createElement(App));
  expect(document.querySelector(".showcase")).toBeInTheDocument();
  expect(document.querySelector(".cockpit-experience")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /进入效果展示/ }));
  expect(document.querySelector(".showcase")).toBeInTheDocument();
  expect(document.querySelector(".cockpit-experience")).toBeInTheDocument();

  fireEvent.transitionEnd(screen.getByTestId("view-layer-cockpit"), { propertyName: "transform" });
  expect(document.querySelector(".showcase")).not.toBeInTheDocument();
  expect(document.querySelector(".cockpit-experience")).toBeInTheDocument();
});

it("restores the saved showcase scroll position while exiting the cockpit", () => {
  render(createElement(App));
  const showcase = document.querySelector<HTMLElement>(".showcase")!;
  Object.defineProperty(showcase, "scrollTop", { configurable: true, value: 640, writable: true });

  enterCockpit();
  fireEvent.click(screen.getByRole("button", { name: "返回官网" }));

  const restoredShowcase = document.querySelector<HTMLElement>(".showcase")!;
  expect(restoredShowcase).not.toBe(showcase);
  expect(restoredShowcase.scrollTop).toBe(640);
});

it("keeps one terrain backdrop mounted while switching views", () => {
  render(createElement(App));
  const terrain = screen.getByTestId("terrain-backdrop-mock");
  expect(terrain).toHaveAttribute("data-view", "showcase");
  expect(terrain).toHaveAttribute("data-preset", "hidden");
  expect(terrain).toHaveAttribute("data-risk", "unknown");
  enterCockpit();
  expect(screen.getByTestId("terrain-backdrop-mock")).toBe(terrain);
  expect(terrain).toHaveAttribute("data-view", "dashboard");
  fireEvent.click(screen.getByRole("button", { name: "返回官网" }));
  fireEvent.transitionEnd(screen.getByTestId("view-layer-site"), { propertyName: "transform" });
  expect(screen.getByTestId("terrain-backdrop-mock")).toBe(terrain);
  expect(terrain).toHaveAttribute("data-preset", "hidden");
});

it("renders the demo as a visual-only cockpit entry", () => {
  const onOpenDemo = vi.fn();

  render(createElement(ProjectSite, {
    active: true,
    onOpenDemo,
    onTerrainPresetChange: vi.fn(),
    playOpening: false,
    onOpeningComplete: vi.fn(),
  }));

  const cockpitButtons = screen.getAllByRole("button", { name: "进入驾驶舱" });
  expect(cockpitButtons).toHaveLength(1);
  fireEvent.click(cockpitButtons[0]);
  expect(onOpenDemo).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("DRIVEGUARD / LIVE DEMO")).not.toBeInTheDocument();
  expect(screen.queryByText("nuScenes mini · 前视视频 · 激光雷达")).not.toBeInTheDocument();
  expect(screen.queryByText("视频 · 点云 · 地图 · 诊断同步")).not.toBeInTheDocument();
  expect(screen.queryByText("前视视频")).not.toBeInTheDocument();
  expect(screen.queryByText("三维点云")).not.toBeInTheDocument();
  expect(screen.queryByText("AI 诊断")).not.toBeInTheDocument();
  expect(screen.queryByText("打开后可查看感知框、原始点云、地图轨迹、全域诊断和历史风险事件回放。")).not.toBeInTheDocument();
  expect(document.querySelector(".mini-map")).not.toBeInTheDocument();
});

it("mounts the three-screen cockpit with embedded videos and one persistent evidence workspace", () => {
  render(createElement(App));
  enterCockpit();

  expect(screen.getByRole("region", { name: "场景入口" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "实时解析" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "全域诊断" })).toBeInTheDocument();
  expect(document.querySelectorAll(".cockpit-experience video")).toHaveLength(3);
  const lidar = screen.getByTestId("lidar-bev-mock");
  const map = document.querySelector(".map-stage");
  expect(lidar.closest(".cockpit-evidence-parking")).toBeInTheDocument();
  expect(map?.closest(".cockpit-evidence-parking")).toBeInTheDocument();

  activateCockpitScreen("实时解析");
  expect(screen.getAllByTestId("lidar-bev-mock")).toHaveLength(1);
  expect(document.querySelectorAll(".map-stage")).toHaveLength(1);
  expect(screen.getByTestId("lidar-bev-mock")).toBe(lidar);
  expect(document.querySelector(".map-stage")).toBe(map);
});

it("slides from the showcase into the full-screen cockpit and returns on Esc", () => {
  render(createElement(App));
  const entry = screen.getByRole("button", { name: /进入效果展示/ });
  fireEvent.click(entry);

  const stage = screen.getByTestId("view-transition-stage");
  expect(stage).toHaveAttribute("data-view-transition-phase", "entering");
  fireEvent.transitionEnd(screen.getByTestId("view-layer-cockpit"), { propertyName: "transform" });
  expect(stage).toHaveAttribute("data-view-transition-phase", "cockpit");
  expect(screen.getByRole("region", { name: "场景入口" })).toBeInTheDocument();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(stage).toHaveAttribute("data-view-transition-phase", "exiting");
  fireEvent.transitionEnd(screen.getByTestId("view-layer-site"), { propertyName: "transform" });
  expect(stage).toHaveAttribute("data-view-transition-phase", "site");
  expect(screen.getByRole("button", { name: /进入效果展示/ })).toBeInTheDocument();
});

it("does not accept a second enter request while the stage is transitioning", () => {
  render(createElement(App));
  const entry = screen.getByRole("button", { name: /进入效果展示/ });
  fireEvent.click(entry);
  fireEvent.click(entry);
  expect(screen.getByTestId("view-transition-stage")).toHaveAttribute(
    "data-view-transition-phase",
    "entering",
  );
});

it("returns to the contact section only after the cockpit exit completes", async () => {
  render(createElement(App));
  enterCockpit();

  fireEvent.click(screen.getByRole("button", { name: "联系我们" }));
  expect(screen.getByTestId("view-transition-stage")).toHaveAttribute("data-view-transition-phase", "exiting");
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

  fireEvent.transitionEnd(screen.getByTestId("view-layer-site"), { propertyName: "transform" });
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" }));
});

describe("cockpit replay integration", () => {
  it("clears the full canvas bitmap under an identity transform", () => {
    const save = vi.fn();
    const setTransform = vi.fn();
    const clearRect = vi.fn();
    const restore = vi.fn();
    const context = { save, setTransform, clearRect, restore } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 937,
      height: 541,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;

    clearMapCanvasBitmap(canvas);

    expect(save).toHaveBeenCalledOnce();
    expect(setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 937, 541);
    expect(restore).toHaveBeenCalledOnce();
  });

  it("defines one stable default map viewport", () => {
    expect(DEFAULT_MAP_VIEWPORT).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 });
  });

  it("keeps route source selection stable for stationary ego data", () => {
    const geometry = selectMapGeometry(
      [{ forward: 0, left: 0 }, { forward: 0, left: 0 }],
      [{ x: 0, y: 0, z: 0 }, { x: 40, y: 2, z: 0 }],
      [{ id: "ego", points: [{ x: 0, y: 0, z: 0 }, { x: 60, y: 0, z: 0 }] }],
    );

    expect(geometry.source).toBe("planned-path");
  });

  it("clears the current lidar index when the selected scene has no lidarIndexFile", () => {
    expect(resolveLidarSource({})).toBeNull();
  });

  it("uses the same event peak time for video seeking and lidar lookup", () => {
    expect(resolveReplayTime({ seekTime: 12.5 })).toBe(12.5);
  });

  it("scopes stable LiDAR request keys to the selected scene", () => {
    expect(resolveLidarRequestKey("scene-a", { file: "frames/1.bin" })).toBe("scene-a:frames/1.bin");
    expect(resolveLidarRequestKey("scene-b", { file: "frames/1.bin" })).not.toBe(
      resolveLidarRequestKey("scene-a", { file: "frames/1.bin" }),
    );
  });

  it("does not derive a LiDAR request from an index owned by another scene", () => {
    const index = {
      version: 1,
      pointFormat: "xyzI-f32-le" as const,
      frames: [{ time: 0, timestampUs: 0, file: "frames/1.bin", pointCount: 1 }],
    };
    const ownedIndex = { sceneId: "scene-a", index };

    expect(resolveLidarRequestCandidate("scene-b", ownedIndex, 0)).toBeNull();
    expect(resolveLidarRequestCandidate("scene-a", ownedIndex, 0)).toEqual({
      frame: index.frames[0],
      key: "scene-a:frames/1.bin",
    });
  });

  it("contains a rejected optional LiDAR index load", async () => {
    const result = await loadOptionalLidarIndex(
      "/scenes/default/lidar/index.json",
      undefined,
      async () => Promise.reject(new Error("index HTTP 500")),
    );

    expect(result).toEqual({ index: null, errorMessage: "index HTTP 500" });
  });

  it("derives truthful LiDAR display states", () => {
    expect(resolveLidarDisplayState("loading", null, null, false)).toEqual({ tone: "loading", text: "同步中" });
    expect(resolveLidarDisplayState("ready", "scene-a:next.bin", "scene-a:current.bin", true)).toEqual({ tone: "loading", text: "同步中" });
    expect(resolveLidarDisplayState("ready", "scene-a:current.bin", "scene-a:current.bin", true)).toEqual({ tone: "ready", text: "已同步" });
    expect(resolveLidarDisplayState("unavailable", null, null, false)).toEqual({ tone: "unavailable", text: "仅相机" });
    expect(resolveLidarDisplayState("error", null, null, false)).toEqual({ tone: "error", text: "读取失败" });
  });

  it("accepts diagnosis responses only for the active scene, request, and socket generations", () => {
    const pending = { sceneGeneration: 4, requestGeneration: 7, socketGeneration: 2 };

    expect(shouldAcceptDiagnosisResponse(pending, 4, 7, 2)).toBe(true);
    expect(shouldAcceptDiagnosisResponse(pending, 5, 7, 2)).toBe(false);
    expect(shouldAcceptDiagnosisResponse(pending, 4, 8, 2)).toBe(false);
    expect(shouldAcceptDiagnosisResponse(pending, 4, 7, 3)).toBe(false);
    expect(shouldAcceptDiagnosisResponse(null, 4, 7, 2)).toBe(false);
  });

  it("accepts report progress only for the active scene generation, scene key, and job", () => {
    const owner = { sceneGeneration: 4, sceneKey: "scene-a", jobId: "job-1" };

    expect(shouldAcceptDiagnosisJobUpdate(owner, 4, "scene-a", "job-1")).toBe(true);
    expect(shouldAcceptDiagnosisJobUpdate(owner, 5, "scene-a", "job-1")).toBe(false);
    expect(shouldAcceptDiagnosisJobUpdate(owner, 4, "scene-b", "job-1")).toBe(false);
    expect(shouldAcceptDiagnosisJobUpdate(owner, 4, "scene-a", "job-2")).toBe(false);
    expect(shouldAcceptDiagnosisJobUpdate(null, 4, "scene-a", "job-1")).toBe(false);
  });

  it("keeps report progress monotonic across create and poll snapshots", () => {
    expect(advanceDiagnosisProgress(50, 18)).toBe(50);
    expect(advanceDiagnosisProgress(50, 86)).toBe(86);
  });
});

it("attaches the map resize observer when the cockpit canvas mounts", () => {
  render(createElement(App));
  expect(resizeObserverInstances.some((observer) => observer.observe.mock.calls.some(([target]) => (
    target as Element
  ).classList.contains("map-stage")))).toBe(false);

  enterCockpit();
  activateCockpitScreen("实时解析");
  const mapStage = document.querySelector(".map-stage");
  const mapObserver = resizeObserverInstances.find((observer) => observer.observe.mock.calls.some(([target]) => target === mapStage));

  expect(mapObserver).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "返回官网" }));
  fireEvent.transitionEnd(screen.getByTestId("view-layer-site"), { propertyName: "transform" });
  expect(mapObserver?.disconnect).toHaveBeenCalledOnce();
});

it("clears old scene coordinates until the selected scene perception resolves", async () => {
  const telemetry = [{
    time: 0,
    speedKmh: 18,
    brake: 0,
    throttle: 0.2,
    steering: 0,
    accel: 0,
    scene: "test scene",
  }];
  const perception = (latitude: number, longitude: number) => [{
    time: 0,
    timestampUs: 0,
    ego: { x: 0, y: 0, yaw: 0, latitude, longitude },
    objects: [],
    lanes: [{
      id: "ego",
      points: [{ x: -12, y: 0, z: 0 }, { x: 76, y: 0, z: 0 }],
    }],
    plannedPath: [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }],
  }];
  const scenes = {
    version: 1,
    defaultSceneId: "scene-a",
    scenes: [
      {
        id: "scene-a",
        label: "场景 A",
        videoFile: "/scene-a.mp4",
        telemetryFile: "/scene-a-telemetry.json",
        perceptionFile: "/scene-a-perception.json",
        metadataFile: "/scene-a-meta.json",
      },
      {
        id: "scene-b",
        label: "场景 B",
        videoFile: "/scene-b.mp4",
        telemetryFile: "/scene-b-telemetry.json",
        perceptionFile: "/scene-b-perception.json",
        metadataFile: "/scene-b-meta.json",
      },
    ],
  };
  const jsonResponse = (data: unknown) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  let resolveSceneBPerception!: (response: Response) => void;
  const sceneBPerception = new Promise<Response>((resolve) => {
    resolveSceneBPerception = resolve;
  });
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url === "/scenes.json") return Promise.resolve(jsonResponse(scenes));
    if (url.endsWith("/health")) return Promise.resolve(jsonResponse({ status: "ok", mode: "fallback", model: "test" }));
    if (url === "/scene-b-perception.json") return sceneBPerception;
    if (url.endsWith("telemetry.json")) return Promise.resolve(jsonResponse(telemetry));
    if (url === "/scene-a-perception.json" || url === "/perception.json") {
      return Promise.resolve(jsonResponse(perception(31.12345, 121.54321)));
    }
    if (url.endsWith("meta.json") || url === "/dataset-meta.json") {
      return Promise.resolve(jsonResponse({ sceneName: "test" }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(createElement(App));
  enterCockpit();
  activateCockpitScreen("实时解析");
  const sceneSelector = await screen.findByRole("combobox", { name: "选择数据场景" });
  const mapPanel = document.querySelector(".cockpit-map-slot") as HTMLElement;
  await waitFor(() => {
    expect(sceneSelector).toHaveValue("scene-a");
    expect(sceneSelector).toBeEnabled();
    expect(mapPanel.querySelector(".panel-title strong")).toHaveTextContent("31.12345, 121.54321");
  });

  fireEvent.click(screen.getByRole("button", { name: "放大地图" }));
  const mapCanvas = mapPanel.querySelector("canvas") as HTMLCanvasElement;
  mapCanvas.width = 937;
  mapCanvas.height = 541;
  const save = vi.fn();
  const setTransform = vi.fn();
  const clearRect = vi.fn();
  const restore = vi.fn();
  const clearContext = { save, setTransform, clearRect, restore } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(mapCanvas, "getContext", {
    configurable: true,
    value: vi.fn(() => mapCanvas.width === 937 ? clearContext : null),
  });

  fireEvent.change(sceneSelector, { target: { value: "scene-b" } });

  expect(sceneSelector).toHaveValue("scene-b");
  expect(mapPanel.querySelector(".panel-title strong")).toHaveTextContent("--");
  expect(setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  expect(clearRect).toHaveBeenCalledWith(0, 0, 937, 541);
  expect(restore).toHaveBeenCalledOnce();

  await act(async () => {
    resolveSceneBPerception(jsonResponse(perception(32.22222, 120.33333)));
    await sceneBPerception;
  });
  await waitFor(() => {
    expect(mapPanel.querySelector(".panel-title strong")).toHaveTextContent("32.22222, 120.33333");
  });
});

describe("scene-owned cockpit async state", () => {
  const completedReport = {
    schema_version: "1.0",
    scene_name: "旧场景报告",
    data_version: "manifest-v1",
    generation_mode: "local-harness",
    executive_summary: "STALE REPORT CONTENT",
    scene_overview: {},
    data_quality: [],
    scores: { perception: 10, motion: 20, control: 30, trajectory: 40, data_quality: 90, overall: 30, confidence: 0.9 },
    key_findings: [],
    timeline: [],
    historical_risk_events: [],
    perception_analysis: { summary: "感知稳定。", metrics: {}, evidence_ids: [] },
    motion_control_analysis: { summary: "控制稳定。", metrics: {}, evidence_ids: [] },
    trajectory_analysis: { summary: "轨迹稳定。", metrics: {}, evidence_ids: [] },
    causal_chains: [],
    recommendations: [],
    regression_tests: [],
    evidence_index: [],
    limitations: [],
  } satisfies DiagnosisReport;
  const telemetry = [{
    time: 0,
    speedKmh: 18,
    brake: 0,
    throttle: 0.2,
    steering: 0,
    accel: 0,
    scene: "test scene",
  }];
  const perception = [
    {
      time: -0.1,
      timestampUs: -100000,
      ego: { x: -1, y: 0, yaw: 0, latitude: 31.1, longitude: 121.5 },
      objects: [],
      lanes: [],
      plannedPath: [],
    },
    {
      time: 0,
      timestampUs: 0,
      ego: { x: 0, y: 0, yaw: 0, latitude: 31.1, longitude: 121.5 },
      objects: [],
      lanes: [],
      plannedPath: [],
    },
  ];
  const lidarIndex = {
    version: 1,
    pointFormat: "xyzI-f32-le",
    frames: [
      { time: -0.1, timestampUs: -100000, file: "frames/previous.bin", pointCount: 1 },
      { time: 0, timestampUs: 0, file: "frames/current.bin", pointCount: 1 },
    ],
  };
  const jsonResponse = (data: unknown) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const makeManifest = (withLidar: boolean) => ({
    version: 1,
    defaultSceneId: "scene-a",
    scenes: ["scene-a", "scene-b"].map((id) => ({
      id,
      label: id === "scene-a" ? "场景 A" : "场景 B",
      videoFile: `/${id}.mp4`,
      telemetryFile: `/${id}-telemetry.json`,
      perceptionFile: `/${id}-perception.json`,
      metadataFile: `/${id}-meta.json`,
      ...(withLidar ? { lidarIndexFile: `/${id}/lidar/index.json` } : {}),
    })),
  });
  const createSceneFetch = (options: {
    withLidar: boolean;
    sceneATelemetry?: Promise<Response>;
  }) => vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url === "/scenes.json") return Promise.resolve(jsonResponse(makeManifest(options.withLidar)));
    if (url.endsWith("/health")) return Promise.resolve(jsonResponse({ status: "ok", mode: "fallback", model: "test" }));
    if (url === "/scene-a-telemetry.json" && options.sceneATelemetry) return options.sceneATelemetry;
    if (url.endsWith("telemetry.json")) return Promise.resolve(jsonResponse(telemetry));
    if (url.endsWith("perception.json")) return Promise.resolve(jsonResponse(perception));
    if (url.endsWith("meta.json") || url === "/dataset-meta.json") return Promise.resolve(jsonResponse({ sceneName: "test" }));
    if (url.endsWith("/lidar/index.json")) return Promise.resolve(jsonResponse(lidarIndex));
    if (url.endsWith(".bin")) return Promise.resolve(new Response(new Float32Array([1, 0, 0, 128]).buffer));
    return Promise.resolve(new Response(null, { status: 404 }));
  });

  it("clears LiDAR metadata and render props in the first commit for a new scene", async () => {
    vi.stubGlobal("fetch", createSceneFetch({ withLidar: true }));

    render(createElement(App));
    enterCockpit();
    activateCockpitScreen("实时解析");
    const sceneSelector = await screen.findByRole("combobox", { name: "选择数据场景" });
    await waitFor(() => {
      expect(sceneSelector).toHaveValue("scene-a");
      expect(sceneSelector).toBeEnabled();
      expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-cloud", "present");
      expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-history-count", "1");
    });

    const snapshotStart = appTestHarness.lidarSnapshots.length;
    fireEvent.change(sceneSelector, { target: { value: "scene-b" } });

    const firstSceneBSnapshot = appTestHarness.lidarSnapshots.slice(snapshotStart).find((snapshot) => snapshot.sceneId === "scene-b");
    expect(firstSceneBSnapshot?.pointCloud).toBeNull();
    expect(firstSceneBSnapshot?.frame).toBeNull();
    expect(firstSceneBSnapshot?.history).toEqual([]);
    expect(firstSceneBSnapshot?.status).toBe("loading");
    expect(screen.getByLabelText("LiDAR 数据状态")).toHaveTextContent("点 --");
    expect(screen.getByLabelText("LiDAR 数据状态")).toHaveTextContent("关键帧 --");
  });

  it("keeps active-scene evidence intact when the same scene is selected again", async () => {
    vi.stubGlobal("fetch", createSceneFetch({ withLidar: true }));

    render(createElement(App));
    enterCockpit();
    activateCockpitScreen("实时解析");
    const sceneSelector = await screen.findByRole("combobox", { name: "选择数据场景" });
    await waitFor(() => {
      expect(sceneSelector).toHaveValue("scene-a");
      expect(sceneSelector).toBeEnabled();
      expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-cloud", "present");
      expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-status", "ready");
      expect(document.querySelector(".cockpit-map-slot .panel-title strong")).toHaveTextContent("31.10000, 121.50000");
    });

    appTestHarness.lidarSnapshots.length = 0;
    fireEvent.change(sceneSelector, { target: { value: "scene-a" } });

    expect(appTestHarness.lidarSnapshots.some((snapshot) => snapshot.pointCloud === null)).toBe(false);
    expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-cloud", "present");
    expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-status", "ready");
    expect(screen.getByLabelText("LiDAR 数据状态")).toHaveTextContent("已同步");
    expect(document.querySelector(".cockpit-map-slot .panel-title strong")).toHaveTextContent("31.10000, 121.50000");
  });

  it("keeps healthy LiDAR available when the telemetry bundle fails", async () => {
    let rejectTelemetry!: (reason: Error) => void;
    const pendingTelemetry = new Promise<Response>((_resolve, reject) => {
      rejectTelemetry = reject;
    });
    vi.stubGlobal("fetch", createSceneFetch({ withLidar: true, sceneATelemetry: pendingTelemetry }));

    render(createElement(App));
    enterCockpit();
    activateCockpitScreen("实时解析");
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "选择数据场景" })).toHaveValue("scene-a");
      expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-cloud", "present");
      expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-status", "ready");
    });

    await act(async () => {
      rejectTelemetry(new Error("telemetry offline"));
      await pendingTelemetry.catch(() => undefined);
    });

    await waitFor(() => expect(screen.getByText(/telemetry offline/)).toBeInTheDocument());
    expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-cloud", "present");
    expect(screen.getByTestId("lidar-bev-mock")).toHaveAttribute("data-status", "ready");
    expect(screen.getByLabelText("LiDAR 数据状态")).toHaveTextContent("已同步");
  });

  it("detaches an in-flight diagnosis socket and rejects its old-scene response", async () => {
    vi.stubGlobal("fetch", createSceneFetch({ withLidar: false }));

    render(createElement(App));
    enterCockpit();
    activateCockpitScreen("全域诊断");
    const sceneSelector = await screen.findByRole("combobox", { name: "选择数据场景" });
    await waitFor(() => {
      expect(sceneSelector).toHaveValue("scene-a");
      expect(sceneSelector).toBeEnabled();
    });
    const socket = WebSocketMock.instances[0];
    act(() => socket.onopen?.(new Event("open")));
    const diagnoseButton = screen.getByRole("button", { name: "全域诊断" });
    await waitFor(() => expect(diagnoseButton).toBeEnabled());
    fireEvent.click(diagnoseButton);
    expect(socket.send).toHaveBeenCalledOnce();
    const staleHandler = socket.onmessage;

    fireEvent.change(sceneSelector, { target: { value: "scene-b" } });

    expect(socket.onmessage).toBeNull();
    expect(socket.close).toHaveBeenCalledOnce();
    act(() => staleHandler?.(new MessageEvent("message", {
      data: JSON.stringify({
        riskLevel: "high",
        thought: "STALE THOUGHT",
        conclusion: "STALE CONCLUSION",
      }),
    })));
    expect(screen.queryByText("STALE THOUGHT")).not.toBeInTheDocument();
    expect(screen.queryByText("STALE CONCLUSION")).not.toBeInTheDocument();
    expect(screen.getByText("等待当前帧诊断结果。")).toBeInTheDocument();
  });

  it("rejects a delayed old-scene report after the new scene job becomes owner", async () => {
    let resolveOldReport!: (response: Response) => void;
    const pendingOldReport = new Promise<Response>((resolve) => {
      resolveOldReport = resolve;
    });
    let resolveCurrentReport!: (response: Response) => void;
    const pendingCurrentReport = new Promise<Response>((resolve) => {
      resolveCurrentReport = resolve;
    });
    let oldPollSignal: AbortSignal | undefined;
    const baseFetch = createSceneFetch({ withLidar: false });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/diagnoses") && init?.method === "POST") {
        const requestedScene = JSON.parse(String(init.body)).sceneKey as string;
        const current = requestedScene === "scene-b";
        return Promise.resolve(jsonResponse({
          jobId: current ? "job-current" : "job-old",
          sceneKey: requestedScene,
          dataVersion: "manifest-v1",
          stage: "validation",
          percent: 10,
          report: null,
          error: null,
        }));
      }
      if (url.endsWith("/api/v1/diagnoses/job-old")) {
        oldPollSignal = init?.signal ?? undefined;
        return pendingOldReport;
      }
      if (url.endsWith("/api/v1/diagnoses/job-current")) return pendingCurrentReport;
      return baseFetch(input);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(App));
    enterCockpit();
    activateCockpitScreen("全域诊断");
    const sceneSelector = await screen.findByRole("combobox", { name: "选择数据场景" });
    await waitFor(() => expect(sceneSelector).toHaveValue("scene-a"));

    const reportButton = screen.getByRole("button", { name: "生成全场景报告" });
    await waitFor(() => expect(reportButton).toBeEnabled());
    fireEvent.click(reportButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/diagnoses\/job-old$/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    fireEvent.change(sceneSelector, { target: { value: "scene-b" } });
    expect(oldPollSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(sceneSelector).toHaveValue("scene-b");
      expect(screen.getByRole("button", { name: "生成全场景报告" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "生成全场景报告" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/diagnoses\/job-current$/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    await act(async () => {
      resolveOldReport(jsonResponse({
        jobId: "job-old",
        sceneKey: "scene-a",
        dataVersion: "manifest-v1",
        stage: "complete",
        percent: 100,
        report: completedReport,
        error: null,
      }));
      await pendingOldReport;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText("STALE REPORT CONTENT")).not.toBeInTheDocument();

    await act(async () => {
      resolveCurrentReport(jsonResponse({
        jobId: "job-current",
        sceneKey: "scene-b",
        dataVersion: "manifest-v1",
        stage: "complete",
        percent: 100,
        report: {
          ...completedReport,
          scene_name: "新场景报告",
          executive_summary: "CURRENT REPORT CONTENT",
        },
        error: null,
      }));
      await pendingCurrentReport;
    });
    expect(await screen.findByText("CURRENT REPORT CONTENT")).toBeInTheDocument();
  });
});

describe("ProjectSite", () => {
  it("uses the five section themes in the glass navigation", () => {
    render(createElement(ProjectSite, { active: true, onOpenDemo: vi.fn(), onTerrainPresetChange: vi.fn(), playOpening: false, onOpeningComplete: vi.fn() }));

    const nav = document.querySelector(".showcase-nav") as HTMLElement;
    expect(within(nav).getByRole("link", { name: "项目定位" })).toHaveAttribute("href", "#origin");
    expect(within(nav).getByRole("link", { name: "安全命题" })).toHaveAttribute("href", "#context");
    expect(within(nav).getByRole("link", { name: "技术路线" })).toHaveAttribute("href", "#route");
    expect(within(nav).getByRole("link", { name: "效果展示" })).toHaveAttribute("href", "#demo");
    expect(within(nav).getByRole("link", { name: "产品体系" })).toHaveAttribute("href", "#product");
    expect(nav.querySelector(".brand small")).not.toBeInTheDocument();
    expect(within(nav).getByText("联系我们")).toBeInTheDocument();
  });

  it("uses the approved evidence-card layout on the formal safety section", () => {
    render(createElement(ProjectSite, { active: true, onOpenDemo: vi.fn(), onTerrainPresetChange: vi.fn(), playOpening: false, onOpeningComplete: vi.fn() }));

    const context = document.querySelector("#context") as HTMLElement;
    expect(context).toHaveClass("context-cards-demo-section", "context-cards-demo-embedded");
    expect(within(context).getByRole("heading", { name: "规模化上路之后，安全需要过程可信" })).toBeInTheDocument();
    expect(within(context).getByRole("group", { name: "安全命题证据卡片" })).toBeInTheDocument();
    expect(within(context).getAllByRole("article")).toHaveLength(3);
    expect(within(context).queryByText("POLICY")).not.toBeInTheDocument();
  });

  it("maps hero through closing sections to the approved presets", () => {
    render(createElement(ProjectSite, { active: true, onOpenDemo: vi.fn(), onTerrainPresetChange: vi.fn(), playOpening: false, onOpeningComplete: vi.fn() }));
    expect([...document.querySelectorAll("[data-terrain-preset]")].map((node) => node.getAttribute("data-terrain-preset"))).toEqual([
      "hidden", "positioning", "pain", "route", "demo", "product", "closing",
    ]);
  });

  it("renders the positioning orbit independently from the route archive", () => {
    render(createElement(ProjectSite, { active: true, onOpenDemo: vi.fn(), onTerrainPresetChange: vi.fn(), playOpening: false, onOpeningComplete: vi.fn() }));
    const positioning = within(document.querySelector("#origin") as HTMLElement);
    const orbit = positioning.getByRole("region", { name: "一套面向研发测试的可解释性诊断与优化系统" });
    const route = screen.getByRole("group", { name: "技术路线四个环节" });
    const orbitCards = orbit.querySelectorAll<HTMLButtonElement>("button.positioning-orbit-card");
    expect(orbitCards).toHaveLength(4);
    expect(within(route).getAllByRole("button")).toHaveLength(4);
    expect(positioning.queryByRole("group", { name: "项目定位四项能力" })).not.toBeInTheDocument();
    fireEvent.click(orbitCards[3]);
    expect(orbitCards[3]).toHaveAttribute("aria-pressed", "true");
    expect(within(route).getByRole("button", { name: "感知诊断" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses expanded explanatory copy for the four positioning cards", () => {
    render(createElement(ProjectSite, { active: true, onOpenDemo: vi.fn(), onTerrainPresetChange: vi.fn(), playOpening: false, onOpeningComplete: vi.fn() }));

    const positioning = document.querySelector("#origin");
    expect(positioning).toBeInTheDocument();
    const section = within(positioning as HTMLElement);

    expect(section.queryByText("RESEARCH PROTOTYPE")).not.toBeInTheDocument();
    expect(section.queryByText("从单帧现象到全链路证据")).not.toBeInTheDocument();
    expect(positioning?.querySelector(".position-card")).not.toBeInTheDocument();

    expect(section.getByText("证据链诊断")).toBeInTheDocument();
    expect(section.getByText("同步视频、点云、地图、车辆状态与感知结果，按时间轴对齐风险对象、触发时刻和关键证据，帮助研发人员从异常现象追溯到具体失效链路。")).toBeInTheDocument();
    expect(section.getByText("多智能体协同")).toBeInTheDocument();
    expect(section.getByText("由编排 Agent 调度感知、决策、轨迹分析和数据生成任务，串联跨模块证据，形成从问题定位到结果复核的协同诊断流程。")).toBeInTheDocument();
    expect(section.getByText("非侵入式接入")).toBeInTheDocument();
    expect(section.getByText("通过算法结构描述协议接入视频、传感器、轨迹、目标和环境上下文，不触碰核心代码与模型权重，兼顾数据主权和跨架构适配。")).toBeInTheDocument();
    expect(section.getByText("诊断即训练")).toBeInTheDocument();
    expect(section.getByText("把诊断 Agent 发现的失效逻辑反向生成正确/错误推理对和高价值复盘样本，沉淀为可交付训练数据，支持后续模型与策略迭代。")).toBeInTheDocument();
  });

  it("centers the footer statement and adds a concise value sentence", () => {
    render(createElement(ProjectSite, { active: true, onOpenDemo: vi.fn(), onTerrainPresetChange: vi.fn(), playOpening: false, onOpeningComplete: vi.fn() }));

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveClass("showcase-footer-centered");
    expect(screen.getByText("把异常片段、感知证据、决策逻辑和优化样本沉淀到同一条可追溯链路里。")).toBeInTheDocument();
    expect(within(footer).getByText("2026 RESEARCH PROTOTYPE")).toBeInTheDocument();
    expect(footer.querySelectorAll(".footer-bottom > [data-motion-stagger-item]")).toHaveLength(3);
  });
});
