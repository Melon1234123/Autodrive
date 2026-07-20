/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { RefObject } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersistentScenePlayer } from "./PersistentScenePlayer";
import type { CockpitScreen } from "./types";

class ResizeObserverDouble {
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {}
}

const slots = {
  entry: createRef<HTMLDivElement>(),
  live: createRef<HTMLDivElement>(),
  diagnosis: createRef<HTMLDivElement>(),
  report: createRef<HTMLDivElement>(),
};

function Harness({
  activeScreen,
  sceneKey,
  src,
  onTimeChange = vi.fn(),
  videoRef,
  reportMounted = false,
  seekTime = null,
}: {
  activeScreen: CockpitScreen;
  sceneKey: string;
  src: string;
  onTimeChange?: (currentTime: number) => void;
  videoRef?: RefObject<HTMLVideoElement | null>;
  reportMounted?: boolean;
  seekTime?: number | null;
}) {
  return (
    <>
      <div data-testid="cockpit-root">
        <div ref={slots.entry} data-testid="entry-slot" />
        <div ref={slots.live} data-testid="live-slot" />
        <div ref={slots.diagnosis} data-testid="diagnosis-slot" />
        {reportMounted ? <div ref={slots.report} data-testid="report-slot" /> : null}
      </div>
      <PersistentScenePlayer
        activeScreen={activeScreen}
        sceneKey={sceneKey}
        src={src}
        slots={slots}
        showDetections={false}
        objects={[]}
        videoRef={videoRef}
        onTimeChange={onTimeChange}
        seekTime={seekTime}
      />
    </>
  );
}

const drawImage = vi.fn();

function videos() {
  return {
    entry: screen.getByTestId("cockpit-scene-video-entry") as HTMLVideoElement,
    live: screen.getByTestId("cockpit-scene-video-live") as HTMLVideoElement,
    diagnosis: screen.getByTestId("cockpit-scene-video-diagnosis") as HTMLVideoElement,
  };
}

function reportVideo() {
  return screen.getByTestId("cockpit-scene-video-report") as HTMLVideoElement;
}

function setReady(video: HTMLVideoElement, readyState: number = HTMLMediaElement.HAVE_FUTURE_DATA) {
  Object.defineProperty(video, "readyState", { configurable: true, value: readyState });
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    value: new URL(video.getAttribute("src") ?? "", window.location.href).href,
  });
}

function setSourceCompletion(video: HTMLVideoElement, source: string, readyState: number = HTMLMediaElement.HAVE_FUTURE_DATA) {
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    value: source ? new URL(source, window.location.href).href : "",
  });
  Object.defineProperty(video, "readyState", { configurable: true, value: readyState });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverDouble);
  drawImage.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("embeds one video in each screen and keeps the active video ref current", () => {
  const externalVideoRef = createRef<HTMLVideoElement>();
  const { rerender } = render(
    <Harness
      activeScreen="entry"
      sceneKey="default"
      src="/sample.mp4"
      videoRef={externalVideoRef}
    />,
  );

  expect(document.querySelectorAll("video")).toHaveLength(3);
  expect(externalVideoRef.current).toBe(videos().entry);
  expect(videos().entry).toHaveAttribute("autoplay");
  expect(videos().live).not.toHaveAttribute("autoplay");
  expect(videos().diagnosis).not.toHaveAttribute("autoplay");

  rerender(
    <Harness
      activeScreen="live"
      sceneKey="default"
      src="/sample.mp4"
      videoRef={externalVideoRef}
    />,
  );

  expect(document.querySelectorAll("video")).toHaveLength(3);
  expect(externalVideoRef.current).toBe(videos().live);
  expect(videos().entry).toHaveAttribute("src", "/sample.mp4");
  expect(videos().live).toHaveAttribute("src", "/sample.mp4");
  expect(videos().diagnosis).toHaveAttribute("src", "/sample.mp4");
  expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
});

it("synchronizes embedded videos from the active video's time axis", () => {
  const onTimeChange = vi.fn();
  render(
    <Harness activeScreen="entry" sceneKey="default" src="/sample.mp4" onTimeChange={onTimeChange} />,
  );
  const current = videos();
  Object.values(current).forEach((video) => {
    setReady(video);
    video.currentTime = 0;
  });

  current.entry.currentTime = 4.5;
  fireEvent.timeUpdate(current.entry);

  expect(current.live.currentTime).toBe(4.5);
  expect(current.diagnosis.currentTime).toBe(4.5);
  expect(onTimeChange).toHaveBeenCalledWith(4.5);
});

it("keeps playback state and time when the page changes", () => {
  const externalVideoRef = createRef<HTMLVideoElement>();
  const { rerender } = render(
    <Harness
      activeScreen="entry"
      sceneKey="default"
      src="/sample.mp4"
      videoRef={externalVideoRef}
    />,
  );
  const current = videos();
  Object.values(current).forEach((video) => setReady(video));
  current.entry.currentTime = 7.25;
  current.entry.playbackRate = 1.5;
  vi.spyOn(current.entry, "paused", "get").mockReturnValue(false);
  fireEvent.play(current.entry);
  vi.mocked(current.entry.play).mockClear();
  vi.mocked(current.entry.pause).mockClear();

  rerender(
    <Harness
      activeScreen="live"
      sceneKey="default"
      src="/sample.mp4"
      videoRef={externalVideoRef}
    />,
  );

  expect(externalVideoRef.current).toBe(current.live);
  expect(current.live.currentTime).toBe(7.25);
  expect(current.live.playbackRate).toBe(1.5);
  expect(current.entry.load).not.toHaveBeenCalled();
  expect(current.live.load).not.toHaveBeenCalled();
  expect(current.diagnosis.load).not.toHaveBeenCalled();
  expect(current.live.play).toHaveBeenCalledOnce();
});

