/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LidarBev } from "./LidarBev";

describe("LidarBev", () => {
  it("shows a loading status while point cloud data is unavailable", () => {
    render(createElement(LidarBev, { pointCloud: null, frame: null, history: [], status: "loading" }));

    expect(screen.getByText("LiDAR 点云加载中")).toBeInTheDocument();
  });

  it("shows an explicit unavailable state without fabricated points", () => {
    render(createElement(LidarBev, { pointCloud: null, frame: null, history: [], status: "unavailable" }));

    expect(screen.getByText("该场景未提供 LiDAR 点云")).toBeInTheDocument();
    expect(screen.queryByTestId("lidar-webgl-canvas")).not.toBeInTheDocument();
  });
});
