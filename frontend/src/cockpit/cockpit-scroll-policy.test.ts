/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement, useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCockpitDestination } from "./cockpit-scroll-policy";
import { useCockpitScroll } from "./useCockpitScroll";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({
  reportExpanded = false,
  onScreenChange = vi.fn(),
}: {
  reportExpanded?: boolean;
  onScreenChange?: (screen: "entry" | "live" | "diagnosis") => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  useCockpitScroll({ rootRef, reportRef, reportExpanded, onScreenChange });

  return createElement("main", { ref: rootRef, "data-testid": "root" },
    createElement("section", { className: "cockpit-screen", "data-cockpit-screen": "entry" },
      createElement("input", { "aria-label": "scene search" }),
      createElement("button", { type: "button" }, "choose scene"),
      createElement("div", { "data-lenis-prevent": "" }, "native scroller"),
    ),
    createElement("section", { className: "cockpit-screen", "data-cockpit-screen": "live" }),
    createElement("section", { className: "cockpit-screen", "data-cockpit-screen": "diagnosis" },
      createElement("div", { ref: reportRef, "data-testid": "evidence-header" }),
    ),
  );
}

function setOffsetTop(element: Element, offsetTop: number) {
  Object.defineProperty(element, "offsetTop", { configurable: true, value: offsetTop });
}

function setRect(element: Element, top: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top,
      bottom: top + height,
      left: 0,
      right: 100,
      width: 100,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
  });
}

function installCockpitGeometry(container: HTMLElement) {
  const root = container.querySelector<HTMLElement>("[data-testid='root']")!;
  const entry = container.querySelector<HTMLElement>("[data-cockpit-screen='entry']")!;
  const live = container.querySelector<HTMLElement>("[data-cockpit-screen='live']")!;
  const diagnosis = container.querySelector<HTMLElement>("[data-cockpit-screen='diagnosis']")!;
  const evidenceHeader = container.querySelector<HTMLElement>("[data-testid='evidence-header']")!;
  setOffsetTop(entry, 0);
  setOffsetTop(live, 1000);
  setOffsetTop(diagnosis, 2000);
  setOffsetTop(evidenceHeader, 0);
  Object.defineProperty(evidenceHeader, "offsetParent", { configurable: true, value: diagnosis });
  const scrolls = [entry, live, diagnosis].map((screen) => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(screen, "scrollIntoView", { configurable: true, value: scrollIntoView });
    return scrollIntoView;
  });
  return { root, entry, live, diagnosis, evidenceHeader, scrolls };
}

describe("cockpit scroll policy", () => {
  it("moves only to adjacent screens before a report expands", () => {
    expect(resolveCockpitDestination("next", "entry", false, true)).toBe("live");
    expect(resolveCockpitDestination("next", "live", false, true)).toBe("diagnosis");
    expect(resolveCockpitDestination("previous", "diagnosis", false, true)).toBe("live");
  });

  it("stops at the first and last cockpit screens", () => {
    expect(resolveCockpitDestination("previous", "entry", false, true)).toBeNull();
    expect(resolveCockpitDestination("next", "diagnosis", false, true)).toBeNull();
  });

  it("releases snap while reading an expanded report", () => {
    expect(resolveCockpitDestination("previous", "diagnosis", true, false)).toBeNull();
    expect(resolveCockpitDestination("previous", "diagnosis", true, true)).toBe("live");
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

  it("keeps the gesture locked after arriving at an expanded diagnosis screen", () => {
    const { container } = render(createElement(Harness, { reportExpanded: true }));
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
    expect(root.hasAttribute("data-report-reading")).toBe(false);
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

  it("leaves every keyboard paging command native below an expanded report header", () => {
    const onScreenChange = vi.fn();
    const { container } = render(createElement(Harness, { reportExpanded: true, onScreenChange }));
    const { root, entry, live, diagnosis, evidenceHeader, scrolls } = installCockpitGeometry(container);
    root.scrollTop = 2300;
    setRect(root, 100, 1000);
    setRect(entry, -2200, 1000);
    setRect(live, -1200, 1000);
    setRect(diagnosis, -200, 1000);
    setRect(evidenceHeader, -200, 40);
    fireEvent.scroll(root);
    expect(root).toHaveAttribute("data-report-reading", "true");
    onScreenChange.mockClear();

    for (const key of ["Home", "End", "ArrowUp", "PageDown", " "]) {
      expect(fireEvent.keyDown(window, { key, cancelable: true })).toBe(true);
    }
    expect(scrolls.every((scroll) => scroll.mock.calls.length === 0)).toBe(true);
    expect(onScreenChange).not.toHaveBeenCalled();
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

  it("releases native report scrolling until an upward gesture starts at the evidence top", () => {
    const onScreenChange = vi.fn();
    const { container } = render(createElement(Harness, { reportExpanded: true, onScreenChange }));
    const { root, scrolls } = installCockpitGeometry(container);

    root.scrollTop = 2300;
    fireEvent.scroll(root);
    expect(root).toHaveAttribute("data-report-reading", "true");
    expect(root.hasAttribute("data-report-expanded")).toBe(false);
    expect(fireEvent.wheel(root, { deltaY: -120, cancelable: true })).toBe(true);
    expect(scrolls[1]).not.toHaveBeenCalled();

    root.scrollTop = 2000;
    fireEvent.scroll(root);
    expect(root.hasAttribute("data-report-reading")).toBe(false);
    expect(fireEvent.wheel(root, { deltaY: -120, cancelable: true })).toBe(false);
    expect(scrolls[1]).toHaveBeenCalledTimes(1);
    expect(onScreenChange).not.toHaveBeenCalledWith("live");

    root.scrollTop = 1400;
    fireEvent.scroll(root);
    expect(onScreenChange).toHaveBeenLastCalledWith("live");
  });
});
