// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CockpitExperience, type CockpitExperienceProps } from "./CockpitExperience";
import { reportFixture } from "../features/diagnosis/test-fixtures";

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

const completedReportV2 = reportFixture;

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
    selectedEvidenceTime: null,
    onSeekReportEvidence: vi.fn(),
    onReturnToDiagnosis: vi.fn(),
    onRerunDiagnosis: vi.fn(),
    onSceneSelect,
    onReturnSite: vi.fn(),
    onContact: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
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
  expect(container.querySelectorAll(".cockpit-experience [data-split-text]")).toHaveLength(0);
  expect(container.querySelectorAll(".cockpit-experience [data-line-reveal]")).toHaveLength(3);
  expect(container.querySelectorAll(".cockpit-experience [data-motion-line]")).toHaveLength(4);
  expect(container.querySelectorAll(".cockpit-experience [data-text-reveal]")).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "选择一段真实路况，开始证据回放" })).not.toHaveAttribute("data-split-text");
  expect(screen.getByRole("heading", { name: "多模态证据，逐帧同步" })).not.toHaveAttribute("data-split-text");
  expect(screen.getByRole("heading", { name: "从关键帧，追溯完整因果链" })).not.toHaveAttribute("data-split-text");
  expect(screen.getByRole("button", { name: "返回官网" })).toHaveClass("cockpit-nav__return");
  expect(screen.getByRole("button", { name: "联系我们" })).toHaveClass("cockpit-nav__contact");
  expect(document.querySelectorAll("video")).toHaveLength(3);
  const liveEvidencePanels = container.querySelectorAll(
    ".cockpit-live .cockpit-evidence-panel",
  );
  expect(liveEvidencePanels).toHaveLength(0);
  expect(container.querySelectorAll("[data-testid='persistent-lidar-panel'], [data-testid='persistent-map-panel']")).toHaveLength(2);
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

it("embeds three synchronized videos and moves one evidence layer without remounting it", () => {
  const { container } = render(createElement(CockpitExperience, cockpitProps()));
  const entryVideo = screen.getByTestId("cockpit-scene-video-entry") as HTMLVideoElement;
  const liveVideo = screen.getByTestId("cockpit-scene-video-live") as HTMLVideoElement;
  const diagnosisVideo = screen.getByTestId("cockpit-scene-video-diagnosis") as HTMLVideoElement;
  expect(entryVideo).toBeInTheDocument();
  expect(liveVideo).toBeInTheDocument();
  expect(diagnosisVideo).toBeInTheDocument();
  const lidar = screen.getByTestId("lidar-slot");
  const map = screen.getByTestId("map-slot");
  expect(lidar.parentElement).toHaveClass("cockpit-evidence-panel");
  expect(lidar.closest(".cockpit-evidence-parking")).toBeInTheDocument();

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

  expect(screen.getByTestId("cockpit-scene-video-live")).toBe(liveVideo);
  expect(container.querySelector(".cockpit-live .persistent-player")).toBeInTheDocument();
  expect(container.querySelector(".cockpit-live .persistent-player")?.classList).not.toContain("persistent-player--fixed");
  expect(screen.getAllByTestId("lidar-slot")).toHaveLength(1);
  expect(screen.getAllByTestId("map-slot")).toHaveLength(1);
  expect(screen.getByTestId("lidar-slot")).toBe(lidar);
  expect(screen.getByTestId("map-slot")).toBe(map);
  expect(lidar.closest(".cockpit-live__evidence")).toBeInTheDocument();

  Object.defineProperty(root, "scrollTop", { configurable: true, value: 2000, writable: true });
  vi.mocked(entry.getBoundingClientRect).mockReturnValue({ top: -2000, height: 1000 } as DOMRect);
  vi.mocked(live.getBoundingClientRect).mockReturnValue({ top: -1000, height: 1000 } as DOMRect);
  vi.mocked(diagnosis.getBoundingClientRect).mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  fireEvent.scroll(root);

  expect(screen.getByTestId("lidar-slot")).toBe(lidar);
  expect(screen.getByTestId("map-slot")).toBe(map);
  expect(lidar.closest(".cockpit-diagnosis__evidence")).toBeInTheDocument();
});

