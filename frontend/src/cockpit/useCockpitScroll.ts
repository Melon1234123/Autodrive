import { useLayoutEffect, useRef, type RefObject } from "react";
import { resolveCockpitDestination, type CockpitScrollCommand } from "./cockpit-scroll-policy";
import type { CockpitScreen } from "./types";

type CockpitScrollOptions = {
  rootRef: RefObject<HTMLElement | null>;
  reportRef: RefObject<HTMLElement | null>;
  reportExpanded: boolean;
  onScreenChange: (screen: CockpitScreen) => void;
};

const SCREEN_ORDER: readonly CockpitScreen[] = ["entry", "live", "diagnosis"];
const WHEEL_GESTURE_SETTLE_MS = 120;
const WHEEL_GESTURE_EXCLUSION = [
  "input", "textarea", "select", "[contenteditable]:not([contenteditable='false'])",
  "[data-lenis-prevent]", "[data-lenis-prevent-wheel]", "[data-lenis-prevent-vertical]",
].join(",");
const KEYBOARD_CONTROL_EXCLUSION = [
  "input", "textarea", "select", "button", "a[href]", "[role='button']",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

function isCockpitScreen(value: string | undefined): value is CockpitScreen {
  return value === "entry" || value === "live" || value === "diagnosis";
}

function relativeOffsetTop(element: HTMLElement, root: HTMLElement) {
  const elementRect = element.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (elementRect.height !== 0 || rootRect.height !== 0 || elementRect.top !== rootRect.top) {
    return root.scrollTop + elementRect.top - rootRect.top;
  }
  let offset = 0;
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    offset += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return offset;
}

function excludedWheelTarget(event: WheelEvent, root: HTMLElement) {
  const path = event.composedPath();
  const rootIndex = path.indexOf(root);
  const scopedPath = rootIndex >= 0 ? path.slice(0, rootIndex) : path;
  if (scopedPath.some((node) => node instanceof Element && node.matches(WHEEL_GESTURE_EXCLUSION))) {
    return true;
  }
  const target = event.target instanceof Element ? event.target : null;
  let current = target;
  while (current && current !== root) {
    if (current.matches(WHEEL_GESTURE_EXCLUSION)) return true;
    current = current.parentElement;
  }
  return false;
}

function keyboardCommand(event: KeyboardEvent): CockpitScrollCommand | null {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(KEYBOARD_CONTROL_EXCLUSION)) return null;
  if (event.key === "ArrowDown" || event.key === "PageDown" || (event.key === " " && !event.shiftKey)) {
    return "next";
  }
  if (event.key === "ArrowUp" || event.key === "PageUp" || (event.key === " " && event.shiftKey)) {
    return "previous";
  }
  return null;
}

export function useCockpitScroll({
  rootRef,
  reportRef,
  reportExpanded,
  onScreenChange,
}: CockpitScrollOptions) {
  const reportExpandedRef = useRef(reportExpanded);
  const onScreenChangeRef = useRef(onScreenChange);
  reportExpandedRef.current = reportExpanded;
  onScreenChangeRef.current = onScreenChange;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const screenElements = Array.from(root.querySelectorAll<HTMLElement>(".cockpit-screen"));
    const screens = screenElements.map((element, index) => {
      const declared = element.dataset.cockpitScreen;
      return {
        element,
        screen: isCockpitScreen(declared) ? declared : SCREEN_ORDER[index],
      };
    }).filter((entry): entry is { element: HTMLElement; screen: CockpitScreen } => Boolean(entry.screen));
    let wheelGestureTimer = 0;
    let wheelGestureActive = false;

    const currentScreen = () => {
      if (screens.length === 0) return null;
      return screens.reduce((closest, candidate) => (
        Math.abs(relativeOffsetTop(candidate.element, root) - root.scrollTop) <
        Math.abs(relativeOffsetTop(closest.element, root) - root.scrollTop) ? candidate : closest
      )).screen;
    };
    let lastScreen = currentScreen();

    const reportAtTop = () => {
      const anchor = reportRef.current;
      if (!anchor) {
        const diagnosis = screens.find(({ screen }) => screen === "diagnosis");
        return !diagnosis || root.scrollTop <= relativeOffsetTop(diagnosis.element, root) + 1;
      }
      return root.scrollTop <= relativeOffsetTop(anchor, root) + 1;
    };

    const syncReportReadingState = () => {
      const reading = reportExpandedRef.current && !reportAtTop();
      if (reading) root.setAttribute("data-report-expanded", "true");
      else root.removeAttribute("data-report-expanded");
    };

    const announceScreen = (screen: CockpitScreen) => {
      if (screen === lastScreen) return;
      lastScreen = screen;
      onScreenChangeRef.current(screen);
    };

    const navigate = (command: CockpitScrollCommand) => {
      const current = currentScreen();
      if (!current) return false;
      const atTop = reportAtTop();
      if (current === "diagnosis" && reportExpandedRef.current && (command === "next" || !atTop)) {
        return false;
      }
      const destination = resolveCockpitDestination(
        command,
        current,
        reportExpandedRef.current,
        atTop,
      );
      if (!destination) return true;
      const target = screens.find(({ screen }) => screen === destination)?.element;
      if (!target) return false;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      announceScreen(destination);
      return true;
    };

    const holdWheelGesture = () => {
      wheelGestureActive = true;
      window.clearTimeout(wheelGestureTimer);
      wheelGestureTimer = window.setTimeout(() => {
        wheelGestureTimer = 0;
        wheelGestureActive = false;
      }, WHEEL_GESTURE_SETTLE_MS);
    };

    const handleWheel = (event: WheelEvent) => {
      const vertical = event.deltaY !== 0 && Math.abs(event.deltaY) > Math.abs(event.deltaX);
      const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
      if (
        event.defaultPrevented || !event.cancelable || !vertical || modified ||
        excludedWheelTarget(event, root)
      ) return;

      const current = currentScreen();
      const command: CockpitScrollCommand = event.deltaY > 0 ? "next" : "previous";
      if (
        current === "diagnosis" && reportExpandedRef.current &&
        (command === "next" || !reportAtTop())
      ) return;

      event.preventDefault();
      if (wheelGestureActive) return;
      holdWheelGesture();
      navigate(command);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const command = keyboardCommand(event);
      if (!command || !navigate(command)) return;
      event.preventDefault();
    };

    const handleScroll = () => {
      const screen = currentScreen();
      if (screen) announceScreen(screen);
      syncReportReadingState();
    };

    root.addEventListener("wheel", handleWheel, { passive: false });
    root.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    syncReportReadingState();

    return () => {
      window.clearTimeout(wheelGestureTimer);
      root.removeEventListener("wheel", handleWheel);
      root.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeyDown);
      root.removeAttribute("data-report-expanded");
    };
  }, [reportRef, rootRef]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const anchor = reportRef.current;
    if (!root) return;
    const anchorTop = anchor ? relativeOffsetTop(anchor, root) : Number.POSITIVE_INFINITY;
    const reading = reportExpanded && root.scrollTop > anchorTop + 1;
    if (reading) root.setAttribute("data-report-expanded", "true");
    else root.removeAttribute("data-report-expanded");
  }, [reportExpanded, reportRef, rootRef]);
}
