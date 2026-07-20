/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement, useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCockpitDestination } from "./cockpit-scroll-policy";
import { useCockpitScroll } from "./useCockpitScroll";
import type { CockpitScreen } from "./types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({
  onScreenChange = vi.fn(),
  withReport = false,
  activeScreen = "entry",
  pendingScreen = null,
  includeInvalidScreen = false,
}: {
  onScreenChange?: (screen: CockpitScreen) => void;
  withReport?: boolean;
  activeScreen?: CockpitScreen;
  pendingScreen?: CockpitScreen | null;
  includeInvalidScreen?: boolean;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const screenOrder: readonly CockpitScreen[] = withReport
    ? ["entry", "live", "diagnosis", "report"]
    : ["entry", "live", "diagnosis"];
  useCockpitScroll({ rootRef, onScreenChange, screenOrder, activeScreen, pendingScreen });

  return createElement("main", { ref: rootRef, "data-testid": "root" },
    createElement("section", { className: "cockpit-screen", "data-cockpit-screen": "entry" },
      createElement("input", { "aria-label": "scene search" }),
      createElement("button", { type: "button" }, "choose scene"),
      createElement("div", { "data-lenis-prevent": "" }, "native scroller"),
    ),
    includeInvalidScreen ? createElement("section", {
      className: "cockpit-screen",
      "data-cockpit-screen": "not-a-cockpit-screen",
      "data-testid": "invalid-screen",
    }) : null,
    includeInvalidScreen ? createElement("section", {
      className: "cockpit-screen",
      "data-testid": "missing-screen",
    }) : null,
    createElement("section", { className: "cockpit-screen", "data-cockpit-screen": "live" }),
    createElement("section", { className: "cockpit-screen", "data-cockpit-screen": "diagnosis" }),
    withReport ? createElement("section", { className: "cockpit-screen", "data-cockpit-screen": "report" },
      createElement("div", { "data-cockpit-scroll-surface": "", "data-testid": "report-scroll-surface" }),
    ) : null,
  );
}

function setOffsetTop(element: Element, offsetTop: number) {
  Object.defineProperty(element, "offsetTop", { configurable: true, value: offsetTop });
}

function installCockpitGeometry(container: HTMLElement) {
  const root = container.querySelector<HTMLElement>("[data-testid='root']")!;
  const entry = container.querySelector<HTMLElement>("[data-cockpit-screen='entry']")!;
  const live = container.querySelector<HTMLElement>("[data-cockpit-screen='live']")!;
  const diagnosis = container.querySelector<HTMLElement>("[data-cockpit-screen='diagnosis']")!;
  const report = container.querySelector<HTMLElement>("[data-cockpit-screen='report']");
  setOffsetTop(entry, 0);
  setOffsetTop(live, 1000);
  setOffsetTop(diagnosis, 2000);
  if (report) setOffsetTop(report, 3000);
  const scrolls = [entry, live, diagnosis, ...(report ? [report] : [])].map((screen) => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(screen, "scrollIntoView", { configurable: true, value: scrollIntoView });
    return scrollIntoView;
  });
  return { root, entry, live, diagnosis, report, scrolls };
}

describe("cockpit scroll policy", () => {
  it("moves only to adjacent cockpit screens", () => {
    const order = ["entry", "live", "diagnosis"] as const;
    expect(resolveCockpitDestination(order, "next", "entry")).toBe("live");
    expect(resolveCockpitDestination(order, "next", "live")).toBe("diagnosis");
    expect(resolveCockpitDestination(order, "previous", "diagnosis")).toBe("live");
  });

  it("stops at the first and last cockpit screens", () => {
    const order = ["entry", "live", "diagnosis"] as const;
    expect(resolveCockpitDestination(order, "previous", "entry")).toBeNull();
    expect(resolveCockpitDestination(order, "next", "diagnosis")).toBeNull();
  });

  it("does not navigate beyond diagnosis until a validated report exists", () => {
    expect(resolveCockpitDestination(["entry", "live", "diagnosis"], "next", "diagnosis")).toBeNull();
    expect(
      resolveCockpitDestination(["entry", "live", "diagnosis", "report"], "next", "diagnosis"),
    ).toBe("report");
  });
});

