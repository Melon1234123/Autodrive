/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { StrictMode, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TerrainBackdrop from "./TerrainBackdrop";
import { resolveTerrainTarget } from "./terrain-presets";

const threeMocks = vi.hoisted(() => ({
  shouldThrow: false,
  shaderShouldFail: false,
  onscreenRender: vi.fn(),
  probeRender: vi.fn(),
  setRenderTarget: vi.fn(),
  probeTargetDispose: vi.fn(),
  setPixelRatio: vi.fn(),
  setSize: vi.fn(),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
  compile: vi.fn(),
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderTarget: vi.fn(() => ({ dispose: threeMocks.probeTargetDispose })),
    WebGLRenderer: vi.fn(() => {
      if (threeMocks.shouldThrow) throw new Error("WebGL unavailable");
      let renderTarget: unknown = null;
      const debug: { checkShaderErrors: boolean; onShaderError: (() => void) | null } = {
        checkShaderErrors: true,
        onShaderError: null,
      };
      return {
        debug,
        setClearColor: vi.fn(),
        setPixelRatio: threeMocks.setPixelRatio,
        setSize: threeMocks.setSize,
        setRenderTarget: (target: unknown) => {
          renderTarget = target;
          threeMocks.setRenderTarget(target);
        },
        render: (...args: unknown[]) => {
          if (renderTarget === null) threeMocks.onscreenRender(...args);
          else threeMocks.probeRender(...args);
          if (threeMocks.shaderShouldFail) debug.onShaderError?.();
        },
        compile: threeMocks.compile,
        dispose: threeMocks.dispose,
        forceContextLoss: threeMocks.forceContextLoss,
      };
    }),
  };
});

let rafCallback: FrameRequestCallback | null = null;
const cancelAnimationFrameMock = vi.fn();
const disconnectResize = vi.fn();
let reducedMotion = false;
let motionCallback: ((event: MediaQueryListEvent) => void) | null = null;
let documentHidden = false;
let nowMs = 1000;

beforeEach(() => {
  threeMocks.shouldThrow = false;
  threeMocks.shaderShouldFail = false;
  threeMocks.onscreenRender.mockClear();
  threeMocks.probeRender.mockClear();
  threeMocks.setRenderTarget.mockClear();
  threeMocks.probeTargetDispose.mockClear();
  threeMocks.setPixelRatio.mockClear();
  threeMocks.setSize.mockClear();
  threeMocks.dispose.mockClear();
  threeMocks.forceContextLoss.mockClear();
  threeMocks.compile.mockClear();
  documentHidden = false;
  nowMs = 1000;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(document, "hidden", "get").mockImplementation(() => documentHidden);
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    rafCallback = callback;
    return 17;
  }));
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() { disconnectResize(); }
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: reducedMotion,
    addEventListener: vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => {
      motionCallback = callback;
    }),
    removeEventListener: vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => {
      if (motionCallback === callback) motionCallback = null;
    }),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  reducedMotion = false;
  rafCallback = null;
  motionCallback = null;
});

function latestColor0() {
  const scene = threeMocks.onscreenRender.mock.calls.at(-1)?.[0] as THREE.Scene;
  const mesh = scene.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  return (mesh.material.uniforms.uColor0.value as THREE.Color).toArray();
}

function latestDrift() {
  const scene = threeMocks.onscreenRender.mock.calls.at(-1)?.[0] as THREE.Scene;
  const mesh = scene.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  return mesh.material.uniforms.uDrift.value as number;
}