it("prepares incoming 02 and 03 content before the scroll transition reaches them", () => {
  const { container } = render(createElement(CockpitExperience, cockpitProps()));
  const root = container.querySelector<HTMLElement>(".cockpit-experience")!;
  const entry = screen.getByRole("region", { name: "场景入口" });
  const live = screen.getByRole("region", { name: "实时解析" });
  const diagnosis = screen.getByRole("region", { name: "全域诊断" });
  Object.defineProperty(root, "scrollTop", { configurable: true, value: 0, writable: true });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  vi.spyOn(entry, "getBoundingClientRect").mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  vi.spyOn(live, "getBoundingClientRect").mockReturnValue({ top: 1000, height: 1000 } as DOMRect);
  vi.spyOn(diagnosis, "getBoundingClientRect").mockReturnValue({ top: 2000, height: 1000 } as DOMRect);

  fireEvent.keyDown(window, { key: "PageDown", cancelable: true });

  expect(root).toHaveAttribute("data-active-screen", "entry");
  expect(live.querySelector("[data-testid='persistent-cockpit-evidence']")).toBeInTheDocument();

  root.scrollTop = 1000;
  vi.mocked(entry.getBoundingClientRect).mockReturnValue({ top: -1000, height: 1000 } as DOMRect);
  vi.mocked(live.getBoundingClientRect).mockReturnValue({ top: 0, height: 1000 } as DOMRect);
  vi.mocked(diagnosis.getBoundingClientRect).mockReturnValue({ top: 1000, height: 1000 } as DOMRect);
  fireEvent.scroll(root);
  fireEvent.keyDown(window, { key: "PageDown", cancelable: true });

  expect(root).toHaveAttribute("data-active-screen", "live");
  expect(diagnosis.querySelector("[data-testid='persistent-cockpit-evidence']")).toBeInTheDocument();
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

  if (activeScreen === "live") {
    expect(live.querySelector(".cockpit-monitor .cockpit-scene-select")).toBeInTheDocument();
    expect(live.querySelector(".cockpit-screen__heading .cockpit-scene-select")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "选择数据场景" }), {
      target: { value: "scene-0061" },
    });
    expect(onSceneSelect).toHaveBeenCalledWith("scene-0061");
  } else {
    expect(diagnosis.querySelector(".cockpit-scene-select")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "选择数据场景" })).not.toBeInTheDocument();
    expect(diagnosis.querySelector(".cockpit-diagnosis__buttons")).not.toBeInTheDocument();
    expect(diagnosis.querySelector(".cockpit-diagnosis__action .panel-title svg")).not.toBeInTheDocument();
  }

  expect(root).toHaveAttribute("data-active-screen", activeScreen);
  expect(root.scrollTop).toBe(scrollTop);
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: screenName })).toBeInTheDocument();
});

it("mounts report once and scrolls once after completion", () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const { container, rerender } = render(createElement(CockpitExperience, cockpitProps()));

  rerender(createElement(CockpitExperience, cockpitProps({ report: completedReportV2 })));
  expect(screen.getByRole("region", { name: "诊断报告" })).toBeInTheDocument();
  expect(container.querySelector(".cockpit-diagnosis__report-drawer")).not.toBeInTheDocument();
  expect(container.querySelector(".cockpit-screen[data-cockpit-screen='report']")).toBeInTheDocument();
  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "report");
  expect(scroll).toHaveBeenCalledTimes(1);

  rerender(createElement(CockpitExperience, cockpitProps({ report: completedReportV2 })));
  expect(scroll).toHaveBeenCalledTimes(1);
});

