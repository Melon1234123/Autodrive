/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement, StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferGeometry, Group, Material, Points, WebGLRenderer } from "three";
import {
  lidarPointToWorldGround,
  lidarScreenTopPercent,
  lidarToWorldGround,
  lidarYawToWorldRotation,
  LidarBev,
  normalizeLidarIntensity,
  type LidarBevProps,
} from "./LidarBev";

const threeHarness = vi.hoisted(() => ({
  shouldThrow: false,
  renderer: {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: vi.fn(() => {
      if (threeHarness.shouldThrow) throw new Error("WebGL unavailable");
      return threeHarness.renderer;
    }),
  };
});

class ResizeObserverDouble {
  static instances: ResizeObserverDouble[] = [];

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverDouble.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const baseProps: LidarBevProps = {
  sceneId: "scene-a",
  pointCloud: new Float32Array([1, 2, 0.5, 0.8]),
  frame: null,
  history: [],
  status: "ready",
};

beforeEach(() => {
  threeHarness.shouldThrow = false;
  ResizeObserverDouble.instances = [];
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverDouble);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LidarBev", () => {
  it("marks the rendered shell with its active scene id", () => {
    render(createElement(LidarBev, baseProps));

    expect(document.querySelector(".lidar-bev-shell")).toHaveAttribute("data-scene-id", "scene-a");
  });

  it("keeps detection overlays unrotated while rotating raw points clockwise", () => {
    expect(lidarToWorldGround(10, 4, 0, 0)).toEqual({ x: 4, z: 10 });
    expect(lidarPointToWorldGround(10, 4, 0, 0)).toEqual({ x: -10, z: 4 });
  });

  it("applies history pose before rotating history point clouds clockwise", () => {
    const objectGround = lidarToWorldGround(10, 4, 2, -1, Math.PI / 2);
    const pointGround = lidarPointToWorldGround(10, 4, 2, -1, Math.PI / 2);

    expect(objectGround.x).toBeCloseTo(9);
    expect(objectGround.z).toBeCloseTo(-2);
    expect(pointGround.x).toBeCloseTo(2);
    expect(pointGround.z).toBeCloseTo(9);
  });

  it("maps positive LiDAR yaw to positive Three.js Y rotation", () => {
    expect(lidarYawToWorldRotation(Math.PI / 3)).toBeCloseTo(Math.PI / 3);
  });

  it("normalizes raw nuScenes intensity bytes for the point shader", () => {
    expect(normalizeLidarIntensity(0)).toBe(0);
    expect(normalizeLidarIntensity(127.5)).toBeCloseTo(0.5);
    expect(normalizeLidarIntensity(255)).toBe(1);
  });

  it("frames the ego car near the center and slightly below it", () => {
    expect(lidarScreenTopPercent(0)).toBeCloseTo(59.5, 1);
  });

  it("keeps one renderer while replacing dynamic LiDAR data", () => {
    const view = render(createElement(LidarBev, baseProps));
    const canvas = screen.getByTestId("lidar-webgl-canvas");
    const [scene, camera] = threeHarness.renderer.render.mock.calls[0];

    view.rerender(createElement(LidarBev, {
      ...baseProps,
      pointCloud: new Float32Array([8, 3, 1.4, 0.4]),
      frame: { time: 0.5, objects: [] },
    }));

    expect(WebGLRenderer).toHaveBeenCalledTimes(1);
    expect(threeHarness.renderer.render).toHaveBeenCalledTimes(2);
    expect(threeHarness.renderer.render).toHaveBeenLastCalledWith(scene, camera);
    expect(screen.getByTestId("lidar-webgl-canvas")).toBe(canvas);
    expect(ResizeObserverDouble.instances).toHaveLength(1);
    expect(ResizeObserverDouble.instances[0].observe).toHaveBeenCalledTimes(1);
    expect(ResizeObserverDouble.instances[0].disconnect).not.toHaveBeenCalled();
    expect(threeHarness.renderer.dispose).not.toHaveBeenCalled();
  });

  it("keeps the decoded point cloud layer when only perception boxes advance", () => {
    const view = render(createElement(LidarBev, baseProps));
    const [scene] = threeHarness.renderer.render.mock.calls[0];
    const cloudLayer = scene.children[1] as Group;
    const pointCloud = cloudLayer.children.find((child) => child instanceof Points);

    view.rerender(createElement(LidarBev, {
      ...baseProps,
      frame: { time: 0.5, objects: [] },
    }));

    expect(cloudLayer.children.find((child) => child instanceof Points)).toBe(pointCloud);
    expect(threeHarness.renderer.dispose).not.toHaveBeenCalled();
  });

  it("clears the old scene dynamic layer before paint without reconstructing the renderer", () => {
    const view = render(createElement(LidarBev, baseProps));
    const [scene, camera] = threeHarness.renderer.render.mock.calls[0];
    const dynamicGroup = scene.children[1] as Group;
    expect(dynamicGroup.children.some((child) => child instanceof Points)).toBe(true);
    const clear = vi.spyOn(dynamicGroup, "clear");

    view.rerender(createElement(LidarBev, {
      ...baseProps,
      sceneId: "scene-b",
      pointCloud: null,
      frame: null,
      history: [],
      status: "loading",
    }));

    expect(clear).toHaveBeenCalled();
    expect(dynamicGroup.children.some((child) => child instanceof Points)).toBe(false);
    expect(WebGLRenderer).toHaveBeenCalledTimes(1);
    expect(threeHarness.renderer.render).toHaveBeenLastCalledWith(scene, camera);
    expect(threeHarness.renderer.dispose).not.toHaveBeenCalled();
  });

  it("disposes replaced dynamic geometry and materials without disposing the runtime", () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(Material.prototype, "dispose");
    try {
      const view = render(createElement(LidarBev, baseProps));
      expect(geometryDispose).not.toHaveBeenCalled();
      expect(materialDispose).not.toHaveBeenCalled();

      view.rerender(createElement(LidarBev, {
        ...baseProps,
        pointCloud: new Float32Array([6, -2, 0.2, 192]),
      }));

      expect(geometryDispose).toHaveBeenCalled();
      expect(materialDispose).toHaveBeenCalled();
      expect(threeHarness.renderer.dispose).not.toHaveBeenCalled();
      expect(ResizeObserverDouble.instances[0].disconnect).not.toHaveBeenCalled();
    } finally {
      geometryDispose.mockRestore();
      materialDispose.mockRestore();
    }
  });

  it("renders the persistent scene when its one observer reports a resize", () => {
    render(createElement(LidarBev, baseProps));

    ResizeObserverDouble.instances[0].trigger();

    expect(WebGLRenderer).toHaveBeenCalledTimes(1);
    expect(ResizeObserverDouble.instances).toHaveLength(1);
    expect(threeHarness.renderer.render).toHaveBeenCalledTimes(2);
  });

  it("disposes the persistent renderer and observer on unmount", () => {
    const view = render(createElement(LidarBev, baseProps));
    const observer = ResizeObserverDouble.instances[0];

    view.unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(threeHarness.renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("shows a loading status over the persistent canvas while point cloud data is unavailable", () => {
    render(createElement(LidarBev, { ...baseProps, pointCloud: null, status: "loading" }));

    expect(screen.getByText("LiDAR 点云加载中")).toBeInTheDocument();
    expect(screen.getByTestId("lidar-webgl-canvas")).toBeInTheDocument();
    expect(screen.queryByText("横向 / m")).not.toBeInTheDocument();
    expect(screen.queryByText("前向 / m")).not.toBeInTheDocument();
  });

  it("shows an explicit unavailable state without fabricated points", () => {
    render(createElement(LidarBev, { ...baseProps, pointCloud: null, status: "unavailable" }));

    expect(screen.getByText("该场景未提供 LiDAR 点云")).toBeInTheDocument();
    expect(screen.getByTestId("lidar-webgl-canvas")).toBeInTheDocument();
  });

  it("distinguishes a LiDAR loading failure from a camera-only scene", () => {
    render(createElement(LidarBev, {
      ...baseProps,
      pointCloud: null,
      status: "error",
      errorMessage: "index HTTP 500",
    }));

    expect(screen.getByText("LiDAR load failed: index HTTP 500")).toBeInTheDocument();
    expect(screen.queryByText("该场景未提供 LiDAR 点云")).not.toBeInTheDocument();
  });

  it("keeps the last successful cloud visible under a later error warning", () => {
    render(createElement(LidarBev, {
      ...baseProps,
      status: "error",
      errorMessage: "frame HTTP 500",
    }));

    expect(screen.getByTestId("lidar-webgl-canvas")).toBeInTheDocument();
    expect(screen.getByText("LiDAR load failed: frame HTTP 500")).toHaveClass("lidar-bev-warning");
    expect(screen.queryByText("LiDAR load failed: frame HTTP 500")).not.toHaveClass("lidar-bev-state");
  });

  it("uses the basic fallback only after flag-driven WebGL initialization failure", () => {
    threeHarness.shouldThrow = true;

    render(createElement(LidarBev, {
      ...baseProps,
      frame: {
        time: 0,
        objects: [{
          id: "ahead-left",
          label: "Ahead left",
          category: "vehicle",
          x: 10,
          y: 4,
          z: 0,
          width: 2,
          length: 4,
          height: 1.5,
          yaw: 0,
          risk: "low",
        }],
      },
    }));

    const object = screen.getByText("Ahead left");
    const ego = screen.getByText("EGO");
    expect(parseFloat(object.style.top)).toBeLessThan(parseFloat(ego.style.top));
    expect(parseFloat(object.style.left)).toBeLessThan(50);
    expect(screen.getByRole("img", { name: "基础检测框鸟瞰图" })).toBeInTheDocument();
  });

  it("retries WebGL once when the scene changes after initialization failure", async () => {
    threeHarness.shouldThrow = true;
    const view = render(createElement(LidarBev, baseProps));
    expect(screen.getByRole("img", { name: "基础检测框鸟瞰图" })).toBeInTheDocument();

    threeHarness.shouldThrow = false;
    view.rerender(createElement(LidarBev, {
      ...baseProps,
      pointCloud: new Float32Array([2, 0, 0, 1]),
    }));
    expect(WebGLRenderer).toHaveBeenCalledTimes(1);

    view.rerender(createElement(LidarBev, { ...baseProps, sceneId: "scene-b" }));

    await waitFor(() => expect(WebGLRenderer).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("img", { name: "基础检测框鸟瞰图" })).not.toBeInTheDocument();

    view.rerender(createElement(LidarBev, { ...baseProps, sceneId: "scene-c" }));
    expect(WebGLRenderer).toHaveBeenCalledTimes(2);
  });

  it("attempts one failed initialization per scene during StrictMode effect replay", async () => {
    threeHarness.shouldThrow = true;
    const view = render(createElement(
      StrictMode,
      null,
      createElement(LidarBev, baseProps),
    ));

    expect(WebGLRenderer).toHaveBeenCalledTimes(1);

    threeHarness.shouldThrow = false;
    view.rerender(createElement(
      StrictMode,
      null,
      createElement(LidarBev, { ...baseProps, pointCloud: new Float32Array([2, 0, 0, 1]) }),
    ));
    expect(WebGLRenderer).toHaveBeenCalledTimes(1);

    view.rerender(createElement(
      StrictMode,
      null,
      createElement(LidarBev, { ...baseProps, sceneId: "scene-b" }),
    ));

    await waitFor(() => expect(WebGLRenderer).toHaveBeenCalledTimes(2));
    expect(ResizeObserverDouble.instances).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "基础检测框鸟瞰图" })).not.toBeInTheDocument();
  });
});
