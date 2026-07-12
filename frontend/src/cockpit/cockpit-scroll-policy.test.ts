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
    expect(onScreenChange).toHaveBeenLastCalledWith("diagnosis");
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
    expect(root.hasAttribute("data-report-expanded")).toBe(false);
  });

  it("releases native report scrolling until an upward gesture starts at the evidence top", () => {
    const onScreenChange = vi.fn();
    const { container } = render(createElement(Harness, { reportExpanded: true, onScreenChange }));
    const { root, scrolls } = installCockpitGeometry(container);

    root.scrollTop = 2300;
    fireEvent.scroll(root);
    expect(root).toHaveAttribute("data-report-expanded", "true");
    expect(fireEvent.wheel(root, { deltaY: -120, cancelable: true })).toBe(true);
    expect(scrolls[1]).not.toHaveBeenCalled();

    root.scrollTop = 2000;
    fireEvent.scroll(root);
    expect(root.hasAttribute("data-report-expanded")).toBe(false);
    expect(fireEvent.wheel(root, { deltaY: -120, cancelable: true })).toBe(false);
    expect(scrolls[1]).toHaveBeenCalledTimes(1);
    expect(onScreenChange).toHaveBeenLastCalledWith("live");
  });
});
