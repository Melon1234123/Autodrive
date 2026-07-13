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
  const timelineInstances: Array<{
    options: Record<string, unknown>;
    targets: unknown[];
    fromToCalls: unknown[][];
    chain: {
      fromTo: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      restart: ReturnType<typeof vi.fn>;
    };
  }> = [];
  const makeTimeline = (options: Record<string, unknown> = {}) => {
    timelineOptions.push(options);
    const targets: unknown[] = [];
    const fromToCalls: unknown[][] = [];
    const chain = {
      fromTo: vi.fn(),
      set: vi.fn(),
      restart: vi.fn(),
    };
    chain.fromTo.mockImplementation((...args: unknown[]) => {
      const [target] = args;
      targets.push(target);
      fromToCalls.push(args);
      timelineTargets.push(target);
      timelineFromToCalls.push(args);
      if (motionMocks.throwOnTween) throw new Error("tween init failed");
      return chain;
    });
    chain.set.mockReturnValue(chain);
    chain.restart.mockReturnValue(chain);
    timelineInstances.push({ options, targets, fromToCalls, chain });
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
    timelineInstances,
    tickerAdd: vi.fn(),
    tickerRemove: vi.fn(),
    scrollUpdate: vi.fn(),
    scrollRefresh: vi.fn(),
    scrollCreate: vi.fn(),
    scrollKillAll: vi.fn(),
    lenisConstruct: vi.fn(),
    lenisOn: vi.fn(),
    lenisStop: vi.fn(),
    lenisStart: vi.fn(),
    lenisRaf: vi.fn(),
    lenisScrollTo: vi.fn(),
    lenisDestroy: vi.fn(),
    lenisIsLocked: false,
    lenisOptions: null as Record<string, unknown> | null,
    unsubscribe: vi.fn(),
    snapConstruct: vi.fn(),
    snapAddElements: vi.fn(),
    snapStart: vi.fn(),
    snapStop: vi.fn(),
    snapGoTo: vi.fn(),
    snapDestroy: vi.fn(),
    snapResize: vi.fn(),
    snapOptions: null as Record<string, unknown> | null,
    throwOnContext: false,
    throwOnSnap: false,
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
    create: motionMocks.scrollCreate,
    killAll: motionMocks.scrollKillAll,
  },
}));

vi.mock("lenis", () => ({
  default: class LenisMock {
    constructor(options: unknown) {
      motionMocks.lenisOptions = options as Record<string, unknown>;
      motionMocks.lenisConstruct(options);
    }
    get isLocked() { return motionMocks.lenisIsLocked; }
    on(event: string, callback: unknown) { motionMocks.lenisOn(event, callback); return motionMocks.unsubscribe; }
    stop() { motionMocks.lenisStop(); }
    start() { motionMocks.lenisStart(); }
    raf(time: number) { motionMocks.lenisRaf(time); }
    scrollTo(target: HTMLElement, options: unknown) {
      motionMocks.lenisScrollTo(target, options);
      if ((options as { lock?: boolean }).lock) motionMocks.lenisIsLocked = true;
    }
    destroy() { motionMocks.lenisDestroy(); }
  },
}));

