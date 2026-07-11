import { useEffect, useRef, type RefObject } from "react";
import type { ShowcaseTerrainPreset } from "./terrain-presets";

export type TerrainVisibility = { preset: ShowcaseTerrainPreset; area: number; order: number };
export const TERRAIN_OBSERVER_THRESHOLDS = Array.from({ length: 21 }, (_, index) => index / 20);

export function selectTerrainPreset(
  visibility: TerrainVisibility[],
  current: ShowcaseTerrainPreset,
  rootArea: number,
): ShowcaseTerrainPreset {
  const sorted = [...visibility].sort((left, right) => right.area - left.area || left.order - right.order);
  const candidate = sorted[0];
  if (!candidate || candidate.preset === current) return current;
  const currentArea = visibility.find((item) => item.preset === current)?.area ?? 0;
  const candidateLead = candidate.area - currentArea;
  if (candidateLead >= rootArea * 0.08 || currentArea < rootArea * 0.15) return candidate.preset;
  return current;
}

export function useTerrainSectionPalette(
  rootRef: RefObject<HTMLElement | null>,
  onChange: (preset: ShowcaseTerrainPreset) => void,
) {
  const currentRef = useRef<ShowcaseTerrainPreset>("hidden");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    currentRef.current = "hidden";
    onChange("hidden");
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-terrain-preset]"));
    if (typeof IntersectionObserver === "undefined") {
      currentRef.current = "positioning";
      onChange("positioning");
      return;
    }
    const visibility = new Map<Element, TerrainVisibility>();
    sections.forEach((section, order) => {
      visibility.set(section, {
        preset: section.dataset.terrainPreset as ShowcaseTerrainPreset,
        area: 0,
        order,
      });
    });
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const item = visibility.get(entry.target);
        if (item) item.area = entry.intersectionRect.width * entry.intersectionRect.height;
      });
      const rootArea = Math.max(root.clientWidth * root.clientHeight, 1);
      const next = selectTerrainPreset([...visibility.values()], currentRef.current, rootArea);
      if (next !== currentRef.current) {
        currentRef.current = next;
        onChange(next);
      }
    }, { root, threshold: TERRAIN_OBSERVER_THRESHOLDS });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [onChange, rootRef]);
}
