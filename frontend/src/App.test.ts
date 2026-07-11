/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { loadOptionalLidarIndex, resolveLidarSource, resolveReplayTime } from "./App";

vi.mock("./SoftAurora", () => ({ default: () => createElement("div", { "data-testid": "soft-aurora" }) }));

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
});

it("mounts exactly one global aurora background", () => {
  render(createElement(App));
  expect(screen.getAllByTestId("soft-aurora")).toHaveLength(1);
});

describe("cockpit replay integration", () => {
  it("clears the current lidar index when the selected scene has no lidarIndexFile", () => {
    expect(resolveLidarSource({})).toBeNull();
  });

  it("uses the same event peak time for video seeking and lidar lookup", () => {
    expect(resolveReplayTime({ seekTime: 12.5 })).toBe(12.5);
  });

  it("contains a rejected optional LiDAR index load", async () => {
    const result = await loadOptionalLidarIndex(
      "/scenes/default/lidar/index.json",
      undefined,
      async () => Promise.reject(new Error("index HTTP 500")),
    );

    expect(result).toEqual({ index: null, errorMessage: "index HTTP 500" });
  });
});
