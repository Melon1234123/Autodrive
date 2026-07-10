/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LidarBev } from "./LidarBev";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: vi.fn(() => {
      throw new Error("WebGL unavailable");
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LidarBev", () => {
  it("shows a loading status while point cloud data is unavailable", () => {
    render(createElement(LidarBev, { pointCloud: null, frame: null, history: [], status: "loading" }));

    expect(screen.getByText("LiDAR 点云加载中")).toBeInTheDocument();
    expect(screen.queryByText("横向 / m")).not.toBeInTheDocument();
    expect(screen.queryByText("前向 / m")).not.toBeInTheDocument();
  });

  it("shows an explicit unavailable state without fabricated points", () => {
    render(createElement(LidarBev, { pointCloud: null, frame: null, history: [], status: "unavailable" }));

    expect(screen.getByText("该场景未提供 LiDAR 点云")).toBeInTheDocument();
    expect(screen.queryByTestId("lidar-webgl-canvas")).not.toBeInTheDocument();
  });

  it("distinguishes a LiDAR loading failure from a camera-only scene", () => {
    render(createElement(LidarBev, {
      pointCloud: null,
      frame: null,
      history: [],
      status: "error",
      errorMessage: "index HTTP 500",
    }));

    expect(screen.getByText("LiDAR load failed: index HTTP 500")).toBeInTheDocument();
    expect(screen.queryByText("该场景未提供 LiDAR 点云")).not.toBeInTheDocument();
  });

  it("places fallback objects forward and left of the ego anchor when WebGL is unavailable", () => {
    render(createElement(LidarBev, {
      pointCloud: new Float32Array([0, 0, 0, 0]),
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
      history: [],
      status: "ready",
    }));

    const object = screen.getByText("Ahead left");
    const ego = screen.getByText("EGO");
    expect(parseFloat(object.style.top)).toBeGreaterThan(parseFloat(ego.style.top));
    expect(parseFloat(object.style.left)).toBeLessThan(50);
  });
});
