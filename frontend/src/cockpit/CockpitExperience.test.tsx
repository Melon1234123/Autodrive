// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CockpitExperience, type CockpitExperienceProps } from "./CockpitExperience";

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
    reportExpanded: false,
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
  render(createElement(CockpitExperience, cockpitProps()));

  expect(screen.getByRole("region", { name: "场景入口" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "实时解析" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "全域诊断" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回官网" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "联系我们" })).toBeInTheDocument();
  expect(document.querySelectorAll("video")).toHaveLength(1);
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