describe("useCockpitScroll", () => {
  beforeEach(() => vi.useFakeTimers());

  it("moves one adjacent screen per 120 millisecond wheel gesture", () => {
    const onScreenChange = vi.fn();
    const { container } = render(createElement(Harness, { onScreenChange }));
    const { root, scrolls } = installCockpitGeometry(container);

    fireEvent.wheel(root, { deltaY: 180, cancelable: true });
    fireEvent.wheel(root, { deltaY: 140, cancelable: true });
    expect(scrolls[1]).toHaveBeenCalledTimes(1);
    expect(scrolls[1]).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    root.scrollTop = 1000;
    fireEvent.scroll(root);
    act(() => vi.advanceTimersByTime(121));
    fireEvent.wheel(root, { deltaY: 180, cancelable: true });
    expect(scrolls[2]).toHaveBeenCalledTimes(1);
    expect(onScreenChange).toHaveBeenLastCalledWith("live");
  });

  it("uses instant motion for keyboard and wheel navigation when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const { container } = render(createElement(Harness));
    const { root, scrolls } = installCockpitGeometry(container);

    expect(fireEvent.keyDown(window, { key: "PageDown", cancelable: true })).toBe(false);
    expect(scrolls[1]).toHaveBeenCalledWith({ behavior: "auto", block: "start" });

    scrolls[1].mockClear();
    expect(fireEvent.wheel(root, { deltaY: 180, cancelable: true })).toBe(false);
    expect(scrolls[1]).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("keeps the wheel gesture locked after arriving at the diagnosis screen", () => {
    const { container } = render(createElement(Harness));
    const { root, scrolls } = installCockpitGeometry(container);
    root.scrollTop = 1000;
    fireEvent.scroll(root);

    expect(fireEvent.wheel(root, { deltaY: 180, cancelable: true })).toBe(false);
    expect(scrolls[2]).toHaveBeenCalledTimes(1);
    root.scrollTop = 2000;
    fireEvent.scroll(root);
    act(() => vi.advanceTimersByTime(100));

    const sameGestureDelta = new WheelEvent("wheel", { deltaY: 140, bubbles: true, cancelable: true });
    expect(root.dispatchEvent(sameGestureDelta)).toBe(false);
    expect(sameGestureDelta.defaultPrevented).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    const continuingGestureDelta = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    expect(root.dispatchEvent(continuingGestureDelta)).toBe(false);
    expect(continuingGestureDelta.defaultPrevented).toBe(true);
    expect(scrolls[2]).toHaveBeenCalledTimes(1);
  });

  it("announces the target only after smooth scrolling crosses to that screen", () => {
    const onScreenChange = vi.fn();
    const { container } = render(createElement(Harness, { onScreenChange }));
    const { root, scrolls } = installCockpitGeometry(container);
    root.scrollTop = 1000;
    fireEvent.scroll(root);
    expect(onScreenChange.mock.calls).toEqual([["live"]]);

    fireEvent.wheel(root, { deltaY: 180, cancelable: true });
    expect(scrolls[2]).toHaveBeenCalledTimes(1);
    expect(onScreenChange.mock.calls).toEqual([["live"]]);

    root.scrollTop = 1200;
    fireEvent.scroll(root);
    expect(onScreenChange.mock.calls).toEqual([["live"]]);

    root.scrollTop = 1600;
    fireEvent.scroll(root);
    expect(onScreenChange.mock.calls).toEqual([["live"], ["diagnosis"]]);
  });

  it("does not hijack wheel or keyboard events from controls", () => {
    const { container } = render(createElement(Harness));
    const { root, scrolls } = installCockpitGeometry(container);
    const input = container.querySelector("input")!;
    const button = container.querySelector("button")!;

    expect(fireEvent.wheel(input, { deltaY: 180, cancelable: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "PageDown", cancelable: true })).toBe(true);
    expect(fireEvent.keyDown(button, { key: " ", cancelable: true })).toBe(true);
    expect(scrolls.every((scroll) => scroll.mock.calls.length === 0)).toBe(true);

    expect(fireEvent.keyDown(window, { key: "PageDown", cancelable: true })).toBe(false);
    expect(scrolls[1]).toHaveBeenCalledTimes(1);
  });

  it("supports Home and End without hijacking controls or modified and repeated keys", () => {
    const onScreenChange = vi.fn();
    const { container } = render(createElement(Harness, { onScreenChange }));
    const { root, scrolls } = installCockpitGeometry(container);
    const input = container.querySelector("input")!;
    const button = container.querySelector("button")!;

    expect(fireEvent.keyDown(window, { key: "End", cancelable: true })).toBe(false);
    expect(scrolls[2]).toHaveBeenCalledTimes(1);
    expect(onScreenChange).not.toHaveBeenCalled();

    root.scrollTop = 2000;
    fireEvent.scroll(root);
    onScreenChange.mockClear();
    expect(fireEvent.keyDown(window, { key: "Home", cancelable: true })).toBe(false);
    expect(scrolls[0]).toHaveBeenCalledTimes(1);
    expect(onScreenChange).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(input, { key: "Home", cancelable: true })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "End", cancelable: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "Home", ctrlKey: true, cancelable: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "End", repeat: true, cancelable: true })).toBe(true);
    expect(scrolls[0]).toHaveBeenCalledTimes(1);
    expect(scrolls[2]).toHaveBeenCalledTimes(1);
  });

  it("returns from diagnosis to live on an upward root gesture", () => {
    const { container } = render(createElement(Harness));
    const { root, scrolls } = installCockpitGeometry(container);
    root.scrollTop = 2000;
    fireEvent.scroll(root);

    expect(fireEvent.wheel(root, { deltaY: -180, cancelable: true })).toBe(false);
    expect(scrolls[1]).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("keeps a report workspace wheel gesture in the panel until it reaches an edge", () => {
    const { container } = render(createElement(Harness, { withReport: true }));
    const { root, scrolls } = installCockpitGeometry(container);
    const report = container.querySelector<HTMLElement>("[data-cockpit-screen='report']")!;
    const surface = container.querySelector<HTMLElement>("[data-testid='report-scroll-surface']")!;
    Object.defineProperties(surface, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 50, writable: true },
    });
    root.scrollTop = 3000;
    fireEvent.scroll(root);

    expect(fireEvent.wheel(surface, { deltaY: 80, cancelable: true })).toBe(true);
    expect(scrolls[2]).not.toHaveBeenCalled();

    surface.scrollTop = 0;
    expect(fireEvent.wheel(surface, { deltaY: -80, cancelable: true })).toBe(false);
    expect(scrolls[2]).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(report).toBeInTheDocument();
  });

  it("resolves input from the requested report target while auto-scroll is still at entry", () => {
    const { container } = render(createElement(Harness, {
      withReport: true,
      activeScreen: "report",
      pendingScreen: "report",
    }));
    const { root, scrolls } = installCockpitGeometry(container);
    root.scrollTop = 0;

    expect(fireEvent.wheel(root, { deltaY: 180, cancelable: true })).toBe(false);
    expect(scrolls.every((scroll) => scroll.mock.calls.length === 0)).toBe(true);
  });

  it("ignores missing and invalid cockpit screen declarations instead of assigning positions", () => {
    const { container } = render(createElement(Harness, { includeInvalidScreen: true }));
    const root = container.querySelector<HTMLElement>("[data-testid='root']")!;
    const entry = container.querySelector<HTMLElement>("[data-cockpit-screen='entry']")!;
    const invalid = container.querySelector<HTMLElement>("[data-testid='invalid-screen']")!;
    const missing = container.querySelector<HTMLElement>("[data-testid='missing-screen']")!;
    const live = container.querySelector<HTMLElement>("[data-cockpit-screen='live']")!;
    const diagnosis = container.querySelector<HTMLElement>("[data-cockpit-screen='diagnosis']")!;
    [entry, invalid, missing, live, diagnosis].forEach((element, index) => setOffsetTop(element, index * 1000));
    const liveScroll = vi.fn();
    const missingScroll = vi.fn();
    const diagnosisScroll = vi.fn();
    Object.defineProperty(missing, "scrollIntoView", { configurable: true, value: missingScroll });
    Object.defineProperty(live, "scrollIntoView", { configurable: true, value: liveScroll });
    Object.defineProperty(diagnosis, "scrollIntoView", { configurable: true, value: diagnosisScroll });
    root.scrollTop = 1000;

    expect(fireEvent.wheel(root, { deltaY: 180, cancelable: true })).toBe(false);
    expect(liveScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(missingScroll).not.toHaveBeenCalled();
    expect(diagnosisScroll).not.toHaveBeenCalled();
  });

  it("ignores modified, non-cancelable, and Lenis-prevent wheel input", () => {
    const { container } = render(createElement(Harness));
    const { root, scrolls } = installCockpitGeometry(container);
    const lenisPrevent = container.querySelector<HTMLElement>("[data-lenis-prevent]")!;

    expect(fireEvent.wheel(root, { deltaY: 180, ctrlKey: true, cancelable: true })).toBe(true);
    expect(fireEvent.wheel(root, { deltaY: 180, cancelable: false })).toBe(true);
    expect(fireEvent.wheel(lenisPrevent, { deltaY: 180, cancelable: true })).toBe(true);
    expect(scrolls.every((scroll) => scroll.mock.calls.length === 0)).toBe(true);
  });
});
