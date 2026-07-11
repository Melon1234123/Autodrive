/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { StrictMode, useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const motionMocks = vi.hoisted(() => {
  const timelineOptions: Array<Record<string, unknown>> = [];
  const makeTimeline = (options: Record<string, unknown> = {}) => {
    timelineOptions.push(options);
    const chain = {
      fromTo: vi.fn(),
      set: vi.fn(),
    };
    chain.fromTo.mockImplementation(() => {
      if (motionMocks.throwOnTween) throw new Error("tween init failed");
      return chain;
    });
    chain.set.mockReturnValue(chain);
    return chain;
  };

  return {
    contextRevert: vi.fn(),
    gsapContext: vi.fn((callback: () => void, _scope?: Element) => {
      callback();
      return { revert: motionMocks.contextRevert };
    }),
    gsapDefaults: vi.fn(),
    gsapKillTweensOf: vi.fn(),
    gsapSet: vi.fn((targets: Iterable<HTMLElement> | HTMLElement, options: Record<string, unknown>) => {
      if (typeof options.clearProps !== "string") return;
      const elements = targets instanceof HTMLElement ? [targets] : Array.from(targets);
      for (const element of elements) {
        element.style.transform = "";
        element.style.opacity = "";
        element.style.visibility = "";
        element.style.clipPath = "";
        element.style.willChange = "";
      }
    }),
    gsapFromTo: vi.fn(),
    makeTimeline,
    timelineOptions,
    tickerAdd: vi.fn(),
    tickerRemove: vi.fn(),
    scrollUpdate: vi.fn(),
    scrollRefresh: vi.fn(),
    scrollKillAll: vi.fn(),
    lenisConstruct: vi.fn(),
    lenisOn: vi.fn(),
    lenisStop: vi.fn(),
    lenisStart: vi.fn(),
    lenisRaf: vi.fn(),
    lenisScrollTo: vi.fn(),
    lenisDestroy: vi.fn(),
    unsubscribe: vi.fn(),
    throwOnContext: false,
    throwOnTween: false,
  };
});

vi.mock("gsap", () => ({
  gsap: {
    registerPlugin: vi.fn(),
    context: (callback: () => void, scope?: Element) => {
      if (motionMocks.throwOnContext) throw new Error("motion init failed");
      return motionMocks.gsapContext(callback, scope);
    },
    defaults: motionMocks.gsapDefaults,
    killTweensOf: motionMocks.gsapKillTweensOf,
    set: motionMocks.gsapSet,
    fromTo: motionMocks.gsapFromTo,
    timeline: motionMocks.makeTimeline,
    ticker: { add: motionMocks.tickerAdd, remove: motionMocks.tickerRemove },
  },
}));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: {
    update: motionMocks.scrollUpdate,
    refresh: motionMocks.scrollRefresh,
    killAll: motionMocks.scrollKillAll,
  },
}));

vi.mock("lenis", () => ({
  default: class LenisMock {
    constructor(options: unknown) { motionMocks.lenisConstruct(options); }
    on(event: string, callback: unknown) { motionMocks.lenisOn(event, callback); return motionMocks.unsubscribe; }
    stop() { motionMocks.lenisStop(); }
    start() { motionMocks.lenisStart(); }
    raf(time: number) { motionMocks.lenisRaf(time); }
    scrollTo(target: HTMLElement, options: unknown) { motionMocks.lenisScrollTo(target, options); }
    destroy() { motionMocks.lenisDestroy(); }
  },
}));

import ShowcaseOpening from "./ShowcaseOpening";
import { useShowcaseMotion } from "./useShowcaseMotion";

