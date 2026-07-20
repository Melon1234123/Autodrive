import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

type DeferredVideoProps = Omit<ComponentPropsWithoutRef<"video">, "preload" | "src"> & {
  src: string;
};

export default function DeferredVideo({ src, ...props }: DeferredVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, {
      root: video.closest<HTMLElement>(".showcase"),
      rootMargin: "100% 0px",
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video ref={videoRef} {...props} preload={shouldLoad ? "metadata" : "none"} src={shouldLoad ? src : undefined} />;
}
