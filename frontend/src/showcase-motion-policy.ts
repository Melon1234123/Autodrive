export const DESKTOP_SHOWCASE_MOTION_QUERY = "(min-width: 1024px) and (pointer: fine)";

export type ShowcaseMotionEnvironment = {
  reducedMotion: boolean;
  desktopFinePointer: boolean;
};

export type ShowcasePageCommand = "previous" | "next" | "first" | "last";

type ShowcasePageKeyEvent = Pick<KeyboardEvent,
  "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" |
  "defaultPrevented" | "repeat"
>;

const EDITABLE_TARGET = "input,textarea,select,[contenteditable]:not([contenteditable='false'])";
const SPACE_CONTROL = "button,a[href],[role='button']";

export function shouldEnableShowcaseMotion({ reducedMotion, desktopFinePointer }: ShowcaseMotionEnvironment) {
  return desktopFinePointer && !reducedMotion;
}

export function resolveShowcaseAnchor(root: HTMLElement, href: string): HTMLElement | null {
  if (!href.startsWith("#") || href.length < 2) return null;
  const id = decodeURIComponent(href.slice(1));
  const target = document.getElementById(id);
  return target && root.contains(target) ? target : null;
}

export function resolveShowcasePageCommand(
  event: ShowcasePageKeyEvent,
  target: EventTarget | null,
): ShowcasePageCommand | null {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  const element = target instanceof Element ? target : null;
  if (element?.closest(EDITABLE_TARGET)) return null;
  if (event.key === " " && element?.closest(SPACE_CONTROL)) return null;
  if (event.key === "ArrowDown" || event.key === "PageDown" || (event.key === " " && !event.shiftKey)) return "next";
  if (event.key === "ArrowUp" || event.key === "PageUp" || (event.key === " " && event.shiftKey)) return "previous";
  if (event.key === "Home") return "first";
  if (event.key === "End") return "last";
  return null;
}

export function resolveShowcasePageDestination(
  command: ShowcasePageCommand,
  currentIndex: number,
  pageCount: number,
): number | null {
  if (pageCount < 1 || currentIndex < 0 || currentIndex >= pageCount) return null;
  const destination = command === "first" ? 0
    : command === "last" ? pageCount - 1
      : currentIndex + (command === "next" ? 1 : -1);
  if (destination < 0 || destination >= pageCount || destination === currentIndex) return null;
  return destination;
}