vi.mock("lenis/snap", () => ({
  default: class SnapMock {
    constructor(lenis: unknown, options: Record<string, unknown>) {
      if (motionMocks.throwOnSnap) throw new Error("snap init failed");
      motionMocks.snapOptions = options;
      motionMocks.snapConstruct(lenis, options);
    }
    addElements(elements: HTMLElement[], options: unknown) {
      motionMocks.snapAddElements(elements, options);
      return vi.fn();
    }
    start() { motionMocks.snapStart(); }
    stop() { motionMocks.snapStop(); }
    goTo(index: number) {
      motionMocks.snapGoTo(index);
      (motionMocks.snapOptions?.onSnapStart as ((item: unknown) => void) | undefined)?.({
        index,
        value: index * 900,
      });
    }
    resize() { motionMocks.snapResize(); }
    destroy() { motionMocks.snapDestroy(); }
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
  enabled = true,
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  useShowcaseMotion({ rootRef, playOpening, onOpeningComplete, enabled });

  return (
    <main ref={rootRef}>
      <ShowcaseOpening />
      <nav><div className="showcase-nav-glass" /></nav>
      <div data-lenis-content>
        <section className="showcase-hero" data-motion-hero>
          <div className="kicker" />
          <div data-motion-line />
          <p className="hero-copy" />
          <div className="hero-actions" />
          <div className="hero-foot" />
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
        <section data-motion-section id="origin" />
        <section data-motion-section id="route" />
        <section data-motion-section id="product"><span id="product-detail" /></section>
        <footer data-motion-section id="contact" />
      </div>
      <div id="legal-target" />
      <a href="#product">产品体系</a>
      <a href="#product-detail">产品详情</a>
      <a href="#legal-target">合法目标</a>
      <a href="mailto:test@example.com">联系</a>
      <input aria-label="导航输入" />
      <button type="button">空格按钮</button>
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

function emitVirtualWheel({
  deltaX = 0,
  deltaY,
  target,
  ...eventInit
}: WheelEventInit & { deltaY: number; target: Element }) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX,
    deltaY,
    ...eventInit,
  });
  Object.defineProperty(event, "target", { configurable: true, value: target });
  const result = (motionMocks.lenisOptions?.virtualScroll as ((data: {
    deltaX: number;
    deltaY: number;
    event: WheelEvent | TouchEvent;
  }) => boolean) | undefined)?.({ deltaX, deltaY, event });
  return { event, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  motionMocks.timelineOptions.length = 0;
  motionMocks.timelineTargets.length = 0;
  motionMocks.timelineFromToCalls.length = 0;
  motionMocks.timelineInstances.length = 0;
  motionMocks.lenisIsLocked = false;
  motionMocks.lenisOptions = null;
  motionMocks.snapOptions = null;
  motionMocks.throwOnContext = false;
  motionMocks.throwOnSnap = false;
  motionMocks.throwOnTween = false;
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 17));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("skips all motion under reduced motion and resolves opening once in StrictMode", () => {
  installMatchMedia({ reduced: true, desktop: true });
  const complete = vi.fn();
  const view = render(<StrictMode><Harness onOpeningComplete={complete} /></StrictMode>);

  expect(motionMocks.lenisConstruct).not.toHaveBeenCalled();
  expect(motionMocks.snapConstruct).not.toHaveBeenCalled();
  expect(motionMocks.snapDestroy).not.toHaveBeenCalled();
  expect(motionMocks.gsapContext).not.toHaveBeenCalled();
  expect(view.container.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(complete).toHaveBeenCalledTimes(1);
});

it("also skips motion outside the desktop fine-pointer gate", () => {
  installMatchMedia({ reduced: false, desktop: false });
  const complete = vi.fn();
  render(<Harness onOpeningComplete={complete} />);

  expect(motionMocks.lenisConstruct).not.toHaveBeenCalled();
  expect(motionMocks.snapConstruct).not.toHaveBeenCalled();
  expect(motionMocks.snapDestroy).not.toHaveBeenCalled();
  expect(motionMocks.gsapContext).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledTimes(1);
});

it("uses the opening preference captured on mount", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness playOpening={false} onOpeningComplete={complete} />);

  view.rerender(<Harness playOpening onOpeningComplete={complete} />);

  expect(motionMocks.lenisStop).not.toHaveBeenCalled();
  expect(motionMocks.snapStart).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapStop).not.toHaveBeenCalled();
  expect(openingCompletions()).toHaveLength(0);
  expect(complete).not.toHaveBeenCalled();
});

it("finishes the opening fallback when the optional hero media is absent", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness includeHeroMedia={false} onOpeningComplete={complete} />);
  const root = view.container.querySelector("main") as HTMLElement;

  expect(motionMocks.lenisStop).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapStop).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapStart).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisStart).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapStart.mock.invocationCallOrder[0]).toBeLessThan(
    motionMocks.lenisStart.mock.invocationCallOrder[0],
  );
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
  expect(motionMocks.snapDestroy).toHaveBeenCalledTimes(1);
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
  expect(motionMocks.snapConstruct).toHaveBeenCalledTimes(2);
  expect(openingCompletions()).toHaveLength(1);
  expect(root).toHaveClass("showcase-motion-active");
  expect(root).not.toHaveClass("showcase-opening-active");
  expect(complete).toHaveBeenCalledTimes(1);
});

