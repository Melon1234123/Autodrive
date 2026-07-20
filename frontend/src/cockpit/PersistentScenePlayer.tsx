import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CockpitScreen } from "./types";
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
  seekTime?: number | null;
  seekVersion?: number;
};

const SCREEN_ORDER: readonly CockpitScreen[] = ["entry", "live", "diagnosis", "report"];
const TIME_SYNC_TOLERANCE = 0.08;

type VideoRefs = Record<CockpitScreen, HTMLVideoElement | null>;
type FreezeRefs = Record<CockpitScreen, HTMLCanvasElement | null>;
type PortalTargets = Record<CockpitScreen, HTMLElement | null>;

function emptyVideoRefs(): VideoRefs {
  return { entry: null, live: null, diagnosis: null, report: null };
}

function emptyFreezeRefs(): FreezeRefs {
  return { entry: null, live: null, diagnosis: null, report: null };
}

function emptyPortalTargets(): PortalTargets {
  return { entry: null, live: null, diagnosis: null, report: null };
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

function revealFrame(canvas: HTMLCanvasElement | null) {
  if (canvas) canvas.hidden = true;
}

function setVideoTime(video: HTMLVideoElement, time: number) {
  if (!Number.isFinite(time) || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
  if (Math.abs(video.currentTime - time) <= TIME_SYNC_TOLERANCE) return;
  try {
    video.currentTime = time;
  } catch {
    // A browser can reject a seek while the media source is changing.
  }
}

function setVideoRate(video: HTMLVideoElement, rate: number) {
  if (!Number.isFinite(rate) || rate <= 0 || video.playbackRate === rate) return;
  try {
    video.playbackRate = rate;
  } catch {
    // A browser can reject a rate update before media metadata is ready.
  }
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

function EmbeddedSceneVideo({
  screen,
  src,
  activeScreen,
  showDetections,
  objects,
  mediaError,
  registerVideo,
  registerFreeze,
  onCanPlay,
  onError,
  onTimeUpdate,
  onPlay,
  onPause,
  onRateChange,
}: {
  screen: CockpitScreen;
  src: string;
  activeScreen: CockpitScreen;
  showDetections: boolean;
  objects: readonly CameraPerceptionObject[];
  mediaError: string | null;
  registerVideo: (screen: CockpitScreen, node: HTMLVideoElement | null) => void;
  registerFreeze: (screen: CockpitScreen, node: HTMLCanvasElement | null) => void;
  onCanPlay: (screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onError: (screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onTimeUpdate: (screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onPlay: (screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onPause: (screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onRateChange: (screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [slotSize, setSlotSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => {
      const rect = frame.getBoundingClientRect();
      setSlotSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="persistent-player"
      data-testid={`persistent-scene-player-${screen}`}
      data-active={screen === activeScreen ? "true" : "false"}
    >
      <video
        ref={(node) => registerVideo(screen, node)}
        data-testid={`cockpit-scene-video-${screen}`}
        src={src}
        muted
        autoPlay={screen === activeScreen}
        playsInline
        loop
        preload="auto"
        onCanPlay={(event) => onCanPlay(screen, event)}
        onError={(event) => onError(screen, event)}
        onTimeUpdate={(event) => onTimeUpdate(screen, event)}
        onPlay={(event) => onPlay(screen, event)}
        onPause={(event) => onPause(screen, event)}
        onRateChange={(event) => onRateChange(screen, event)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: "cover",
        }}
      />
      <canvas
        ref={(node) => registerFreeze(screen, node)}
        className="persistent-player__freeze"
        data-testid={`cockpit-scene-freeze-${screen}`}
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
      {showDetections && slotSize.width > 0 && slotSize.height > 0 ? (
        <DetectionOverlay objects={objects} slot={slotSize} />
      ) : null}
      {mediaError && screen === activeScreen ? (
        <p className="persistent-player__error" role="alert">{mediaError}</p>
      ) : null}
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
  seekTime = null,
  seekVersion = 0,
}: PersistentScenePlayerProps) {
  const videosRef = useRef<VideoRefs>(emptyVideoRefs());
  const freezeRefs = useRef<FreezeRefs>(emptyFreezeRefs());
  const activeScreenRef = useRef(activeScreen);
  const previousActiveScreenRef = useRef(activeScreen);
  const previousSceneRef = useRef(sceneKey);
  const expectedSourceRef = useRef(resolvedSource(src));
  const playbackStateRef = useRef<"playing" | "paused">("playing");
  const timelineTimeRef = useRef(0);
  const [portalTargets, setPortalTargets] = useState<PortalTargets>(emptyPortalTargets);
  const [mediaError, setMediaError] = useState<string | null>(null);

  activeScreenRef.current = activeScreen;
  expectedSourceRef.current = resolvedSource(src);

  useLayoutEffect(() => {
    const nextTargets: PortalTargets = {
      entry: slots.entry.current,
      live: slots.live.current,
      diagnosis: slots.diagnosis.current,
      report: slots.report.current,
    };
    if (SCREEN_ORDER.some((screen) => nextTargets[screen] !== portalTargets[screen])) {
      setPortalTargets(nextTargets);
    }
  });

  const registerVideo = useCallback((screen: CockpitScreen, node: HTMLVideoElement | null) => {
    videosRef.current[screen] = node;
    if (externalVideoRef && screen === activeScreenRef.current) {
      externalVideoRef.current = node;
    }
  }, [externalVideoRef]);

  const registerFreeze = useCallback((screen: CockpitScreen, node: HTMLCanvasElement | null) => {
    freezeRefs.current[screen] = node;
  }, []);

  const syncTime = useCallback((source: HTMLVideoElement, notify = true) => {
    const time = source.currentTime;
    if (!Number.isFinite(time)) return;
    timelineTimeRef.current = time;
    SCREEN_ORDER.forEach((screen) => {
      const video = videosRef.current[screen];
      if (video && video !== source) setVideoTime(video, time);
    });
    if (notify) onTimeChange?.(time);
  }, [onTimeChange]);

  useLayoutEffect(() => {
    if (seekTime === null || !Number.isFinite(seekTime)) return;
    timelineTimeRef.current = seekTime;
    SCREEN_ORDER.forEach((screen) => {
      const video = videosRef.current[screen];
      if (video) setVideoTime(video, seekTime);
    });
  }, [seekTime, seekVersion]);

  const syncRate = useCallback((source: HTMLVideoElement) => {
    const rate = source.playbackRate;
    SCREEN_ORDER.forEach((screen) => {
      const video = videosRef.current[screen];
      if (video && video !== source) setVideoRate(video, rate);
    });
  }, []);

  const pauseInactiveVideos = useCallback((keep: HTMLVideoElement | null) => {
    SCREEN_ORDER.forEach((screen) => {
      const video = videosRef.current[screen];
      if (video && video !== keep && !video.paused) video.pause();
    });
  }, []);

  const handleCanPlay = useCallback((screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const currentSource = video.currentSrc;
    if (
      (currentSource && currentSource !== expectedSourceRef.current) ||
      video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) return;
    revealFrame(freezeRefs.current[screen]);
    setVideoTime(video, timelineTimeRef.current);
    const activeVideo = videosRef.current[activeScreenRef.current];
    if (video === activeVideo && playbackStateRef.current === "playing") {
      pauseInactiveVideos(video);
      playWithoutUnhandledRejection(video);
    }
    setMediaError(null);
  }, [pauseInactiveVideos]);

  const handleError = useCallback((_screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentSource = event.currentTarget.currentSrc;
    if (currentSource && currentSource !== expectedSourceRef.current) return;
    setMediaError("场景视频加载失败，可切换其他场景重试。");
  }, []);

  const handleTimeUpdate = useCallback((screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (screen !== activeScreenRef.current) {
      const activeVideo = videosRef.current[activeScreenRef.current];
      if (activeVideo) setVideoTime(video, activeVideo.currentTime);
      return;
    }
    syncTime(video);
  }, [syncTime]);

  const handlePlay = useCallback((screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const activeVideo = videosRef.current[activeScreenRef.current];
    if (screen !== activeScreenRef.current || video !== activeVideo) {
      video.pause();
      return;
    }
    playbackStateRef.current = "playing";
    syncTime(video);
    syncRate(video);
    pauseInactiveVideos(video);
  }, [pauseInactiveVideos, syncRate, syncTime]);

  const handlePause = useCallback((screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (screen !== activeScreenRef.current) return;
    playbackStateRef.current = "paused";
    pauseInactiveVideos(null);
  }, [pauseInactiveVideos]);

  const handleRateChange = useCallback((screen: CockpitScreen, event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (screen !== activeScreenRef.current) return;
    syncRate(event.currentTarget);
  }, [syncRate]);

  useLayoutEffect(() => {
    const activeVideo = videosRef.current[activeScreen];
    if (!activeVideo) return;
    const previousVideo = videosRef.current[previousActiveScreenRef.current];
    if (previousVideo && previousVideo !== activeVideo) {
      setVideoTime(activeVideo, timelineTimeRef.current);
      setVideoRate(activeVideo, previousVideo.playbackRate);
    }
    pauseInactiveVideos(activeVideo);
    if (externalVideoRef) externalVideoRef.current = activeVideo;
    if (playbackStateRef.current === "playing") playWithoutUnhandledRejection(activeVideo);
    previousActiveScreenRef.current = activeScreen;
  }, [activeScreen, externalVideoRef, pauseInactiveVideos]);

  useLayoutEffect(() => {
    if (previousSceneRef.current === sceneKey) return;
    previousSceneRef.current = sceneKey;
    timelineTimeRef.current = 0;
    setMediaError(null);
    SCREEN_ORDER.forEach((screen) => {
      const video = videosRef.current[screen];
      if (!video) return;
      captureFrame(video, freezeRefs.current[screen]);
      video.src = src;
      video.currentTime = 0;
      video.load();
    });
  }, [sceneKey, src]);

  useEffect(() => () => {
    if (externalVideoRef) externalVideoRef.current = null;
  }, [externalVideoRef]);

  const portals = SCREEN_ORDER.map((screen) => {
    const target = portalTargets[screen];
    if (!target) return null;
    return createPortal(
      <EmbeddedSceneVideo
        key={screen}
        screen={screen}
        src={src}
        activeScreen={activeScreen}
        showDetections={showDetections && screen !== "entry"}
        objects={objects}
        mediaError={mediaError}
        registerVideo={registerVideo}
        registerFreeze={registerFreeze}
        onCanPlay={handleCanPlay}
        onError={handleError}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onRateChange={handleRateChange}
      />, target, `cockpit-video-${screen}`,
    );
  });

  return <>{portals}</>;
}