it("adds a synchronized report video only when its slot mounts without resetting the first three videos", () => {
  const { rerender } = render(
    <Harness activeScreen="diagnosis" sceneKey="default" src="/sample.mp4" />,
  );
  const original = videos();
  Object.values(original).forEach((video) => setReady(video));
  original.diagnosis.currentTime = 6.5;
  fireEvent.timeUpdate(original.diagnosis);

  rerender(
    <Harness activeScreen="report" sceneKey="default" src="/sample.mp4" reportMounted />,
  );

  const report = reportVideo();
  setReady(report);
  fireEvent.canPlay(report);
  expect(document.querySelectorAll("video")).toHaveLength(4);
  expect(videos().entry).toBe(original.entry);
  expect(videos().live).toBe(original.live);
  expect(videos().diagnosis).toBe(original.diagnosis);
  expect(report.currentTime).toBe(6.5);
  expect(original.entry.load).not.toHaveBeenCalled();
  expect(original.live.load).not.toHaveBeenCalled();
  expect(original.diagnosis.load).not.toHaveBeenCalled();

  rerender(
    <Harness activeScreen="diagnosis" sceneKey="default" src="/sample.mp4" reportMounted />,
  );
  expect(videos().diagnosis.currentTime).toBe(6.5);
});

it("applies an evidence seek to the shared timeline before returning to diagnosis", () => {
  const { rerender } = render(
    <Harness activeScreen="report" sceneKey="default" src="/sample.mp4" reportMounted />,
  );
  const current = videos();
  const report = reportVideo();
  [...Object.values(current), report].forEach((video) => setReady(video));

  rerender(
    <Harness activeScreen="report" sceneKey="default" src="/sample.mp4" reportMounted seekTime={7.25} />,
  );

  expect(report.currentTime).toBe(7.25);
  expect(current.diagnosis.currentTime).toBe(7.25);

  rerender(
    <Harness activeScreen="diagnosis" sceneKey="default" src="/sample.mp4" reportMounted seekTime={7.25} />,
  );
  expect(current.diagnosis.currentTime).toBe(7.25);
});

it("changes all embedded sources and resets all videos only when sceneKey changes", () => {
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="default" src="/sample.mp4" />,
  );
  const current = videos();
  Object.values(current).forEach((video) => {
    setReady(video);
    video.currentTime = 9;
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });
  });
  fireEvent.timeUpdate(current.live);

  rerender(
    <Harness activeScreen="live" sceneKey="scene-0061" src="/scenes/scene-0061/sample.mp4" />,
  );

  Object.values(current).forEach((video) => {
    expect(video).toHaveAttribute("src", "/scenes/scene-0061/sample.mp4");
    expect(video.currentTime).toBe(0);
    expect(video.load).toHaveBeenCalledTimes(3);
  });
  setSourceCompletion(current.live, "/scenes/scene-0061/sample.mp4");
  fireEvent.canPlay(current.live);
  expect(current.live.currentTime).toBe(0);
  expect(drawImage).toHaveBeenCalledTimes(3);
});

it("ignores a stale canplay event and starts the active scene after it is ready", () => {
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="scene-a" src="/scenes/a.mp4" />,
  );
  const current = videos();
  Object.values(current).forEach((video) => {
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });
  });

  rerender(<Harness activeScreen="live" sceneKey="scene-b" src="/scenes/b.mp4" />);
  setSourceCompletion(current.live, "/scenes/a.mp4");
  fireEvent.canPlay(current.live);
  expect(current.live.play).not.toHaveBeenCalled();

  setSourceCompletion(current.live, "/scenes/b.mp4", HTMLMediaElement.HAVE_CURRENT_DATA);
  fireEvent.canPlay(current.live);
  expect(current.live.play).not.toHaveBeenCalled();

  setSourceCompletion(current.live, "/scenes/b.mp4");
  fireEvent.canPlay(current.live);
  expect(current.live.play).toHaveBeenCalledOnce();
  expect(screen.getByTestId("cockpit-scene-freeze-live")).not.toBeVisible();
});

it("surfaces an active scene error and clears it when the replacement is ready", () => {
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="scene-a" src="/scenes/a.mp4" />,
  );
  const current = videos();
  Object.defineProperty(current.live, "videoWidth", { configurable: true, value: 1280 });
  Object.defineProperty(current.live, "videoHeight", { configurable: true, value: 720 });

  rerender(<Harness activeScreen="live" sceneKey="scene-b" src="/scenes/missing.mp4" />);
  setSourceCompletion(current.live, "/scenes/missing.mp4", HTMLMediaElement.HAVE_NOTHING);
  fireEvent.error(current.live);
  expect(screen.getByRole("alert")).toHaveTextContent("场景视频加载失败");

  rerender(<Harness activeScreen="diagnosis" sceneKey="scene-c" src="/scenes/c.mp4" />);
  const diagnosis = videos().diagnosis;
  setSourceCompletion(diagnosis, "/scenes/c.mp4");
  fireEvent.canPlay(diagnosis);

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(document.querySelectorAll("video")).toHaveLength(3);
});