it("retains the showcase scroll root position while motion is disabled and re-enabled", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} />);
  const root = view.container.querySelector("main") as HTMLElement;
  const content = root.querySelector("[data-lenis-content]") as HTMLElement;
  const pages = Array.from(content.querySelectorAll<HTMLElement>(
    ":scope > .showcase-hero, :scope > [data-motion-section]",
  ));
  pages.forEach((page, index) => {
    Object.defineProperty(page, "offsetTop", { configurable: true, value: index * 900 });
  });
  root.scrollTop = 1800;

  view.rerender(<Harness playOpening={false} enabled={false} />);

  expect(view.container.querySelector("main")).toBe(root);
  expect(root.scrollTop).toBe(1800);
  expect(root).not.toHaveClass("showcase-motion-active");
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(true);

  view.rerender(<Harness playOpening={false} enabled />);

  expect(view.container.querySelector("main")).toBe(root);
  expect(root.scrollTop).toBe(1800);
  expect(root).toHaveClass("showcase-motion-active");
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(3);
});

it("recreates enabled motion without replaying an interrupted opening", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const complete = vi.fn();
  const view = render(<Harness onOpeningComplete={complete} />);
  const root = view.container.querySelector("main") as HTMLElement;

  expect(openingCompletions()).toHaveLength(1);
  expect(root).toHaveClass("showcase-motion-active", "showcase-opening-active");

  view.rerender(<Harness playOpening={false} onOpeningComplete={complete} enabled={false} />);

  expect(motionMocks.snapDestroy).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisDestroy).toHaveBeenCalledTimes(1);
  expect(root).not.toHaveClass("showcase-motion-active", "showcase-opening-active");
  expect(root.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");

  view.rerender(<Harness playOpening={false} onOpeningComplete={complete} enabled />);

  expect(view.container.querySelector("main")).toBe(root);
  expect(motionMocks.lenisConstruct).toHaveBeenCalledTimes(2);
  expect(motionMocks.snapConstruct).toHaveBeenCalledTimes(2);
  expect(root).toHaveClass("showcase-motion-active");
  expect(root).not.toHaveClass("showcase-opening-active");
  expect(openingCompletions()).toHaveLength(1);
  expect(root.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(complete).not.toHaveBeenCalled();
});

it.each([
  ["reduced motion", "reducedQuery", true],
  ["desktop gate", "desktopQuery", false],
] as const)("rebuilds every section with bidirectional replay after the %s cycles", (_label, queryName, disabledValue) => {
  const media = installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} seedHiddenStyles />);
  const enteredSection = view.container.querySelector("#demo")!;
  const unseenSection = view.container.querySelector("#unseen-section")!;
  const enteredCopy = enteredSection.querySelector<HTMLElement>("[data-motion-copy]")!;

  for (const section of [enteredSection, unseenSection]) {
    const triggers = sectionTimelineOptions(section).map((options) => (
      options.scrollTrigger as Record<string, unknown>
    ));
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toEqual(expect.objectContaining({
      start: "top 76%",
      end: "bottom 24%",
      toggleActions: "restart none restart none",
    }));
    expect(triggers[0]).not.toHaveProperty("once");
  }

  act(() => media[queryName].setMatches(disabledValue));
  expect(enteredCopy.style.opacity).toBe("");
  expect(enteredCopy.style.transform).toBe("");

  act(() => media[queryName].setMatches(!disabledValue));

  expect(sectionTimelineOptions(enteredSection)).toHaveLength(2);
  expect(sectionTimelineOptions(unseenSection)).toHaveLength(2);
  expect(view.container.querySelector("main")).toHaveClass("showcase-motion-active");
});