it("returns from report without resetting scene playback or persistent evidence", () => {
  const onReturnToDiagnosis = vi.fn();
  const onSeekReportEvidence = vi.fn();
  const { container } = render(createElement(CockpitExperience, cockpitProps({
    report: completedReportV2,
    selectedEvidenceTime: 1,
    onReturnToDiagnosis,
    onSeekReportEvidence,
  })));
  const entryVideo = screen.getByTestId("cockpit-scene-video-entry") as HTMLVideoElement;
  const liveVideo = screen.getByTestId("cockpit-scene-video-live") as HTMLVideoElement;
  const diagnosisVideo = screen.getByTestId("cockpit-scene-video-diagnosis") as HTMLVideoElement;
  const reportVideo = screen.getByTestId("cockpit-scene-video-report") as HTMLVideoElement;
  const lidar = screen.getByTestId("lidar-slot");
  const map = screen.getByTestId("map-slot");
  Object.defineProperty(diagnosisVideo, "readyState", {
    configurable: true,
    value: HTMLMediaElement.HAVE_METADATA,
  });
  reportVideo.currentTime = 1;
  fireEvent.timeUpdate(reportVideo);
  diagnosisVideo.currentTime = 1;

  fireEvent.click(screen.getByRole("button", { name: "返回 03" }));

  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");
  expect(onSeekReportEvidence).toHaveBeenCalledWith(1);
  expect(onReturnToDiagnosis).toHaveBeenCalledWith(1);
  expect(screen.getByTestId("cockpit-scene-video-entry")).toBe(entryVideo);
  expect(screen.getByTestId("cockpit-scene-video-live")).toBe(liveVideo);
  expect(screen.getByTestId("cockpit-scene-video-diagnosis")).toBe(diagnosisVideo);
  expect(screen.getByTestId("lidar-slot")).toBe(lidar);
  expect(screen.getByTestId("map-slot")).toBe(map);
  expect(diagnosisVideo.currentTime).toBe(1);
});

it("keeps report evidence seeks in screen 04 and seeks diagnosis once on return", () => {
  const onSeekReportEvidence = vi.fn();
  const { container } = render(createElement(CockpitExperience, cockpitProps({
    report: completedReportV2,
    onSeekReportEvidence,
  })));
  const reportVideo = screen.getByTestId("cockpit-scene-video-report") as HTMLVideoElement;
  const diagnosisVideo = screen.getByTestId("cockpit-scene-video-diagnosis") as HTMLVideoElement;
  Object.defineProperty(reportVideo, "readyState", {
    configurable: true,
    value: HTMLMediaElement.HAVE_METADATA,
  });
  Object.defineProperty(diagnosisVideo, "readyState", {
    configurable: true,
    value: HTMLMediaElement.HAVE_METADATA,
  });
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  scroll.mockClear();

  fireEvent.click(screen.getByRole("button", { name: "回放 1.00 秒证据" }));

  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "report");
  expect(onSeekReportEvidence).toHaveBeenCalledWith(1);
  expect(reportVideo.currentTime).toBe(1);
  expect(scroll).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "返回 03" }));

  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");
  expect(diagnosisVideo.currentTime).toBe(1);
  expect(scroll).toHaveBeenCalledTimes(1);
});

it("uses instant motion when reduced-motion users return from report to diagnosis", () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const { container } = render(createElement(CockpitExperience, cockpitProps({ report: completedReportV2 })));
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  scroll.mockClear();

  fireEvent.click(screen.getByRole("button", { name: "返回 03" }));

  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
});

it("returns to diagnosis before rerunning and resets report auto-scroll tracking when the report clears", () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  let activeScreenDuringRerun: string | null = null;
  const { container, rerender } = render(createElement(CockpitExperience, cockpitProps({
    report: completedReportV2,
    onRerunDiagnosis: () => {
      activeScreenDuringRerun = container.querySelector(".cockpit-experience")?.getAttribute("data-active-screen") ?? null;
    },
  })));
  expect(scroll).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "重新诊断" }));

  expect(activeScreenDuringRerun).toBe("diagnosis");
  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");

  rerender(createElement(CockpitExperience, cockpitProps({ report: null })));
  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "diagnosis");

  rerender(createElement(CockpitExperience, cockpitProps({ report: completedReportV2 })));
  expect(container.querySelector(".cockpit-experience")).toHaveAttribute("data-active-screen", "report");
  expect(scroll).toHaveBeenCalledTimes(3);
});

it("keeps scene selection usable and the video node stable after a media error", () => {
  const view = render(createElement(CockpitExperience, cockpitProps()));
  const video = screen.getByTestId("cockpit-scene-video-entry") as HTMLVideoElement;

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
  expect(screen.getByTestId("cockpit-scene-video-entry")).toBe(video);
  expect(document.querySelectorAll("video")).toHaveLength(3);
});
