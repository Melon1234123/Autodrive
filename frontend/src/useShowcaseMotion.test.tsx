/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode, useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const motionMocks = vi.hoisted(() => {
  const timelineOptions: Array<Record<string, unknown>> = [];
  const timelineTargets: unknown[] = [];
  const timelineFromToCalls: unknown[][] = [];
  const makeTimeline = (options: Record<string, unknown> = {}) => {
    timelineOptions.push(options);
    const chain = {
      fromTo: vi.fn(),
      set: vi.fn(),
    };
    chain.fromTo.mockImplementation((...args: unknown[]) => {
      const [targets] = args;
      timelineTargets.push(targets);
      timelineFromToCalls.push(args);
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
    timelineTargets,
    timelineFromToCalls,
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

const showcaseMotionCss = readFileSync(resolve(process.cwd(), "src/showcase-motion.css"), "utf8");

type MutableMediaQuery = MediaQueryList & { setMatches: (matches: boolean) => void };

function createMutableMediaQuery(media: string, initialMatches: boolean): MutableMediaQuery {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() { return matches; },
    media,
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener as (event: MediaQueryListEvent) => void);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener as (event: MediaQueryListEvent) => void);
    }),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    dispatchEvent: vi.fn(),
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      const event = { matches, media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
  return query as MutableMediaQuery;
}

function installMatchMedia({ reduced, desktop }: { reduced: boolean; desktop: boolean }) {
  const reducedQuery = createMutableMediaQuery("(prefers-reduced-motion: reduce)", reduced);
  const desktopQuery = createMutableMediaQuery("(min-width: 1024px) and (pointer: fine)", desktop);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => (
    query.includes("prefers-reduced-motion") ? reducedQuery : desktopQuery
  )));
  return { reducedQuery, desktopQuery };
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
        <section data-motion-section id="demo">
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
          <div data-motion-stagger>
            <span
              data-motion-stagger-item
              style={seedHiddenStyles ? { clipPath: "inset(100% 0 0 0)", willChange: "clip-path" } : undefined}
            >Footer item</span>
          </div>
          <div data-motion-media-frame>
            <video data-motion-media />
          </div>
        </section>
        <section data-motion-section id="unseen-section">
          <div data-motion-index />
          <div data-motion-line />
          <p data-motion-copy />
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

function openingDuration() {
  const calls = motionMocks.timelineFromToCalls.filter((call) => typeof call[3] === "number");
  return Math.max(...calls.map(([targets, _from, to, position]) => {
    const options = to as { duration?: number; stagger?: number };
    const targetCount = Array.isArray(targets) ? targets.length : 1;
    return (position as number) + (options.duration ?? 0) + (options.stagger ?? 0) * (targetCount - 1);
  }));
}

function sectionTimelineOptions(section: Element) {
  return motionMocks.timelineOptions.filter((options) => (
    (options.scrollTrigger as { trigger?: Element } | undefined)?.trigger === section
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  motionMocks.timelineOptions.length = 0;
  motionMocks.timelineTargets.length = 0;
  motionMocks.timelineFromToCalls.length = 0;
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

it.each([
  ["reduced motion", "reducedQuery", true],
  ["desktop gate", "desktopQuery", false],
] as const)("tears down immediately when the %s changes and never replays a resolved opening", (_label, queryName, disabledValue) => {
  const media = installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness onOpeningComplete={complete} seedHiddenStyles />);
  const root = view.container.querySelector("main") as HTMLElement;
  const copy = root.querySelector<HTMLElement>("[data-motion-copy]")!;
  const interruptedOpening = openingCompletions()[0];

  expect(openingCompletions()).toHaveLength(1);
  expect(root).toHaveClass("showcase-motion-active", "showcase-opening-active");

  act(() => media[queryName].setMatches(disabledValue));

  expect(motionMocks.contextRevert).toHaveBeenCalledTimes(1);
  expect(motionMocks.unsubscribe).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisDestroy).toHaveBeenCalledTimes(1);
  expect(root).not.toHaveClass("showcase-motion-active", "showcase-opening-active");
  expect(root.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(copy.style.opacity).toBe("");
  expect(copy.style.transform).toBe("");
  expect(complete).toHaveBeenCalledTimes(1);

  interruptedOpening();
  expect(motionMocks.lenisStart).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledTimes(1);

  act(() => media[queryName].setMatches(!disabledValue));

  expect(motionMocks.lenisConstruct).toHaveBeenCalledTimes(2);
  expect(openingCompletions()).toHaveLength(1);
  expect(root).toHaveClass("showcase-motion-active");
  expect(root).not.toHaveClass("showcase-opening-active");
  expect(complete).toHaveBeenCalledTimes(1);
});

it.each([
  ["reduced motion", "reducedQuery", true],
  ["desktop gate", "desktopQuery", false],
] as const)("does not rebuild an entered section after the %s cycles while retaining unseen section timelines", (_label, queryName, disabledValue) => {
  const media = installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} seedHiddenStyles />);
  const enteredSection = view.container.querySelector("#demo")!;
  const unseenSection = view.container.querySelector("#unseen-section")!;
  const enteredCopy = enteredSection.querySelector<HTMLElement>("[data-motion-copy]")!;
  const enteredTrigger = sectionTimelineOptions(enteredSection)[0].scrollTrigger as {
    onEnter?: () => void;
  };

  expect(sectionTimelineOptions(enteredSection)).toHaveLength(1);
  expect(sectionTimelineOptions(unseenSection)).toHaveLength(1);
  expect(enteredTrigger.onEnter).toEqual(expect.any(Function));
  act(() => enteredTrigger.onEnter?.());

  act(() => media[queryName].setMatches(disabledValue));
  expect(enteredCopy.style.opacity).toBe("");
  expect(enteredCopy.style.transform).toBe("");

  act(() => media[queryName].setMatches(!disabledValue));

  expect(sectionTimelineOptions(enteredSection)).toHaveLength(1);
  expect(sectionTimelineOptions(unseenSection)).toHaveLength(2);
  expect(view.container.querySelector("main")).toHaveClass("showcase-motion-active");
});

it("keeps the opening cadence within the 2.8 to 3.2 second target", () => {
  installMatchMedia({ reduced: false, desktop: true });
  render(<Harness />);

  expect(openingDuration()).toBeGreaterThanOrEqual(2.8);
  expect(openingDuration()).toBeLessThanOrEqual(3.2);
});

it("keeps Demo reveal scale composed with its concurrent parallax transform", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness />);
  const demoMedia = view.container.querySelector("[data-motion-media]");
  const scaleReveal = motionMocks.timelineFromToCalls.find(([target, from]) => (
    target === demoMedia && (from as { scale?: number }).scale === 1.06
  ));
  const parallax = motionMocks.gsapFromTo.mock.calls.find(([target, from]) => (
    target === demoMedia && (from as { yPercent?: number }).yPercent === -4
  ));

  expect(scaleReveal).toBeDefined();
  expect((scaleReveal?.[2] as { clearProps?: string }).clearProps).toBeUndefined();
  expect(parallax?.[2]).toEqual(expect.objectContaining({ yPercent: 4 }));
});