it("replays only Hero content when returning upward", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} />);
  const root = view.container.querySelector("main") as HTMLElement;
  const hero = root.querySelector("[data-motion-hero]");
  const heroTrigger = motionMocks.scrollCreate.mock.calls.find(([options]) => (
    (options as { trigger?: Element }).trigger === hero
  ))?.[0] as { onEnterBack?: () => void };
  const heroReturn = motionMocks.timelineInstances.find(({ options }) => options.paused === true);

  expect(heroTrigger).toEqual(expect.objectContaining({
    trigger: hero,
    scroller: root,
    start: "top top",
    end: "bottom 24%",
    onEnterBack: expect.any(Function),
  }));
  expect(heroReturn).toBeDefined();
  expect(heroReturn?.targets).toEqual(expect.arrayContaining([
    [root.querySelector("[data-motion-line]")],
    root.querySelector(".showcase-hero .kicker"),
    root.querySelector(".hero-copy"),
    root.querySelector(".hero-actions"),
    root.querySelector(".hero-foot"),
  ]));
  expect(heroReturn?.targets).not.toContain(root.querySelector(".showcase-nav-glass"));
  expect(heroReturn?.targets).not.toContain(root.querySelector("[data-motion-opening]"));
  expect(heroReturn?.targets).not.toContain(root.querySelector("[data-motion-opening-panel]"));
  expect(heroReturn?.targets).not.toContain(root.querySelector("[data-motion-hero-media]"));
  expect(heroReturn?.fromToCalls).toHaveLength(5);
  for (const call of heroReturn?.fromToCalls ?? []) {
    expect(call[2]).toEqual(expect.objectContaining({ immediateRender: false }));
  }

  heroTrigger.onEnterBack?.();
  expect(heroReturn?.chain.restart).toHaveBeenCalledTimes(1);
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
  const pages = Array.from(content!.querySelectorAll<HTMLElement>(
    ":scope > .showcase-hero, :scope > [data-motion-section]",
  ));

  expect(motionMocks.lenisConstruct).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisConstruct).toHaveBeenCalledWith(expect.objectContaining({
    wrapper: root,
    content,
    autoRaf: false,
  }));
  const lenisOptions = motionMocks.lenisConstruct.mock.calls[0][0] as Record<string, unknown>;
  expect(motionMocks.snapConstruct).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapConstruct).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    type: "lock",
    duration: 1.05,
    debounce: 90,
    easing: expect.any(Function),
  }));
  expect(motionMocks.snapOptions?.easing).toBe(lenisOptions.easing);
  expect(motionMocks.snapAddElements).toHaveBeenCalledWith(expect.arrayContaining([
    root.querySelector(".showcase-hero"),
    root.querySelector("#contact"),
  ]), expect.objectContaining({ align: "start", ignoreTransform: true }));
  expect(motionMocks.snapAddElements.mock.calls[0][0]).toHaveLength(7);
  expect(motionMocks.snapAddElements.mock.calls[0][0]).toEqual(pages);
  expect(motionMocks.lenisOn).toHaveBeenCalledWith("scroll", motionMocks.scrollUpdate);
  expect(motionMocks.gsapContext).toHaveBeenCalledWith(expect.any(Function), root);
  expect(motionMocks.timelineTargets.some((targets) => Array.isArray(targets) && targets.includes(staggerItem))).toBe(true);
  expect(motionMocks.lenisStop).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapStop).toHaveBeenCalledTimes(1);
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
  expect(motionMocks.snapStart).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisStart).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapStart.mock.invocationCallOrder[0]).toBeLessThan(
    motionMocks.lenisStart.mock.invocationCallOrder[0],
  );
  expect(complete).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("link", { name: "产品体系" }));
  expect(motionMocks.snapGoTo).toHaveBeenCalledWith(5);
  expect(motionMocks.lenisScrollTo).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#product");

  view.unmount();
  expect(motionMocks.tickerRemove).toHaveBeenCalledWith(ticker);
  expect(motionMocks.unsubscribe).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapDestroy).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapDestroy.mock.invocationCallOrder[0]).toBeLessThan(
    motionMocks.lenisDestroy.mock.invocationCallOrder[0],
  );
  expect(motionMocks.lenisDestroy).toHaveBeenCalledTimes(1);
  expect(motionMocks.contextRevert).toHaveBeenCalledTimes(1);
  const queries = vi.mocked(window.matchMedia).mock.results.map((result) => result.value);
  expect(queries.every((query) => vi.mocked(query.removeEventListener).mock.calls.length === 1)).toBe(true);
  expect(motionMocks.gsapDefaults).not.toHaveBeenCalled();
  expect(motionMocks.gsapKillTweensOf).not.toHaveBeenCalled();
  expect(motionMocks.scrollKillAll).not.toHaveBeenCalled();
});

