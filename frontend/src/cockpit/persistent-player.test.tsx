/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersistentScenePlayer } from "./PersistentScenePlayer";
import type { CockpitScreen } from "./types";

class ResizeObserverDouble {
  static instances: ResizeObserverDouble[] = [];

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverDouble.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const slots = {
  entry: createRef<HTMLDivElement>(),
  live: createRef<HTMLDivElement>(),
  diagnosis: createRef<HTMLDivElement>(),
};

const scrollRoots = {
  first: createRef<HTMLDivElement>(),
  second: createRef<HTMLDivElement>(),
};

function Harness({
  activeScreen,
  sceneKey,
  src,
  onTimeChange = vi.fn(),
  scrollRoot = "first",
}: {
  activeScreen: CockpitScreen;
  sceneKey: string;
  src: string;
  onTimeChange?: (currentTime: number) => void;
  scrollRoot?: keyof typeof scrollRoots;
}) {
  return (
    <>
      <div ref={scrollRoots.first} data-testid="first-scroll-root" style={{ overflow: "auto" }}>
        <div ref={slots.entry} data-testid="entry-slot" />
        <div ref={slots.live} data-testid="live-slot" />
        <div ref={slots.diagnosis} data-testid="diagnosis-slot" />
      </div>
      <div ref={scrollRoots.second} data-testid="second-scroll-root" style={{ overflow: "auto" }} />
      <PersistentScenePlayer
        activeScreen={activeScreen}
        sceneKey={sceneKey}
        src={src}
        slots={slots}
        scrollRootRef={scrollRoots[scrollRoot]}
        showDetections={false}
        objects={[]}
        onTimeChange={onTimeChange}
      />
    </>
  );
}

const drawImage = vi.fn();

function setMediaCompletion(
  video: HTMLVideoElement,
  source: string,
  readyState: number = HTMLMediaElement.HAVE_FUTURE_DATA,
) {
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    value: source ? new URL(source, window.location.href).href : "",
  });
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: readyState,
  });
}

beforeEach(() => {
  ResizeObserverDouble.instances = [];
  drawImage.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverDouble);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the same physical video and playback state while the active screen changes", () => {
  const { rerender } = render(
    <Harness activeScreen="entry" sceneKey="default" src="/sample.mp4" />,
  );
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;
  Object.defineProperty(video, "currentTime", { value: 7.25, writable: true });
  Object.defineProperty(video, "playbackRate", { value: 1.5, writable: true });
  vi.spyOn(video, "paused", "get").mockReturnValue(false);
  const entryObserver = ResizeObserverDouble.instances.at(-1)!;
  const observerCount = ResizeObserverDouble.instances.length;
  expect(video).toHaveAttribute("autoplay");

  rerender(<Harness activeScreen="live" sceneKey="default" src="/sample.mp4" />);

  expect(screen.getAllByTestId("persistent-scene-video")).toHaveLength(1);
  expect(document.querySelectorAll("video")).toHaveLength(1);
  expect(screen.getByTestId("persistent-scene-video")).toBe(video);
  expect(video.currentTime).toBe(7.25);
  expect(video.playbackRate).toBe(1.5);
  expect(video.paused).toBe(false);
  expect(video.load).not.toHaveBeenCalled();
  expect(video.play).not.toHaveBeenCalled();
  expect(entryObserver.disconnect).toHaveBeenCalledOnce();
  expect(ResizeObserverDouble.instances).toHaveLength(observerCount + 1);
  expect(ResizeObserverDouble.instances.at(-1)!.observe).toHaveBeenCalledWith(slots.live.current);
});

it("ignores a source prop change until sceneKey changes", () => {
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="default" src="/sample.mp4" />,
  );
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;

  rerender(<Harness activeScreen="live" sceneKey="default" src="/unexpected.mp4" />);

  expect(video.getAttribute("src")).toBe("/sample.mp4");
  expect(video.load).not.toHaveBeenCalled();
});

it("captures a static frame, changes source, and resets only when sceneKey changes", () => {
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="default" src="/sample.mp4" />,
  );
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;
  const originalVideo = video;
  Object.defineProperty(video, "videoWidth", { value: 1280, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 720, configurable: true });
  Object.defineProperty(video, "currentTime", { value: 9, writable: true });

  rerender(
    <Harness
      activeScreen="diagnosis"
      sceneKey="scene-0061"
      src="/scenes/scene-0061/sample.mp4"
    />,
  );

  const freeze = screen.getByTestId("persistent-scene-freeze") as HTMLCanvasElement;
  expect(screen.getByTestId("persistent-scene-video")).toBe(originalVideo);
  expect(document.querySelectorAll("video")).toHaveLength(1);
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
  expect(freeze).toHaveAttribute("width", "1280");
  expect(freeze).toHaveAttribute("height", "720");
  expect(freeze.hidden).toBe(false);
  expect(video.getAttribute("src")).toBe("/scenes/scene-0061/sample.mp4");
  expect(video.currentTime).toBe(0);
  expect(video.load).toHaveBeenCalledOnce();

  setMediaCompletion(video, "/scenes/scene-0061/sample.mp4");
  fireEvent.canPlay(video);
  expect(freeze.hidden).toBe(true);
  expect(video.play).toHaveBeenCalledOnce();
});