describe("TerrainBackdrop", () => {
  it("mounts one inert WebGL canvas with a stable instance id", () => {
    const { rerender } = render(createElement(TerrainBackdrop, { view: "showcase", preset: "hidden", risk: "unknown" }));
    const canvas = screen.getByTestId("terrain-backdrop-canvas");
    const instanceId = canvas.parentElement?.dataset.instanceId;
    rerender(createElement(TerrainBackdrop, { view: "dashboard", preset: "closing", risk: "high" }));
    expect(screen.getAllByTestId("terrain-backdrop-canvas")).toHaveLength(1);
    expect(screen.getByTestId("terrain-backdrop-canvas").parentElement?.dataset.instanceId).toBe(instanceId);
    expect(getComputedStyle(canvas.parentElement as Element).pointerEvents).toBe("none");
  });

  it("does not render the initial showcase hidden preset", () => {
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "hidden", risk: "unknown" }));
    expect(THREE.WebGLRenderTarget).toHaveBeenCalledWith(1, 1);
    expect(threeMocks.probeRender).toHaveBeenCalledTimes(1);
    expect(threeMocks.onscreenRender).not.toHaveBeenCalled();
    expect(threeMocks.setRenderTarget).toHaveBeenNthCalledWith(1, expect.anything());
    expect(threeMocks.setRenderTarget).toHaveBeenNthCalledWith(2, null);
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
  });

  it("throttles the first RAF against the synchronous visible frame", () => {
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    expect(threeMocks.onscreenRender).toHaveBeenCalledTimes(1);
    rafCallback?.(nowMs + 16);
    expect(threeMocks.onscreenRender).toHaveBeenCalledTimes(1);
    rafCallback?.(nowMs + 34);
    expect(threeMocks.onscreenRender).toHaveBeenCalledTimes(2);
  });

  it("keeps a 30 fps cadence on a 120 Hz animation clock", () => {
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    for (let step = 1; step <= 120; step += 1) rafCallback?.(nowMs + step * (1000 / 120));
    expect(threeMocks.onscreenRender.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(threeMocks.onscreenRender.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it("uses a static fallback when WebGL construction fails", () => {
    threeMocks.shouldThrow = true;
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    expect(screen.getByTestId("terrain-backdrop")).toHaveAttribute("data-state", "fallback");
    expect(console.warn).toHaveBeenCalledWith("Terrain backdrop fell back to a static image", expect.any(Error));
  });

  it("uses a static fallback when the shader fails on first use", () => {
    threeMocks.shaderShouldFail = true;
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    expect(screen.getByTestId("terrain-backdrop")).toHaveAttribute("data-state", "fallback");
    expect(threeMocks.dispose).toHaveBeenCalled();
    expect(threeMocks.forceContextLoss).toHaveBeenCalled();
    expect(threeMocks.probeRender).toHaveBeenCalledTimes(1);
    expect(threeMocks.onscreenRender).not.toHaveBeenCalled();
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("Terrain backdrop fell back to a static image", expect.any(Error));
  });

  it("falls back from a hidden preset shader probe without an onscreen submission", () => {
    threeMocks.shaderShouldFail = true;
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "hidden", risk: "unknown" }));
    expect(screen.getByTestId("terrain-backdrop")).toHaveAttribute("data-state", "fallback");
    expect(threeMocks.probeRender).toHaveBeenCalledTimes(1);
    expect(threeMocks.onscreenRender).not.toHaveBeenCalled();
    expect(threeMocks.setRenderTarget).toHaveBeenNthCalledWith(1, expect.anything());
    expect(threeMocks.setRenderTarget).toHaveBeenNthCalledWith(2, null);
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("Terrain backdrop fell back to a static image", expect.any(Error));
    view.unmount();
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
  });

  it("falls back from a hidden-tab shader probe without an onscreen submission", () => {
    documentHidden = true;
    threeMocks.shaderShouldFail = true;
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    expect(screen.getByTestId("terrain-backdrop")).toHaveAttribute("data-state", "fallback");
    expect(threeMocks.probeRender).toHaveBeenCalledTimes(1);
    expect(threeMocks.onscreenRender).not.toHaveBeenCalled();
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("Terrain backdrop fell back to a static image", expect.any(Error));
    view.unmount();
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
  });

  it("falls back after a WebGL context loss", () => {
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    fireEvent(screen.getByTestId("terrain-backdrop-canvas"), new Event("webglcontextlost", { cancelable: true }));
    expect(screen.getByTestId("terrain-backdrop")).toHaveAttribute("data-state", "fallback");
    expect(console.warn).toHaveBeenCalledWith("Terrain backdrop fell back to a static image", expect.any(Error));
  });

  it("keeps context loss terminal when a queued motion event arrives", () => {
    const geometryDispose = vi.spyOn(THREE.PlaneGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.ShaderMaterial.prototype, "dispose");
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    const queuedMotionCallback = motionCallback;
    const scheduledFrames = vi.mocked(requestAnimationFrame).mock.calls.length;
    fireEvent(screen.getByTestId("terrain-backdrop-canvas"), new Event("webglcontextlost", { cancelable: true }));
    queuedMotionCallback?.({ matches: false } as MediaQueryListEvent);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(scheduledFrames);
    expect(disconnectResize).toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(threeMocks.dispose).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("Terrain backdrop fell back to a static image", expect.any(Error));
  });

  it("renders once without scheduling a loop under reduced motion", () => {
    reducedMotion = true;
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    expect(threeMocks.onscreenRender).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("does not rewind a snapped target when reduced motion is disabled", () => {
    reducedMotion = true;
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    nowMs += 40;
    view.rerender(createElement(TerrainBackdrop, { view: "showcase", preset: "pain", risk: "unknown" }));
    const snappedColor = latestColor0();
    motionCallback?.({ matches: false } as MediaQueryListEvent);
    rafCallback?.(performance.now() + 40);
    expect(latestColor0()).toEqual(snappedColor);
  });

  it("does not force a live canvas context during StrictMode effect replay", () => {
    const view = render(createElement(
      StrictMode,
      null,
      createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }),
    ));
    expect(screen.getByTestId("terrain-backdrop")).toHaveAttribute("data-state", "webgl");
    expect(threeMocks.forceContextLoss).not.toHaveBeenCalled();
    view.unmount();
    expect(threeMocks.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it("does not submit frames while the browser tab is hidden", () => {
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    rafCallback?.(nowMs + 40);
    const visibleRenderCount = threeMocks.onscreenRender.mock.calls.length;
    documentHidden = true;
    rafCallback?.(nowMs + 80);
    expect(threeMocks.onscreenRender).toHaveBeenCalledTimes(visibleRenderCount);
    documentHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    rafCallback?.(nowMs + 120);
    expect(threeMocks.onscreenRender.mock.calls.length).toBeGreaterThan(visibleRenderCount);
  });

  it("does not render on initial mount while the browser tab is hidden", () => {
    documentHidden = true;
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    expect(threeMocks.onscreenRender).not.toHaveBeenCalled();
  });

  it("blocks reduced-motion prop and motion submissions while hidden", () => {
    documentHidden = true;
    reducedMotion = true;
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    view.rerender(createElement(TerrainBackdrop, { view: "showcase", preset: "pain", risk: "unknown" }));
    motionCallback?.({ matches: false } as MediaQueryListEvent);
    rafCallback?.(nowMs + 40);
    motionCallback?.({ matches: true } as MediaQueryListEvent);
    expect(threeMocks.onscreenRender).not.toHaveBeenCalled();
  });

  it("caps desktop DPR at 1.25 and mobile DPR at 1", () => {
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("devicePixelRatio", 3);
    render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    expect(threeMocks.setPixelRatio).toHaveBeenLastCalledWith(1.25);
    vi.stubGlobal("innerWidth", 480);
    window.dispatchEvent(new Event("resize"));
    expect(threeMocks.setPixelRatio).toHaveBeenLastCalledWith(1);
  });

  it("reaches the exact target uniforms after the 700 millisecond transition", () => {
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    view.rerender(createElement(TerrainBackdrop, { view: "showcase", preset: "pain", risk: "unknown" }));
    const expectedColor = [...resolveTerrainTarget("showcase", "pain", "unknown").colors[0]];
    for (let step = 1; step <= 6; step += 1) rafCallback?.(nowMs + step * 100);
    expect(latestColor0()).not.toEqual(expectedColor);
    rafCallback?.(nowMs + 700);
    expect(latestColor0()).toEqual(expectedColor);
  });

  it("integrates drift without uptime-amplified phase jumps when speed changes", () => {
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    for (let step = 1; step <= 1200; step += 1) rafCallback?.(nowMs + step * 100);
    const beforeTransition = latestDrift();
    view.rerender(createElement(TerrainBackdrop, { view: "showcase", preset: "pain", risk: "unknown" }));
    for (let step = 1; step <= 7; step += 1) rafCallback?.(nowMs + 120000 + step * 100);
    const afterTransition = latestDrift();
    expect(afterTransition).toBeGreaterThan(beforeTransition);
    expect(afterTransition - beforeTransition).toBeLessThan(0.05);
  });

  it("releases animation, observers, geometry, material and renderer on cleanup", () => {
    const geometryDispose = vi.spyOn(THREE.PlaneGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.ShaderMaterial.prototype, "dispose");
    const view = render(createElement(TerrainBackdrop, { view: "showcase", preset: "positioning", risk: "unknown" }));
    rafCallback?.(nowMs + 40);
    view.unmount();
    expect(cancelAnimationFrameMock).toHaveBeenCalled();
    expect(disconnectResize).toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(threeMocks.probeTargetDispose).toHaveBeenCalledTimes(1);
    expect(threeMocks.dispose).toHaveBeenCalled();
    expect(threeMocks.forceContextLoss).toHaveBeenCalled();
  });
});
