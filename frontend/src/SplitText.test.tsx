/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const motionMocks = vi.hoisted(() => ({
  fromTo: vi.fn(),
  registerPlugin: vi.fn(),
  splitConstruct: vi.fn(),
  splitRevert: vi.fn(),
  tweenKill: vi.fn(),
  triggerKill: vi.fn(),
}));

vi.mock("gsap", () => ({
  gsap: {
    fromTo: motionMocks.fromTo,
    registerPlugin: motionMocks.registerPlugin,
  },
}));

vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: { name: "ScrollTrigger" } }));

vi.mock("gsap/SplitText", () => ({
  SplitText: class SplitTextMock {
    chars: Element[];
    words: Element[] = [];
    lines: Element[] = [];

    constructor(element: HTMLElement, options: { onSplit?: (self: SplitTextMock) => void }) {
      this.chars = Array.from(element.textContent ?? "")
        .filter((character) => character.trim())
        .map(() => document.createElement("span"));
      motionMocks.splitConstruct(element, options);
      options.onSplit?.(this);
    }

    revert() {
      motionMocks.splitRevert();
    }
  },
}));

vi.mock("@gsap/react", async () => {
  const React = await import("react");
  return {
    useGSAP(callback: () => void | (() => void), options?: { dependencies?: readonly unknown[] }) {
      React.useLayoutEffect(callback, options?.dependencies ?? []);
    },
  };
});

import SplitText from "./SplitText";

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  motionMocks.fromTo.mockReturnValue({
    kill: motionMocks.tweenKill,
    scrollTrigger: { kill: motionMocks.triggerKill },
  });
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery(false)));
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { status: "loaded", ready: Promise.resolve() },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("preserves rich heading semantics and applies the React Bits character motion", async () => {
  const view = render(
    <main className="showcase">
      <SplitText tag="h1" ariaLabel="安全需要过程可信">
        <span>安全需要</span><em>过程可信</em>
      </SplitText>
    </main>,
  );

  const heading = screen.getByRole("heading", { level: 1, name: "安全需要过程可信" });
  expect(heading).toHaveAttribute("data-split-text");
  expect(heading.querySelector("em")).toHaveTextContent("过程可信");
  await waitFor(() => expect(motionMocks.fromTo).toHaveBeenCalledTimes(1));
  expect(motionMocks.fromTo).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ opacity: 0, y: 40 }),
    expect.objectContaining({
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "elastic.out(1, 0.3)",
      stagger: 0.045,
      scrollTrigger: expect.objectContaining({
        trigger: heading,
        scroller: view.container.querySelector(".showcase"),
        toggleActions: "restart none restart none",
      }),
    }),
  );

  view.unmount();
  expect(motionMocks.triggerKill).toHaveBeenCalledTimes(1);
  expect(motionMocks.tweenKill).toHaveBeenCalledTimes(1);
  expect(motionMocks.splitRevert).toHaveBeenCalledTimes(1);
});

it("renders static original text for reduced-motion users", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery(true)));
  render(<SplitText tag="h2" text="静态标题" ariaLabel="静态标题" />);

  expect(screen.getByRole("heading", { level: 2, name: "静态标题" })).toHaveTextContent("静态标题");
  await Promise.resolve();
  expect(motionMocks.splitConstruct).not.toHaveBeenCalled();
  expect(motionMocks.fromTo).not.toHaveBeenCalled();
});
