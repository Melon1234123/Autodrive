// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CockpitExperience, type CockpitExperienceProps } from "./CockpitExperience";
import type { DiagnosisReport } from "./types";

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

const scenes = [
  {
    id: "default",
    label: "城市路口侧向超车",
    videoFile: "/sample.mp4",
    telemetryFile: "/telemetry.json",
    perceptionFile: "/perception.json",
  },
  {
    id: "scene-0061",
    label: "工区左转跟车",
    videoFile: "/scenes/scene-0061/sample.mp4",
    telemetryFile: "/scenes/scene-0061/telemetry.json",
    perceptionFile: "/scenes/scene-0061/perception.json",
  },
];

const onSceneSelect = vi.fn();

const completedReport = {
  schema_version: "1.0",
  scene_name: "城市路口侧向超车",
  data_version: "test-v1",
  generation_mode: "local-harness",
  executive_summary: "全场景分析完成。",
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
  evidence_index: [{
    id: "ev-0001",
    source: "telemetry",
    provenance: "real-derived",
    start_time: 12.48,
    end_time: 12.8,
    detail: "控制响应证据。",
  }],
  limitations: [],
} satisfies DiagnosisReport;

function cockpitProps(overrides: Partial<CockpitExperienceProps> = {}): CockpitExperienceProps {
  return {
    scenes,
    selectedSceneKey: "default",
    sceneVideoSrc: "/sample.mp4",
    sceneLoading: false,
    objects: [],
    monitoring: {
      currentObjects: 4,
      highRiskObjects: 1,
      mediumRiskObjects: 2,
      frameRiskLabel: "中风险",
      details: [
        { label: "车速", value: "24.0 km/h" },
        { label: "刹车", value: "0.10" },
        { label: "油门", value: "0.30" },
        { label: "转向", value: "0.05" },
        { label: "加速度", value: "0.20 m/s2" },
        { label: "感知目标", value: "4" },
        { label: "场景状态", value: "车辆稳定跟驰" },
      ],
    },
    lidarSlot: createElement("div", { "data-testid": "lidar-slot" }),
    mapSlot: createElement("div", { "data-testid": "map-slot" }),
    historySlot: createElement("div", { "data-testid": "history-slot" }),
    diagnosisSlot: createElement("div", { "data-testid": "diagnosis-slot" }),
    report: null,
    reportExpanded: false,
    onSeekReportEvidence: vi.fn(),
    onSceneSelect,
    onReturnSite: vi.fn(),
    onContact: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  onSceneSelect.mockReset();
  vi.unstubAllGlobals();
});