function installMatchMedia({ reduced, desktop }: { reduced: boolean; desktop: boolean }) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : desktop,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function Harness({
  playOpening = true,
  onOpeningComplete = vi.fn(),
  seedHiddenStyles = false,
  includeHeroMedia = true,
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  useShowcaseMotion({ rootRef, playOpening, onOpeningComplete });

  return (
    <main ref={rootRef}>
      <ShowcaseOpening />
      <nav><div className="showcase-nav-glass" /></nav>
      <div data-lenis-content>
        <section className="showcase-hero" data-motion-hero>
          <div className="kicker" />
          <div data-motion-line />
          {includeHeroMedia && <video data-motion-hero-media />}
        </section>
        <section data-motion-section>
          <div data-motion-index />
          <div data-motion-line />
          <p
            data-motion-copy
            style={seedHiddenStyles ? {
              clipPath: "inset(100% 0 0 0)",
              opacity: 0,
              transform: "translateY(44px)",
              visibility: "hidden",
            } : undefined}
          />
        </section>
        <section id="product" />
      </div>
      <a href="#product">产品体系</a>
      <a href="mailto:test@example.com">联系</a>
    </main>
  );
}

function openingCompletions() {
  return motionMocks.timelineOptions.flatMap((options) => (
    typeof options.onComplete === "function" ? [options.onComplete as () => void] : []
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  motionMocks.timelineOptions.length = 0;
  motionMocks.throwOnContext = false;
  motionMocks.throwOnTween = false;
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 17));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("skips all motion under reduced motion and resolves opening once in StrictMode", () => {
  installMatchMedia({ reduced: true, desktop: true });
  const complete = vi.fn();
  const view = render(<StrictMode><Harness onOpeningComplete={complete} /></StrictMode>);

  expect(motionMocks.lenisConstruct).not.toHaveBeenCalled();
  expect(motionMocks.gsapContext).not.toHaveBeenCalled();
  expect(view.container.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(complete).toHaveBeenCalledTimes(1);
});

it("also skips motion outside the desktop fine-pointer gate", () => {
  installMatchMedia({ reduced: false, desktop: false });
  const complete = vi.fn();
  render(<Harness onOpeningComplete={complete} />);

  expect(motionMocks.lenisConstruct).not.toHaveBeenCalled();
  expect(motionMocks.gsapContext).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledTimes(1);
});

it("uses the opening preference captured on mount", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness playOpening={false} onOpeningComplete={complete} />);

  view.rerender(<Harness playOpening onOpeningComplete={complete} />);

  expect(motionMocks.lenisStop).not.toHaveBeenCalled();
  expect(openingCompletions()).toHaveLength(0);
  expect(complete).not.toHaveBeenCalled();
});

it("finishes the opening fallback when the optional hero media is absent", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness includeHeroMedia={false} onOpeningComplete={complete} />);
  const root = view.container.querySelector("main") as HTMLElement;

  expect(motionMocks.lenisStop).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisStart).toHaveBeenCalledTimes(1);
  expect(root).not.toHaveClass("showcase-opening-active");
  expect(root.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(complete).toHaveBeenCalledTimes(1);
});

it("creates one root-scoped synchronized runtime, handles anchors, and cleans up", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness onOpeningComplete={complete} />);
  const root = view.container.querySelector("main") as HTMLElement;
  const content = root.querySelector("[data-lenis-content]");

  expect(motionMocks.lenisConstruct).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisConstruct).toHaveBeenCalledWith(expect.objectContaining({
    wrapper: root,
    content,
    autoRaf: false,
  }));
  expect(motionMocks.lenisOn).toHaveBeenCalledWith("scroll", motionMocks.scrollUpdate);
  expect(motionMocks.gsapContext).toHaveBeenCalledWith(expect.any(Function), root);
  expect(motionMocks.lenisStop).toHaveBeenCalledTimes(1);
  expect(motionMocks.tickerAdd).toHaveBeenCalledTimes(1);

  const ticker = motionMocks.tickerAdd.mock.calls[0][0] as (time: number) => void;
  ticker(1.25);
  expect(motionMocks.lenisRaf).toHaveBeenCalledWith(1250);

  const timelineTriggers = motionMocks.timelineOptions.flatMap((options) => {
    const scrollTrigger = options.scrollTrigger as Record<string, unknown> | undefined;
    return scrollTrigger ? [scrollTrigger] : [];
  });
  expect(timelineTriggers.length).toBeGreaterThan(0);
  expect(timelineTriggers.every((trigger) => trigger.scroller === root)).toBe(true);
  const directTriggers = motionMocks.gsapFromTo.mock.calls.flatMap((call) => {
    const scrollTrigger = (call[2] as { scrollTrigger?: Record<string, unknown> } | undefined)?.scrollTrigger;
    return scrollTrigger ? [scrollTrigger] : [];
  });
  expect(directTriggers.length).toBeGreaterThan(0);
  expect(directTriggers.every((trigger) => trigger.scroller === root)).toBe(true);

  expect(openingCompletions()).toHaveLength(1);
  openingCompletions()[0]();
  expect(motionMocks.lenisStart).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("link", { name: "产品体系" }));
  expect(motionMocks.lenisScrollTo).toHaveBeenCalledWith(
    root.querySelector("#product"),
    expect.any(Object),
  );
  expect(window.location.hash).toBe("#product");

  view.unmount();
  expect(motionMocks.tickerRemove).toHaveBeenCalledWith(ticker);
  expect(motionMocks.unsubscribe).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisDestroy).toHaveBeenCalledTimes(1);
  expect(motionMocks.contextRevert).toHaveBeenCalledTimes(1);
  expect(motionMocks.gsapDefaults).not.toHaveBeenCalled();
  expect(motionMocks.gsapKillTweensOf).not.toHaveBeenCalled();
  expect(motionMocks.scrollKillAll).not.toHaveBeenCalled();
});

