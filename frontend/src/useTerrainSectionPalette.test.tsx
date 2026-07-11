/** @vitest-environment jsdom */
import { useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  TERRAIN_OBSERVER_THRESHOLDS,
  selectTerrainPreset,
  useTerrainSectionPalette,
} from "./useTerrainSectionPalette";
import type { ShowcaseTerrainPreset } from "./terrain-presets";

it("uses 21 observer thresholds from zero through one", () => {
  expect(TERRAIN_OBSERVER_THRESHOLDS).toHaveLength(21);
  expect(TERRAIN_OBSERVER_THRESHOLDS[0]).toBe(0);
  expect(TERRAIN_OBSERVER_THRESHOLDS[20]).toBe(1);
});

it("uses visible area, DOM order and the 8/15 percent hysteresis", () => {
  const rows = [
    { preset: "positioning" as ShowcaseTerrainPreset, area: 460, order: 0 },
    { preset: "pain" as ShowcaseTerrainPreset, area: 520, order: 1 },
  ];
  expect(selectTerrainPreset(rows, "positioning", 1000)).toBe("positioning");
  rows[1].area = 560;
  expect(selectTerrainPreset(rows, "positioning", 1000)).toBe("pain");
  rows[0].area = 100;
  rows[1].area = 120;
  expect(selectTerrainPreset(rows, "positioning", 1000)).toBe("pain");

  expect(selectTerrainPreset([
    { preset: "positioning", area: 500, order: 0 },
    { preset: "pain", area: 500, order: 1 },
  ], "hidden", 1000)).toBe("positioning");
});

it("observes terrain sections against the showcase root and disconnects", () => {
  const onChange = vi.fn();
  const disconnect = vi.fn();
  const observe = vi.fn();
  let options: IntersectionObserverInit | undefined;
  let callback: IntersectionObserverCallback | undefined;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(observerCallback: IntersectionObserverCallback, observerOptions?: IntersectionObserverInit) {
      callback = observerCallback;
      options = observerOptions;
    }
    observe = observe;
    disconnect = disconnect;
    unobserve() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = "0px";
    thresholds = [];
  });

  function Harness() {
    const ref = useRef<HTMLElement | null>(null);
    useTerrainSectionPalette(ref, onChange);
    return <main ref={ref}><section data-terrain-preset="hidden" /><section data-terrain-preset="positioning" /></main>;
  }

  const view = render(<Harness />);
  expect(onChange).toHaveBeenCalledWith("hidden");
  expect(options?.root).toBe(view.container.querySelector("main"));
  expect(options?.threshold).toEqual(TERRAIN_OBSERVER_THRESHOLDS);
  expect(observe).toHaveBeenCalledTimes(2);
  const sections = view.container.querySelectorAll("section");
  callback?.([
    { target: sections[0], intersectionRect: { width: 10, height: 10 } },
    { target: sections[1], intersectionRect: { width: 20, height: 20 } },
  ] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
  expect(onChange).toHaveBeenLastCalledWith("positioning");
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it("falls back to positioning when IntersectionObserver is unavailable", () => {
  const onChange = vi.fn();
  vi.stubGlobal("IntersectionObserver", undefined);
  function Harness() {
    const ref = useRef<HTMLElement | null>(null);
    useTerrainSectionPalette(ref, onChange);
    return <main ref={ref}><section data-terrain-preset="hidden" /><section data-terrain-preset="positioning" /></main>;
  }
  render(<Harness />);
  expect(onChange).toHaveBeenNthCalledWith(1, "hidden");
  expect(onChange).toHaveBeenLastCalledWith("positioning");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