it("renders three named screens and one website-matched navigation", () => {
  const { container } = render(createElement(CockpitExperience, cockpitProps()));

  expect(screen.getByRole("region", { name: "场景入口" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "实时解析" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "全域诊断" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回官网" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "联系我们" })).toBeInTheDocument();
  expect(document.querySelectorAll("video")).toHaveLength(1);
  const liveEvidencePanels = container.querySelectorAll(
    ".cockpit-live .cockpit-evidence-panel",
  );
  expect(liveEvidencePanels).toHaveLength(2);
  expect(liveEvidencePanels[1]).not.toHaveClass("map-panel");
  expect(screen.queryByText("CAM_FRONT")).not.toBeInTheDocument();
  expect(screen.queryByText("PATH SYNC")).not.toBeInTheDocument();
});

it("selects a cover scene without scrolling", () => {
  render(createElement(CockpitExperience, cockpitProps()));
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");

  fireEvent.click(screen.getByRole("button", { name: "工区左转跟车" }));

  expect(scroll).not.toHaveBeenCalled();
  expect(onSceneSelect).toHaveBeenCalledWith("scene-0061");
});

it("keeps one physical video and only mounts heavy evidence for the active analysis screen", () => {
  const { container } = render(createElement(CockpitExperience, cockpitProps()));
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;
  video.currentTime = 8.5;
  expect(screen.queryByTestId("lidar-slot")).not.toBeInTheDocument();

  const root = container.querySelector<HTMLElement>(".cockpit-experience")!;
  const entry = screen.getByRole("region", { name: "场景入口" });
  const live = screen.getByRole("region", { name: "实时解析" });
  const diagnosis = screen.getByRole("region", { name: "全域诊断" });
  Object.defineProperty(root, "scrollTop", { configurable: true, value: 1000, writable: true });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  vi.spyOn(entry, "getBoundingClientRect").mockReturnValue({ top: -1000, height: 1000 } as DOMRect);
  vi.spyOn(live, "getBoundingClientRect").mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  vi.spyOn(diagnosis, "getBoundingClientRect").mockReturnValue({ top: 1000, height: 1000 } as DOMRect);
  fireEvent.scroll(root);

  expect(screen.getByTestId("persistent-scene-video")).toBe(video);
  expect(video.currentTime).toBe(8.5);
  expect(screen.getAllByTestId("lidar-slot")).toHaveLength(1);
  expect(screen.getAllByTestId("map-slot")).toHaveLength(1);
  expect(container.querySelector(".camera-targets")).toBeInTheDocument();
});

it.each([
  { screenName: "实时解析", activeScreen: "live", scrollTop: 1000 },
  { screenName: "全域诊断", activeScreen: "diagnosis", scrollTop: 2000 },
] as const)("switches scenes from $activeScreen without leaving or scrolling the active screen", ({ screenName, activeScreen, scrollTop }) => {
  const { container } = render(createElement(CockpitExperience, cockpitProps()));
  const root = container.querySelector<HTMLElement>(".cockpit-experience")!;
  const entry = screen.getByRole("region", { name: "场景入口" });
  const live = screen.getByRole("region", { name: "实时解析" });
  const diagnosis = screen.getByRole("region", { name: "全域诊断" });
  const activeIndex = activeScreen === "live" ? 1 : 2;
  Object.defineProperty(root, "scrollTop", { configurable: true, value: scrollTop, writable: true });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  [entry, live, diagnosis].forEach((region, index) => {
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
      top: (index - activeIndex) * 1000,
      height: 1000,
    } as DOMRect);
  });
  fireEvent.scroll(root);
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");

  fireEvent.change(screen.getByRole("combobox", { name: "选择数据场景" }), {
    target: { value: "scene-0061" },
  });

  expect(onSceneSelect).toHaveBeenCalledWith("scene-0061");
  expect(root).toHaveAttribute("data-active-screen", activeScreen);
  expect(root.scrollTop).toBe(scrollTop);
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: screenName })).toBeInTheDocument();
});

it("scrolls to each completed report once and returns to evidence after a time seek", () => {
  const onSeekReportEvidence = vi.fn();
  const { container, rerender } = render(createElement(CockpitExperience, cockpitProps({ onSeekReportEvidence })));
  const reportAnchor = container.querySelector<HTMLElement>(".cockpit-diagnosis__report-anchor")!;
  const evidenceAnchor = container.querySelector<HTMLElement>(".cockpit-diagnosis .cockpit-screen__heading")!;
  const reportScroll = vi.spyOn(reportAnchor, "scrollIntoView");
  const evidenceScroll = vi.spyOn(evidenceAnchor, "scrollIntoView");

  rerender(createElement(CockpitExperience, cockpitProps({
    report: completedReport,
    reportExpanded: true,
    onSeekReportEvidence,
  })));
  expect(reportScroll).toHaveBeenCalledTimes(1);

  rerender(createElement(CockpitExperience, cockpitProps({
    report: completedReport,
    reportExpanded: true,
    onSeekReportEvidence,
  })));
  expect(reportScroll).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "12.48 秒" }));
  expect(onSeekReportEvidence).toHaveBeenCalledWith(12.48);
  expect(evidenceScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
});

it("keeps scene selection usable and the video node stable after a media error", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const view = render(createElement(CockpitExperience, cockpitProps()));
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;

  fireEvent.error(video);
  expect(screen.getByRole("alert")).toHaveTextContent("场景视频加载失败");
  fireEvent.click(screen.getByRole("button", { name: "工区左转跟车" }));
  expect(onSceneSelect).toHaveBeenCalledWith("scene-0061");

  view.rerender(createElement(CockpitExperience, cockpitProps({
    selectedSceneKey: "scene-0061",
    sceneVideoSrc: "/scenes/scene-0061/sample.mp4",
  })));
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    value: new URL("/scenes/scene-0061/sample.mp4", window.location.href).href,
  });
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: HTMLMediaElement.HAVE_FUTURE_DATA,
  });
  fireEvent.canPlay(video);

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByTestId("persistent-scene-video")).toBe(video);
  expect(document.querySelectorAll("video")).toHaveLength(1);
});