it("resolves the opening callback at most once across StrictMode replay", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  render(<StrictMode><Harness onOpeningComplete={complete} /></StrictMode>);

  const completions = openingCompletions();
  expect(completions.length).toBeGreaterThan(0);
  completions.forEach((finish) => finish());
  expect(complete).toHaveBeenCalledTimes(1);
});

it("falls back visibly and releases only its resources when initialization throws", () => {
  installMatchMedia({ reduced: false, desktop: true });
  motionMocks.throwOnContext = true;
  const complete = vi.fn();
  let view: ReturnType<typeof render> | undefined;
  expect(() => {
    view = render(<Harness onOpeningComplete={complete} seedHiddenStyles />);
  }).not.toThrow();

  const fallbackRoot = view!.container.querySelector("main") as HTMLElement;
  const fallbackCopy = fallbackRoot.querySelector<HTMLElement>("[data-motion-copy]")!;
  expect(fallbackRoot).not.toHaveClass("showcase-motion-active", "showcase-opening-active");
  expect(fallbackCopy.style.opacity).toBe("");
  expect(fallbackCopy.style.visibility).toBe("");
  expect(fallbackCopy.style.transform).toBe("");
  expect(fallbackCopy.style.clipPath).toBe("");
  expect(motionMocks.lenisDestroy).toHaveBeenCalled();
  expect(motionMocks.tickerRemove).toHaveBeenCalled();
  expect(motionMocks.unsubscribe).toHaveBeenCalled();
  expect(motionMocks.gsapDefaults).not.toHaveBeenCalled();
  expect(motionMocks.gsapKillTweensOf).not.toHaveBeenCalled();
  expect(motionMocks.scrollKillAll).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledTimes(1);
});

it("reverts its scoped context when a tween throws midway through initialization", () => {
  installMatchMedia({ reduced: false, desktop: true });
  motionMocks.throwOnTween = true;
  const complete = vi.fn();
  let view: ReturnType<typeof render> | undefined;

  expect(() => {
    view = render(<Harness onOpeningComplete={complete} seedHiddenStyles />);
  }).not.toThrow();

  const root = view!.container.querySelector("main") as HTMLElement;
  expect(motionMocks.timelineOptions.length).toBeGreaterThan(0);
  expect(motionMocks.contextRevert).toHaveBeenCalledTimes(1);
  expect(motionMocks.tickerRemove).toHaveBeenCalledTimes(1);
  expect(motionMocks.unsubscribe).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisDestroy).toHaveBeenCalledTimes(1);
  expect(root).not.toHaveClass("showcase-motion-active", "showcase-opening-active");
  expect(root.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(complete).toHaveBeenCalledTimes(1);
});