it("routes registered and contained anchors through Snap while retaining the legal Lenis fallback", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} />);
  const root = view.container.querySelector("main") as HTMLElement;
  const completeSnap = motionMocks.snapOptions?.onSnapComplete as ((item: unknown) => void);

  expect(fireEvent.click(screen.getByRole("link", { name: "产品体系" }))).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(5);
  expect(motionMocks.lenisScrollTo).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#product");

  motionMocks.snapGoTo.mockClear();
  expect(fireEvent.click(screen.getByRole("link", { name: "合法目标" }))).toBe(false);
  expect(motionMocks.lenisScrollTo).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#product");

  expect(fireEvent.click(screen.getByRole("link", { name: "产品详情" }))).toBe(false);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();
  expect(motionMocks.lenisScrollTo).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#product");

  completeSnap({ index: 5, value: 4500 });
  expect(fireEvent.click(screen.getByRole("link", { name: "产品详情" }))).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(5);
  expect(window.location.hash).toBe("#product-detail");

  completeSnap({ index: 5, value: 4500 });
  expect(fireEvent.click(screen.getByRole("link", { name: "合法目标" }))).toBe(false);
  expect(motionMocks.lenisScrollTo).toHaveBeenCalledWith(
    root.querySelector("#legal-target"),
    { duration: 1.05, lock: true },
  );
  expect(window.location.hash).toBe("#legal-target");

  motionMocks.snapGoTo.mockClear();
  expect(fireEvent.click(screen.getByRole("link", { name: "产品体系" }))).toBe(false);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#legal-target");

  motionMocks.lenisIsLocked = false;
  expect(fireEvent.click(screen.getByRole("link", { name: "产品体系" }))).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenCalledWith(5);
  expect(window.location.hash).toBe("#product");
});

it("holds direct page commands until the stopped opening runtime has restarted", () => {
  installMatchMedia({ reduced: false, desktop: true });
  render(<Harness />);

  expect(fireEvent.click(screen.getByRole("link", { name: "产品体系" }))).toBe(false);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();

  openingCompletions()[0]();
  expect(fireEvent.click(screen.getByRole("link", { name: "产品体系" }))).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenCalledWith(5);
  expect(window.location.hash).toBe("#product");
});

it("turns small and huge vertical wheel gestures into adjacent Snap travel", () => {
  vi.useFakeTimers();
  installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} />);
  const root = view.container.querySelector("main") as HTMLElement;
  const content = root.querySelector("[data-lenis-content]") as HTMLElement;
  const pages = Array.from(content.querySelectorAll<HTMLElement>(
    ":scope > .showcase-hero, :scope > [data-motion-section]",
  ));
  pages.forEach((page, index) => {
    Object.defineProperty(page, "offsetTop", { configurable: true, value: index * 900 });
  });
  const completeSnap = motionMocks.snapOptions?.onSnapComplete as ((item: unknown) => void);

  expect(motionMocks.lenisOptions?.virtualScroll).toEqual(expect.any(Function));
  motionMocks.snapGoTo.mockClear();

  root.scrollTop = 0;
  const smallDown = emitVirtualWheel({ deltaY: 1, target: root });
  expect(smallDown.result).toBe(false);
  expect(smallDown.event.defaultPrevented).toBe(true);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(1);

  const sameBurstHugeDown = emitVirtualWheel({ deltaY: 100_000, target: root });
  expect(sameBurstHugeDown.result).toBe(false);
  expect(sameBurstHugeDown.event.defaultPrevented).toBe(true);
  expect(motionMocks.snapGoTo).toHaveBeenCalledTimes(1);

  completeSnap({ index: 1, value: 900 });
  root.scrollTop = 900;
  const settlingBurst = emitVirtualWheel({ deltaY: 100_000, target: root });
  expect(settlingBurst.event.defaultPrevented).toBe(true);
  expect(motionMocks.snapGoTo).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(121));
  const hugeDown = emitVirtualWheel({ deltaY: 100_000, target: root });
  expect(hugeDown.result).toBe(false);
  expect(hugeDown.event.defaultPrevented).toBe(true);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(2);

  completeSnap({ index: 2, value: 1800 });
  root.scrollTop = 1800;
  act(() => vi.advanceTimersByTime(121));
  const hugeUp = emitVirtualWheel({ deltaY: -100_000, target: root });
  expect(hugeUp.result).toBe(false);
  expect(hugeUp.event.defaultPrevented).toBe(true);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(1);

  completeSnap({ index: 1, value: 900 });
  root.scrollTop = 900;
  act(() => vi.advanceTimersByTime(121));
  emitVirtualWheel({ deltaY: -1, target: root });
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(0);
  completeSnap({ index: 0, value: 0 });
  root.scrollTop = 0;
  act(() => vi.advanceTimersByTime(121));

  const firstPageUp = emitVirtualWheel({ deltaY: -500, target: root });
  expect(firstPageUp.result).toBe(false);
  expect(firstPageUp.event.defaultPrevented).toBe(true);
  expect(motionMocks.snapGoTo.mock.calls.map(([index]) => index)).toEqual([1, 2, 1, 0]);
  act(() => vi.advanceTimersByTime(121));

  root.scrollTop = 5400;
  const lastPageDown = emitVirtualWheel({ deltaY: 500, target: root });
  expect(lastPageDown.result).toBe(false);
  expect(lastPageDown.event.defaultPrevented).toBe(true);
  expect(motionMocks.snapGoTo.mock.calls.map(([index]) => index)).toEqual([1, 2, 1, 0]);
});

