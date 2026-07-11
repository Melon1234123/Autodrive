export const DESKTOP_SHOWCASE_MOTION_QUERY = "(min-width: 1024px) and (pointer: fine)";

export type ShowcaseMotionEnvironment = {
  reducedMotion: boolean;
  desktopFinePointer: boolean;
};

export function shouldEnableShowcaseMotion({ reducedMotion, desktopFinePointer }: ShowcaseMotionEnvironment) {
  return desktopFinePointer && !reducedMotion;
}

export function resolveShowcaseAnchor(root: HTMLElement, href: string): HTMLElement | null {
  if (!href.startsWith("#") || href.length < 2) return null;
  const id = decodeURIComponent(href.slice(1));
  const target = document.getElementById(id);
  return target && root.contains(target) ? target : null;
}
