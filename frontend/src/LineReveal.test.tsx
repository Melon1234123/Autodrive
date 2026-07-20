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

import LineReveal from "./LineReveal";

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

it("replays cockpit headline lines in top-to-bottom order", async () => {
  const view = render(
    <main className="cockpit-experience">
      <LineReveal tag="h1" label="上行下行" lines={[<>上行</>, <>下行</>]} />
    </main>,
  );

  const heading = screen.getByRole("heading", { name: "上行下行" });
  const lines = Array.from(heading.querySelectorAll("[data-motion-line]"));
  await waitFor(() => expect(motionMocks.fromTo).toHaveBeenCalledTimes(1));
  expect(motionMocks.fromTo).toHaveBeenCalledWith(
    lines,
    { yPercent: 112, scaleY: .82 },
    expect.objectContaining({
      yPercent: 0,
      scaleY: 1,
      duration: 1.22,
      stagger: .09,
      ease: "power4.out",
      scrollTrigger: expect.objectContaining({
        trigger: heading,
        scroller: view.container.querySelector(".cockpit-experience"),
        toggleActions: "restart none restart none",
      }),
    }),
  );
});

it("waits for the cockpit entry transition before starting the first headline", async () => {
  const view = render(
    <main className="cockpit-experience">
      <LineReveal tag="h1" label="第一页" lines={[<>第一页</>]} enabled={false} />
    </main>,
  );

  await Promise.resolve();
  expect(motionMocks.fromTo).not.toHaveBeenCalled();

  view.rerender(
    <main className="cockpit-experience">
      <LineReveal tag="h1" label="第一页" lines={[<>第一页</>]} enabled />
    </main>,
  );

  await waitFor(() => expect(motionMocks.fromTo).toHaveBeenCalledTimes(1));
});