it("leaves inappropriate virtual input alone and fully disposes the wheel gate", () => {
  vi.useFakeTimers();
  installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} />);
  const root = view.container.querySelector("main") as HTMLElement;
  const input = screen.getByLabelText("导航输入");
  const nested = document.createElement("div");
  nested.setAttribute("data-lenis-prevent-wheel", "");
  root.append(nested);

  expect(motionMocks.lenisOptions?.virtualScroll).toEqual(expect.any(Function));
  const ignored = [
    emitVirtualWheel({ deltaX: 100, deltaY: 10, target: root }),
    emitVirtualWheel({ deltaY: 100, ctrlKey: true, target: root }),
    emitVirtualWheel({ deltaY: 100, metaKey: true, target: root }),
    emitVirtualWheel({ deltaY: 100, altKey: true, target: root }),
    emitVirtualWheel({ deltaY: 100, shiftKey: true, target: root }),
    emitVirtualWheel({ deltaY: 100, target: input }),
    emitVirtualWheel({ deltaY: 100, target: nested }),
  ];
  expect(ignored.every(({ event, result }) => result === false && !event.defaultPrevented)).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();

  const retainedHandler = motionMocks.lenisOptions!.virtualScroll as (data: {
    deltaX: number;
    deltaY: number;
    event: WheelEvent | TouchEvent;
  }) => boolean;
  const snapStartsBeforeDispose = motionMocks.snapStart.mock.calls.length;
  view.unmount();
  expect(motionMocks.snapStop.mock.invocationCallOrder.at(-1)).toBeLessThan(
    motionMocks.snapDestroy.mock.invocationCallOrder[0],
  );

  const postUnmountEvent = new WheelEvent("wheel", { cancelable: true });
  const postUnmountResult = retainedHandler({ deltaX: 0, deltaY: 100, event: postUnmountEvent });
  act(() => vi.advanceTimersByTime(500));
  expect(postUnmountResult).toBe(true);
  expect(postUnmountEvent.defaultPrevented).toBe(false);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();
  expect(motionMocks.snapStart).toHaveBeenCalledTimes(snapStartsBeforeDispose);
});

