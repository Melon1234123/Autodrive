import { useLayoutEffect, useRef, type RefObject } from "react";
import { resolveCockpitDestination, type CockpitScrollCommand } from "./cockpit-scroll-policy";
import type { CockpitScreen } from "./types";

type CockpitScrollOptions = {
  rootRef: RefObject<HTMLElement | null>;
  onScreenChange: (screen: CockpitScreen) => void;
  screenOrder: readonly CockpitScreen[];
  activeScreen: CockpitScreen;
  pendingScreen: CockpitScreen | null;
  onScreenIntent?: (screen: CockpitScreen) => void;
  onScreenSettled?: (screen: CockpitScreen) => void;
};

type CockpitKeyboardCommand = CockpitScrollCommand | "first" | "last";

const WHEEL_GESTURE_SETTLE_MS = 120;
const WHEEL_GESTURE_EXCLUSION = [
  "input", "textarea", "select", "[contenteditable]:not([contenteditable='false'])",
  "[data-lenis-prevent]", "[data-lenis-prevent-wheel]", "[data-lenis-prevent-vertical]",
].join(",");
const KEYBOARD_CONTROL_EXCLUSION = [
  "input", "textarea", "select", "button", "a[href]", "[role='button']",
  "[contenteditable]:not([contenteditable='false'])", "[data-lenis-prevent-vertical]",
].join(",");

export function cockpitScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function isCockpitScreen(value: string | undefined): value is CockpitScreen {
  return value === "entry" || value === "live" || value === "diagnosis" || value === "report";
}

function ownsWheelGesture(event: WheelEvent, root: HTMLElement) {
  const target = event.target instanceof Element ? event.target : null;
  const surface = target?.closest<HTMLElement>("[data-cockpit-scroll-surface]");
  if (!surface || !root.contains(surface)) return false;
  const maximumScrollTop = Math.max(0, surface.scrollHeight - surface.clientHeight);
  if (maximumScrollTop <= 0) return false;
  return event.deltaY > 0 ? surface.scrollTop < maximumScrollTop : surface.scrollTop > 0;
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

function keyboardCommand(event: KeyboardEvent): CockpitKeyboardCommand | null {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(KEYBOARD_CONTROL_EXCLUSION)) return null;
  if (event.key === "ArrowDown" || event.key === "PageDown" || (event.key === " " && !event.shiftKey)) {
    return "next";
  }
  if (event.key === "ArrowUp" || event.key === "PageUp" || (event.key === " " && event.shiftKey)) {
    return "previous";
  }
  if (event.key === "Home") return "first";
  if (event.key === "End") return "last";
  return null;
}

export function useCockpitScroll({
  rootRef,
  onScreenChange,
  screenOrder,
  activeScreen,
  pendingScreen,
  onScreenIntent,
  onScreenSettled,
}: CockpitScrollOptions) {
  const onScreenChangeRef = useRef(onScreenChange);
  const activeScreenRef = useRef(activeScreen);
  const pendingScreenRef = useRef(pendingScreen);
  const onScreenIntentRef = useRef(onScreenIntent);
  const onScreenSettledRef = useRef(onScreenSettled);
  onScreenChangeRef.current = onScreenChange;
  activeScreenRef.current = activeScreen;
  pendingScreenRef.current = pendingScreen;
  onScreenIntentRef.current = onScreenIntent;
  onScreenSettledRef.current = onScreenSettled;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const screenElements = Array.from(root.querySelectorAll<HTMLElement>(".cockpit-screen"));
    const screens = screenElements.flatMap((element) => {
      const declared = element.dataset.cockpitScreen;
      if (!isCockpitScreen(declared) || !screenOrder.includes(declared)) return [];
      return [{ element, screen: declared }];
    });
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

    const announceScreen = (screen: CockpitScreen) => {
      if (screen === lastScreen) return;
      lastScreen = screen;
      onScreenChangeRef.current(screen);
    };

    const navigate = (command: CockpitKeyboardCommand) => {
      const pending = pendingScreenRef.current;
      const current = pending && screenOrder.includes(pending) ? pending : currentScreen();
      if (!current) return false;
      const destination = command === "first" ? screenOrder[0]
        : command === "last" ? screenOrder[screenOrder.length - 1]
          : resolveCockpitDestination(screenOrder, command, current);
      if (!destination) return true;
      const target = screens.find(({ screen }) => screen === destination)?.element;
      if (!target) return false;
      onScreenIntentRef.current?.(destination);
      target.scrollIntoView({ behavior: cockpitScrollBehavior(), block: "start" });
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
        excludedWheelTarget(event, root) || ownsWheelGesture(event, root)
      ) return;

      const current = currentScreen();
      const command: CockpitScrollCommand = event.deltaY > 0 ? "next" : "previous";
      if (wheelGestureActive) {
        event.preventDefault();
        holdWheelGesture();
        return;
      }
      event.preventDefault();
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
      if (!screen) return;
      const pending = pendingScreenRef.current;
      if (pending) {
        if (screen !== pending) return;
        pendingScreenRef.current = null;
        lastScreen = screen;
        onScreenSettledRef.current?.(screen);
        if (activeScreenRef.current !== screen) onScreenChangeRef.current(screen);
        return;
      }
      announceScreen(screen);
    };

    root.addEventListener("wheel", handleWheel, { passive: false });
    root.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(wheelGestureTimer);
      root.removeEventListener("wheel", handleWheel);
      root.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [rootRef, screenOrder]);
}
