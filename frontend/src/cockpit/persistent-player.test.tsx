/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function Harness({
  activeScreen,
  sceneKey,
  src,
  onTimeChange = vi.fn(),
}: {
  activeScreen: CockpitScreen;
  sceneKey: string;
  src: string;
  onTimeChange?: (currentTime: number) => void;
}) {
  return (
    <>
      <div ref={slots.entry} data-testid="entry-slot" />
      <div ref={slots.live} data-testid="live-slot" />
      <div ref={slots.diagnosis} data-testid="diagnosis-slot" />
      <PersistentScenePlayer
        activeScreen={activeScreen}
        sceneKey={sceneKey}
        src={src}
        slots={slots}
        showDetections={false}
        objects={[]}
        onTimeChange={onTimeChange}
      />
    </>
  );
}

const drawImage = vi.fn();

beforeEach(() => {
  ResizeObserverDouble.instances = [];
  drawImage.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverDouble);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
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
  const entryObserver = ResizeObserverDouble.instances[0];

  rerender(<Harness activeScreen="live" sceneKey="default" src="/sample.mp4" />);

  expect(screen.getAllByTestId("persistent-scene-video")).toHaveLength(1);
  expect(document.querySelectorAll("video")).toHaveLength(1);
  expect(screen.getByTestId("persistent-scene-video")).toBe(video);
  expect(video.currentTime).toBe(7.25);
  expect(video.playbackRate).toBe(1.5);
  expect(video.paused).toBe(false);
  expect(video.load).not.toHaveBeenCalled();
  expect(entryObserver.disconnect).toHaveBeenCalledOnce();
  expect(ResizeObserverDouble.instances).toHaveLength(2);
  expect(ResizeObserverDouble.instances[1].observe).toHaveBeenCalledWith(slots.live.current);
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

  fireEvent.canPlay(video);
  expect(freeze.hidden).toBe(true);
});

it("tracks the active slot geometry, emits timeline changes, and cleans up observers", () => {
  const onTimeChange = vi.fn();
  const entryRect = {
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
  vi.spyOn(slots.entry.current!, "getBoundingClientRect").mockReturnValue(entryRect);

  act(() => ResizeObserverDouble.instances[0].trigger());

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

  const observer = ResizeObserverDouble.instances[0];
  view.unmount();
  expect(observer.disconnect).toHaveBeenCalledOnce();
});