it("locks page keys until Snap completes and leaves rejected keyboard input untouched", () => {
  installMatchMedia({ reduced: false, desktop: true });
  const view = render(<Harness playOpening={false} />);
  const root = view.container.querySelector("main") as HTMLElement;
  const content = root.querySelector("[data-lenis-content]") as HTMLElement;
  const pages = Array.from(content.querySelectorAll<HTMLElement>(
    ":scope > .showcase-hero, :scope > [data-motion-section]",
  ));
  pages.forEach((page, index) => {
    Object.defineProperty(page, "offsetTop", { configurable: true, value: index * 900 });
  });
  const completeSnap = motionMocks.snapOptions?.onSnapComplete as ((item: unknown) => void);
  motionMocks.snapGoTo.mockClear();

  root.scrollTop = 0;
  expect(fireEvent.keyDown(window, { key: "PageUp" })).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();

  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(1);
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(true);
  expect(motionMocks.snapGoTo).toHaveBeenCalledTimes(1);

  completeSnap({ index: 1, value: 900 });
  root.scrollTop = 900;
  expect(fireEvent.keyDown(window, { key: "PageUp" })).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(0);
  completeSnap({ index: 0, value: 0 });

  motionMocks.snapGoTo.mockClear();
  root.scrollTop = 0;
  expect(fireEvent.keyDown(window, { key: "PageDown", repeat: true })).toBe(true);
  expect(fireEvent.keyDown(window, { key: "PageDown", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(screen.getByLabelText("导航输入"), { key: "PageDown" })).toBe(true);
  expect(fireEvent.keyDown(screen.getByRole("button", { name: "空格按钮" }), { key: " " })).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();

  root.scrollTop = 5400;
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();

  root.scrollTop = 1800;
  expect(fireEvent.keyDown(window, { key: "End" })).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(6);
  completeSnap({ index: 6, value: 5400 });
  root.scrollTop = 5400;
  expect(fireEvent.keyDown(window, { key: "Home" })).toBe(false);
  expect(motionMocks.snapGoTo).toHaveBeenLastCalledWith(0);

  motionMocks.snapGoTo.mockClear();
  view.unmount();
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();
});

it("resizes Snap before refreshing ScrollTrigger in the scheduled frame", () => {
  installMatchMedia({ reduced: false, desktop: true });
  let refresh: FrameRequestCallback | undefined;
  vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
    refresh = callback;
    return 17;
  });
  render(<Harness playOpening={false} />);

  act(() => refresh?.(0));

  expect(motionMocks.snapResize).toHaveBeenCalledTimes(1);
  expect(motionMocks.scrollRefresh).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapResize.mock.invocationCallOrder[0]).toBeLessThan(
    motionMocks.scrollRefresh.mock.invocationCallOrder[0],
  );
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

it("falls back visibly and tears down Lenis when Snap initialization throws", () => {
  installMatchMedia({ reduced: false, desktop: true });
  motionMocks.throwOnSnap = true;
  const complete = vi.fn();
  let view: ReturnType<typeof render> | undefined;

  expect(() => {
    view = render(<Harness onOpeningComplete={complete} seedHiddenStyles />);
  }).not.toThrow();

  const root = view!.container.querySelector("main") as HTMLElement;
  const copy = root.querySelector<HTMLElement>("[data-motion-copy]")!;
  expect(motionMocks.lenisConstruct).toHaveBeenCalledTimes(1);
  expect(motionMocks.snapConstruct).not.toHaveBeenCalled();
  expect(motionMocks.snapDestroy).not.toHaveBeenCalled();
  expect(motionMocks.lenisDestroy).toHaveBeenCalledTimes(1);
  expect(motionMocks.gsapContext).not.toHaveBeenCalled();
  expect(root).not.toHaveClass("showcase-motion-active", "showcase-opening-active");
  expect(root.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(copy.style.opacity).toBe("");
  expect(copy.style.visibility).toBe("");
  expect(copy.style.transform).toBe("");
  expect(copy.style.clipPath).toBe("");
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();
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
  expect(motionMocks.snapDestroy).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisDestroy).toHaveBeenCalled();
  expect(motionMocks.tickerRemove).toHaveBeenCalled();
  expect(motionMocks.unsubscribe).toHaveBeenCalled();
  expect(motionMocks.gsapDefaults).not.toHaveBeenCalled();
  expect(motionMocks.gsapKillTweensOf).not.toHaveBeenCalled();
  expect(motionMocks.scrollKillAll).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(window, { key: "PageDown" })).toBe(true);
  expect(motionMocks.snapGoTo).not.toHaveBeenCalled();
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
  expect(motionMocks.snapDestroy).toHaveBeenCalledTimes(1);
  expect(motionMocks.lenisDestroy).toHaveBeenCalledTimes(1);
  expect(root).not.toHaveClass("showcase-motion-active", "showcase-opening-active");
  expect(root.querySelector("[data-motion-opening]")).toHaveAttribute("hidden");
  expect(complete).toHaveBeenCalledTimes(1);
});
