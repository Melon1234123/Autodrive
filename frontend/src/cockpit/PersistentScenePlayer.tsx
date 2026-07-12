import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, RefObject } from "react";
import type { CockpitScreen, VideoGeometry } from "./types";
import { useVideoGeometry } from "./useVideoGeometry";

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

function DetectionOverlay({ objects }: { objects: readonly CameraPerceptionObject[] }) {
  return (
    <div
      className="camera-targets"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}
    >
      {objects.map((object, index) => {
        const box = object.cameraBox;
        if (!box || box.imageWidth <= 0 || box.imageHeight <= 0) return null;
        return (
          <span
            className={`camera-target target-${object.risk ?? "unknown"}`}
            key={`${object.id}-${index}`}
            style={{
              position: "absolute",
              left: `${(box.x / box.imageWidth) * 100}%`,
              top: `${(box.y / box.imageHeight) * 100}%`,
              width: `${(box.width / box.imageWidth) * 100}%`,
              height: `${(box.height / box.imageHeight) * 100}%`,
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
  showDetections,
  objects,
  videoRef: externalVideoRef,
  onTimeChange,
}: PersistentScenePlayerProps) {
  const ownedVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef ?? ownedVideoRef;
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const previousSceneRef = useRef(sceneKey);
  const initialSourceRef = useRef(src);
  const geometry = useVideoGeometry(slots[activeScreen]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (previousSceneRef.current === sceneKey || !video) return;

    captureFrame(video, freezeRef.current);
    previousSceneRef.current = sceneKey;
    video.src = src;
    video.currentTime = 0;
    video.load();
  }, [sceneKey, src, videoRef]);

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
        playsInline
        loop
        preload="auto"
        onCanPlay={() => revealVideo(freezeRef.current)}
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
      {showDetections ? <DetectionOverlay objects={objects} /> : null}
    </div>
  );
}