it("reserves edge coverage for both parallax media layers", () => {
  expect(showcaseMotionCss).toMatch(/\.hero-video\s*{\s*inset:-6% 0;\s*height:112%;\s*}/);
  expect(showcaseMotionCss).toMatch(
    /\[data-motion-media-frame\]>\[data-motion-media\]\s*{[^}]*inset:-5% 0;[^}]*height:110%;[^}]*}/,
  );
});

it("creates one root-scoped synchronized runtime, handles anchors, and cleans up", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness onOpeningComplete={complete} />);
  expect(motionMocks.timelineTargets).not.toContain(null);
  expect(view.container.querySelector("[data-motion-opening-rule]")).not.toBeInTheDocument();
  const root = view.container.querySelector("main") as HTMLElement;
  const content = root.querySelector("[data-lenis-content]");
  const staggerItem = root.querySelector("[data-motion-stagger-item]");

  expect(motionMocks.lenisConstruct).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisConstruct).toHaveBeenCalledWith(expect.objectContaining({
    wrapper: root,
    content,
    autoRaf: false,
  }));
  expect(motionMocks.lenisOn).toHaveBeenCalledWith("scroll", motionMocks.scrollUpdate);
  expect(motionMocks.gsapContext).toHaveBeenCalledWith(expect.any(Function), root);
  expect(motionMocks.timelineTargets.some((targets) => Array.isArray(targets) && targets.includes(staggerItem))).toBe(true);
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
  const queries = vi.mocked(window.matchMedia).mock.results.map((result) => result.value);
  expect(queries.every((query) => vi.mocked(query.removeEventListener).mock.calls.length === 1)).toBe(true);
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
  const fallbackStaggerItem = fallbackRoot.querySelector<HTMLElement>("[data-motion-stagger-item]")!;
  expect(fallbackRoot).not.toHaveClass("showcase-motion-active", "showcase-opening-active");
  expect(fallbackCopy.style.opacity).toBe("");
  expect(fallbackCopy.style.visibility).toBe("");
  expect(fallbackCopy.style.transform).toBe("");
  expect(fallbackCopy.style.clipPath).toBe("");
  expect(fallbackStaggerItem.style.clipPath).toBe("");
  expect(fallbackStaggerItem.style.willChange).toBe("");
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
