/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const motionMocks = vi.hoisted(() => ({
  fromTo: vi.fn(),
  registerPlugin: vi.fn(),
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

vi.mock("@gsap/react", async () => {
  const React = await import("react");
  return {
    useGSAP(callback: () => void | (() => void), options?: { dependencies?: readonly unknown[] }) {
      React.useLayoutEffect(callback, options?.dependencies ?? []);
    },
  };
});

import TextReveal from "./TextReveal";

beforeEach(() => {
  vi.clearAllMocks();
  motionMocks.fromTo.mockReturnValue({
    kill: motionMocks.tweenKill,
    scrollTrigger: { kill: motionMocks.triggerKill },
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("reveals one small-text block upward inside the nearest cockpit scroller", async () => {
  const view = render(
    <main className="cockpit-experience">
      <TextReveal tag="p" className="cockpit-screen__index" delay={0.1}>01 / 场景入口</TextReveal>
    </main>,
  );

  const text = screen.getByText("01 / 场景入口");
  expect(text).toHaveAttribute("data-text-reveal");
  await waitFor(() => expect(motionMocks.fromTo).toHaveBeenCalledTimes(1));
  expect(motionMocks.fromTo).toHaveBeenCalledWith(
    text,
    { autoAlpha: 0, y: 24 },
    expect.objectContaining({
      autoAlpha: 1,
      y: 0,
      duration: 0.65,
      ease: "power2.out",
      delay: 0.1,
      scrollTrigger: expect.objectContaining({
        scroller: view.container.querySelector(".cockpit-experience"),
        toggleActions: "restart none restart none",
      }),
    }),
  );
});

it("waits for the cockpit entry transition before revealing the first-page copy", async () => {
  const view = render(
    <main className="cockpit-experience">
      <TextReveal tag="p" enabled={false}>第一页说明</TextReveal>
    </main>,
  );

  await Promise.resolve();
  expect(motionMocks.fromTo).not.toHaveBeenCalled();

  view.rerender(
    <main className="cockpit-experience">
      <TextReveal tag="p" enabled>第一页说明</TextReveal>
    </main>,
  );

  await waitFor(() => expect(motionMocks.fromTo).toHaveBeenCalledTimes(1));
});
