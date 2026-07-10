/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LidarBev } from "./LidarBev";

afterEach(cleanup);

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
});
