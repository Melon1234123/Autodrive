/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const motionCalls = vi.hoisted(() => [] as Array<{ playOpening: boolean; onOpeningComplete: () => void }>);
vi.mock("./useShowcaseMotion", () => ({
  useShowcaseMotion: (options: { playOpening: boolean; onOpeningComplete: () => void }) => motionCalls.push(options),
}));
vi.mock("./TerrainBackdrop", () => ({ default: () => <div data-testid="terrain" /> }));

import App from "./App";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

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

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

afterEach(() => {
  cleanup();
  motionCalls.length = 0;
  vi.restoreAllMocks();
});

it("does not replay an interrupted opening after returning from the cockpit in the same App lifetime", () => {
  const first = render(<App />);
  expect(motionCalls.at(-1)?.playOpening).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "进入效果展示" }));
  fireEvent.click(screen.getByRole("button", { name: "项目官网" }));
  expect(motionCalls.at(-1)?.playOpening).toBe(false);
  first.unmount();
  render(<App />);
  expect(motionCalls.at(-1)?.playOpening).toBe(true);
});
