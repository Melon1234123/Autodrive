import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { CockpitScreen, VideoGeometry } from "./types";
import { useVideoGeometry } from "./useVideoGeometry";
import { transformCoverBox } from "./video-cover-geometry";

export type CameraPerceptionObject = {
  id: string;
  label?: string;
  risk?: string;
  cameraBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  };
};

export type PersistentScenePlayerProps = {
  sceneKey: string;
  src: string;
  activeScreen: CockpitScreen;
  slots: Record<CockpitScreen, RefObject<HTMLElement | null>>;
  scrollRootRef?: RefObject<HTMLElement | null>;
  showDetections: boolean;
  objects: readonly CameraPerceptionObject[];
  videoRef?: RefObject<HTMLVideoElement | null>;
  onTimeChange?: (currentTime: number) => void;
};

function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement | null) {
  if (!canvas || video.videoWidth <= 0 || video.videoHeight <= 0) return;

  try {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.hidden = false;
  } catch {
    canvas.hidden = true;
  }
}

function revealVideo(canvas: HTMLCanvasElement | null) {
  if (canvas) canvas.hidden = true;
}

function resolvedSource(source: string) {
  return new URL(source, document.baseURI).href;
}

function playWithoutUnhandledRejection(video: HTMLVideoElement) {
  try {
    void video.play().catch(() => undefined);
  } catch {
    // Some media implementations can reject synchronously before returning a promise.
  }
}

function geometryStyle(geometry: VideoGeometry | null): CSSProperties {
  return {
    position: "fixed",
    left: geometry?.left ?? 0,
    top: geometry?.top ?? 0,
    width: geometry?.width ?? 0,
    height: geometry?.height ?? 0,
    borderRadius: geometry?.radius ?? 8,
    overflow: "hidden",
    visibility: geometry ? "visible" : "hidden",
  };
}

function DetectionOverlay({ objects, slot }: {
  objects: readonly CameraPerceptionObject[];
  slot: { width: number; height: number };
}) {
  return (
    <div
      className="camera-targets"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}
    >
      {objects.map((object, index) => {
        const box = object.cameraBox;
        if (!box || box.imageWidth <= 0 || box.imageHeight <= 0) return null;
        const visible = transformCoverBox({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          sourceWidth: box.imageWidth,
          sourceHeight: box.imageHeight,
        }, slot);
        return (
          <span
            className={`camera-target target-${object.risk ?? "unknown"}`}
            key={`${object.id}-${index}`}
            style={{
              position: "absolute",
              left: visible.left,
              top: visible.top,
              width: visible.width,
              height: visible.height,
            }}
          >
            {object.label ? <em>{object.label}</em> : null}
          </span>
        );
      })}
    </div>
  );
}

export function PersistentScenePlayer({
  sceneKey,
  src,
  activeScreen,
  slots,
  scrollRootRef,
  showDetections,
  objects,
  videoRef: externalVideoRef,
  onTimeChange,
}: PersistentScenePlayerProps) {
  const ownedVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef ?? ownedVideoRef;
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const previousSceneRef = useRef(sceneKey);
  const loadGenerationRef = useRef(0);
  const initialSourceRef = useRef(src);
  const expectedSourceRef = useRef(resolvedSource(src));
  const [mediaError, setMediaError] = useState<string | null>(null);
  const geometry = useVideoGeometry(slots[activeScreen], scrollRootRef);

  // sceneKey is the sole source-transition trigger; src-only renders must leave media state intact.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (previousSceneRef.current === sceneKey || !video) return;

    captureFrame(video, freezeRef.current);
    previousSceneRef.current = sceneKey;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const expectedSource = resolvedSource(src);
    expectedSourceRef.current = expectedSource;
    const handleCanPlay = () => {
      const completedSource = video.currentSrc;
      if (
        loadGenerationRef.current !== generation
        || !completedSource
        || completedSource !== expectedSource
        || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
      ) return;
      video.removeEventListener("canplay", handleCanPlay);
      setMediaError(null);
      revealVideo(freezeRef.current);
      playWithoutUnhandledRejection(video);
    };

    video.addEventListener("canplay", handleCanPlay);
    video.src = src;
    video.currentTime = 0;
    video.load();
    return () => video.removeEventListener("canplay", handleCanPlay);
  }, [sceneKey]);

  return (
    <div
      className="persistent-player"
      data-testid="persistent-scene-player"
      style={geometryStyle(geometry)}
    >
      <video
        ref={videoRef}
        data-testid="persistent-scene-video"
        src={initialSourceRef.current}
        muted
        autoPlay
        playsInline
        loop
        preload="auto"
        onError={(event) => {
          const currentSource = event.currentTarget.currentSrc;
          if (currentSource && currentSource !== expectedSourceRef.current) return;
          setMediaError("场景视频加载失败，可切换其他场景重试。");
        }}
        onTimeUpdate={(event) => onTimeChange?.(event.currentTarget.currentTime)}
        style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
      />
      <canvas
        ref={freezeRef}
        className="persistent-player__freeze"
        data-testid="persistent-scene-freeze"
        aria-hidden="true"
        hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      {showDetections && geometry ? (
        <DetectionOverlay objects={objects} slot={{ width: geometry.width, height: geometry.height }} />
      ) : null}
      {mediaError ? (
        <p className="persistent-player__error" role="alert">{mediaError}</p>
      ) : null}
    </div>
  );
}