it("tracks geometry from the internal scroll root and cleans up when that root changes", () => {
  const onTimeChange = vi.fn();
  let entryRect = {
    left: 16,
    top: 24,
    width: 640,
    height: 360,
    right: 656,
    bottom: 384,
    x: 16,
    y: 24,
    toJSON: () => ({}),
  };
  const view = render(
    <Harness
      activeScreen="entry"
      sceneKey="default"
      src="/sample.mp4"
      onTimeChange={onTimeChange}
    />,
  );
  vi.spyOn(slots.entry.current!, "getBoundingClientRect").mockImplementation(() => entryRect);

  fireEvent.scroll(screen.getByTestId("first-scroll-root"));

  const player = screen.getByTestId("persistent-scene-player");
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;
  video.currentTime = 4.5;
  fireEvent.timeUpdate(video);
  expect(player).toHaveStyle({
    left: "16px",
    top: "24px",
    width: "640px",
    height: "360px",
    borderRadius: "8px",
  });
  expect(onTimeChange).toHaveBeenCalledWith(4.5);

  entryRect = { ...entryRect, left: 48, right: 688 };
  fireEvent.scroll(screen.getByTestId("first-scroll-root"));
  expect(player).toHaveStyle({ left: "48px" });

  const observer = ResizeObserverDouble.instances.at(-1)!;
  const firstRoot = scrollRoots.first.current!;
  const removeEventListener = vi.spyOn(firstRoot, "removeEventListener");
  view.rerender(
    <Harness
      activeScreen="entry"
      sceneKey="default"
      src="/sample.mp4"
      onTimeChange={onTimeChange}
      scrollRoot="second"
    />,
  );
  expect(removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  expect(observer.disconnect).toHaveBeenCalledOnce();

  const activeObserver = ResizeObserverDouble.instances.at(-1)!;
  view.unmount();
  expect(activeObserver.disconnect).toHaveBeenCalledOnce();
});

it("ignores a stale canplay completion during a rapid B to C scene change", () => {
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="scene-a" src="/scenes/a.mp4" />,
  );
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;
  Object.defineProperty(video, "videoWidth", { value: 1280, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 720, configurable: true });
  let completedSource = "";
  let readyState: number = HTMLMediaElement.HAVE_NOTHING;
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    get: () => completedSource,
  });
  Object.defineProperty(video, "readyState", {
    configurable: true,
    get: () => readyState,
  });

  rerender(<Harness activeScreen="live" sceneKey="scene-b" src="/scenes/b.mp4" />);
  rerender(<Harness activeScreen="live" sceneKey="scene-c" src="/scenes/c.mp4" />);

  const freeze = screen.getByTestId("persistent-scene-freeze") as HTMLCanvasElement;
  readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
  fireEvent.canPlay(video);
  expect(freeze.hidden).toBe(false);
  expect(video.play).not.toHaveBeenCalled();

  completedSource = new URL("/scenes/c.mp4", window.location.href).href;
  readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
  fireEvent.canPlay(video);
  expect(freeze.hidden).toBe(false);
  expect(video.play).not.toHaveBeenCalled();

  readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
  fireEvent.canPlay(video);
  expect(freeze.hidden).toBe(true);
  expect(video.play).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(0);
  expect(video.load).toHaveBeenCalledTimes(2);
});

it("absorbs an autoplay rejection after the current scene becomes playable", async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
    new DOMException("autoplay blocked", "NotAllowedError"),
  );
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="scene-a" src="/scenes/a.mp4" />,
  );
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;

  rerender(<Harness activeScreen="live" sceneKey="scene-b" src="/scenes/b.mp4" />);
  setMediaCompletion(video, "/scenes/b.mp4");
  fireEvent.canPlay(video);
  await Promise.resolve();

  expect(video.play).toHaveBeenCalledOnce();
  expect(screen.getByTestId("persistent-scene-freeze")).not.toBeVisible();
});

it("surfaces a scene error, keeps the last frame, and recovers with one video", () => {
  const { rerender } = render(
    <Harness activeScreen="live" sceneKey="scene-a" src="/scenes/a.mp4" />,
  );
  const video = screen.getByTestId("persistent-scene-video") as HTMLVideoElement;
  Object.defineProperty(video, "videoWidth", { value: 1280, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 720, configurable: true });

  rerender(<Harness activeScreen="live" sceneKey="scene-b" src="/scenes/missing.mp4" />);
  setMediaCompletion(video, "/scenes/missing.mp4", HTMLMediaElement.HAVE_NOTHING);
  fireEvent.error(video);

  expect(screen.getByRole("alert")).toHaveTextContent("场景视频加载失败");
  expect(screen.getByTestId("persistent-scene-freeze")).toBeVisible();
  expect(document.querySelectorAll("video")).toHaveLength(1);

  rerender(<Harness activeScreen="diagnosis" sceneKey="scene-c" src="/scenes/c.mp4" />);
  setMediaCompletion(video, "/scenes/c.mp4");
  fireEvent.canPlay(video);

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByTestId("persistent-scene-freeze")).not.toBeVisible();
  expect(document.querySelectorAll("video")).toHaveLength(1);
});
