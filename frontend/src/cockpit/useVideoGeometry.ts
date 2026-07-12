import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import type { VideoGeometry } from "./types";

export function useVideoGeometry(activeSlot: RefObject<HTMLElement | null>) {
  const [geometry, setGeometry] = useState<VideoGeometry | null>(null);

  useLayoutEffect(() => {
    const slot = activeSlot.current;
    const update = () => {
      const rect = activeSlot.current?.getBoundingClientRect();
      if (!rect) return;
      setGeometry({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        radius: 8,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    if (slot) observer.observe(slot);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [activeSlot]);

  return geometry;
}
