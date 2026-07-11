/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";

type ContextLoss = { loseContext: () => void };
type RendererState = { render: () => void };

vi.doMock("ogl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ogl")>();
  (globalThis as typeof globalThis & { softAuroraContextLoss: ContextLoss }).softAuroraContextLoss = {
    loseContext: () => undefined,
  };
  (globalThis as typeof globalThis & { softAuroraRendererState: RendererState }).softAuroraRendererState = {
    render: () => undefined,
  };

  class Renderer {
    gl = {
      canvas: document.createElement("canvas"),
      clearColor: () => undefined,
      getExtension: () => (globalThis as typeof globalThis & { softAuroraContextLoss: ContextLoss }).softAuroraContextLoss,
    };

    setSize(width: number, height: number) {
      this.gl.canvas.width = width;
      this.gl.canvas.height = height;
    }

    render = () => (globalThis as typeof globalThis & { softAuroraRendererState: RendererState }).softAuroraRendererState.render();
  }

  class Program {
    uniforms: Record<string, { value: unknown }>;

    constructor(_gl: unknown, options: { uniforms: Record<string, { value: unknown }> }) {
      this.uniforms = options.uniforms;
    }
  }

  return {
    ...actual,
    Renderer,
    Program,
    Mesh: class Mesh {},
    Triangle: class Triangle {},
  };
});

const { default: SoftAurora } = await import("./SoftAurora");

let loseContext: MockInstance;
let renderFrame: MockInstance;
let mediaQuery: MediaQueryList;
let mediaChangeListener: ((event: MediaQueryListEvent) => void) | undefined;
let nextFrameId: number;
let frameCallbacks: Map<number, FrameRequestCallback>;
let requestFrame: MockInstance;
let cancelFrame: MockInstance;

beforeEach(() => {
  const contextLoss = (globalThis as typeof globalThis & { softAuroraContextLoss: ContextLoss }).softAuroraContextLoss;
  loseContext = vi.spyOn(contextLoss, "loseContext");
  const rendererState = (globalThis as typeof globalThis & { softAuroraRendererState: RendererState }).softAuroraRendererState;
  renderFrame = vi.spyOn(rendererState, "render");
  mediaChangeListener = undefined;
  mediaQuery = {
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      mediaChangeListener = listener as (event: MediaQueryListEvent) => void;
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  nextFrameId = 1;
  frameCallbacks = new Map();
  requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameCallbacks.set(id, callback);
    return id;
  });
  cancelFrame = vi.fn((id: number) => frameCallbacks.delete(id));
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("mounts one aurora canvas and releases it on unmount", () => {
  const { unmount } = render(createElement(SoftAurora, { enableMouseInteraction: false }));
  expect(document.querySelectorAll(".soft-aurora-container canvas")).toHaveLength(1);
  unmount();
  expect(document.querySelector(".soft-aurora-container canvas")).toBeNull();
  expect(loseContext).toHaveBeenCalledOnce();
});

it("stops and resumes one animation loop when reduced motion changes", () => {
  Object.defineProperty(mediaQuery, "matches", { value: false, writable: true });
  const { unmount } = render(createElement(SoftAurora, { enableMouseInteraction: false }));

  expect(mediaQuery.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  expect(requestFrame).toHaveBeenCalledOnce();

  const firstFrame = frameCallbacks.get(1);
  expect(firstFrame).toBeDefined();
  frameCallbacks.delete(1);
  firstFrame?.(16);
  expect(requestFrame).toHaveBeenCalledTimes(2);
  expect(renderFrame).toHaveBeenCalledOnce();

  Object.defineProperty(mediaQuery, "matches", { value: true, writable: true });
  mediaChangeListener?.({ matches: true } as MediaQueryListEvent);
  expect(cancelFrame).toHaveBeenCalledWith(2);
  expect(requestFrame).toHaveBeenCalledTimes(2);
  expect(renderFrame).toHaveBeenCalledTimes(2);

  Object.defineProperty(mediaQuery, "matches", { value: false, writable: true });
  mediaChangeListener?.({ matches: false } as MediaQueryListEvent);
  expect(requestFrame).toHaveBeenCalledTimes(3);
  mediaChangeListener?.({ matches: false } as MediaQueryListEvent);
  expect(requestFrame).toHaveBeenCalledTimes(3);

  unmount();
  expect(cancelFrame).toHaveBeenCalledWith(3);
  expect(mediaQuery.removeEventListener).toHaveBeenCalledWith("change", mediaChangeListener);
});
