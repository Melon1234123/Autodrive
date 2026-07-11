/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";

type ContextLoss = { loseContext: () => void };

vi.doMock("ogl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ogl")>();
  (globalThis as typeof globalThis & { softAuroraContextLoss: ContextLoss }).softAuroraContextLoss = {
    loseContext: () => undefined,
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

    render = () => undefined;
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

beforeEach(() => {
  const contextLoss = (globalThis as typeof globalThis & { softAuroraContextLoss: ContextLoss }).softAuroraContextLoss;
  loseContext = vi.spyOn(contextLoss, "loseContext");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
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
