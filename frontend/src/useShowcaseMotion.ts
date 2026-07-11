import { useLayoutEffect, useRef, type RefObject } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  DESKTOP_SHOWCASE_MOTION_QUERY,
  resolveShowcaseAnchor,
  shouldEnableShowcaseMotion,
} from "./showcase-motion-policy";

gsap.registerPlugin(ScrollTrigger);

type ShowcaseMotionOptions = {
  rootRef: RefObject<HTMLElement | null>;
  playOpening: boolean;
  onOpeningComplete: () => void;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function clearMotionStyles(root: HTMLElement) {
  const targets = root.querySelectorAll<HTMLElement>([
    "[data-motion-line]", "[data-motion-index]", "[data-motion-copy]",
    "[data-motion-stagger]", "[data-motion-stagger]>[data-motion-stagger-item]",
    "[data-motion-stagger]>.archive-card",
    "[data-motion-stagger]>.border-glow-card", ".motion-block",
    "[data-motion-media-frame]", "[data-motion-media]", "[data-motion-hero-media]",
    ".showcase-nav-glass", ".hero-foot", ".hero-actions", ".hero-copy", ".showcase-hero .kicker",
  ].join(","));
  gsap.set(targets, { clearProps: "transform,opacity,visibility,clipPath,willChange" });
}

export function useShowcaseMotion({ rootRef, playOpening, onOpeningComplete }: ShowcaseMotionOptions) {
  const playOnMountRef = useRef(playOpening);
  const completeRef = useRef(onOpeningComplete);
  const openingResolvedRef = useRef(false);
  completeRef.current = onOpeningComplete;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const opening = root.querySelector<HTMLElement>("[data-motion-opening]");
    const resolveOpening = () => {
      if (!playOnMountRef.current || openingResolvedRef.current) return;
      openingResolvedRef.current = true;
      completeRef.current();
    };
    const reduced = window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? true;
    const desktop = window.matchMedia?.(DESKTOP_SHOWCASE_MOTION_QUERY).matches ?? false;
    if (!shouldEnableShowcaseMotion({ reducedMotion: reduced, desktopFinePointer: desktop })) {
      opening?.setAttribute("hidden", "");
      resolveOpening();
      return;
    }

    const content = root.querySelector<HTMLElement>("[data-lenis-content]");
    if (!content) {
      opening?.setAttribute("hidden", "");
      resolveOpening();
      return;
    }

    let context: gsap.Context | null = null;
    let lenis: Lenis | null = null;
    let unsubscribeScroll: (() => void) | null = null;
    let refreshFrame = 0;
    let ticker: ((time: number) => void) | null = null;

    const finishOpening = () => {
      opening?.setAttribute("hidden", "");
      root.classList.remove("showcase-opening-active");
      lenis?.start();
      resolveOpening();
    };

    const handleAnchorClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!link || !root.contains(link)) return;
      const target = resolveShowcaseAnchor(root, link.getAttribute("href") ?? "");
      if (!target) return;
      event.preventDefault();
      lenis?.scrollTo(target, { duration: 1.15, lock: false });
      window.history.pushState(null, "", link.hash);
    };

    try {
      root.classList.add("showcase-motion-active");
      lenis = new Lenis({
        wrapper: root,
        content,
        autoRaf: false,
        duration: 1.32,
        easing: (time) => Math.min(1, 1.001 - Math.pow(2, -10 * time)),
        smoothWheel: true,
        syncTouch: false,
        overscroll: true,
      });
      unsubscribeScroll = lenis.on("scroll", ScrollTrigger.update);
      ticker = (time) => lenis?.raf(time * 1000);
      gsap.ticker.add(ticker);
      root.addEventListener("click", handleAnchorClick);
      if (playOnMountRef.current) {
        root.classList.add("showcase-opening-active");
        lenis.stop();
      }

      const initializeScopedMotion = () => {
        const hero = root.querySelector<HTMLElement>("[data-motion-hero]");
        const heroMedia = root.querySelector<HTMLElement>("[data-motion-hero-media]");
        const openingPanels = Array.from(root.querySelectorAll<HTMLElement>("[data-motion-opening-panel]"));
        const openingRule = root.querySelector<HTMLElement>("[data-motion-opening-rule]");
        const heroLines = Array.from(hero?.querySelectorAll<HTMLElement>("[data-motion-line]") ?? []);
        const navSurface = root.querySelector<HTMLElement>(".showcase-nav-glass");

        if (playOnMountRef.current && opening && hero && heroMedia) {
          opening.removeAttribute("hidden");
          const openingTimeline = gsap.timeline({ defaults: { ease: "power4.out" }, onComplete: finishOpening });
          openingTimeline
            .fromTo(heroMedia, { scale: 1.08 }, { scale: 1, duration: 2.35, willChange: "transform" }, 0)
            .fromTo(openingRule, { scaleX: 0 }, { scaleX: 1, duration: .72 }, .12)
            .fromTo(openingPanels, { yPercent: 0 }, { yPercent: (index) => index % 2 ? 102 : -102, duration: 1.55, stagger: .08 }, .32)
            .fromTo(heroLines, { yPercent: 115, scaleY: .78 }, { yPercent: 0, scaleY: 1, duration: 1.28, stagger: .10 }, .78)
            .fromTo(".showcase-hero .kicker", { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: .82 }, 1.04)
            .fromTo(".hero-copy", { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: .9 }, 1.20)
            .fromTo(".hero-actions", { autoAlpha: 0, y: 38 }, { autoAlpha: 1, y: 0, duration: .9 }, 1.34)
            .fromTo(navSurface, { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 1 }, 1.52)
            .fromTo(".hero-foot", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .8 }, 1.66)
            .set([heroMedia, ...heroLines, navSurface], { clearProps: "willChange" });
        } else if (playOnMountRef.current) {
          finishOpening();
        } else {
          opening?.setAttribute("hidden", "");
        }

        root.querySelectorAll<HTMLElement>("[data-motion-section]").forEach((section) => {
          const index = section.querySelector<HTMLElement>("[data-motion-index]");
          const lines = Array.from(section.querySelectorAll<HTMLElement>("[data-motion-line]"));
          const copies = Array.from(section.querySelectorAll<HTMLElement>("[data-motion-copy]"));
          const groups = Array.from(section.querySelectorAll<HTMLElement>("[data-motion-stagger]"));
          const blocks = Array.from(section.querySelectorAll<HTMLElement>(".motion-block"));
          const mediaFrame = section.querySelector<HTMLElement>("[data-motion-media-frame]");
          const media = section.querySelector<HTMLElement>("[data-motion-media]");
          const timeline = gsap.timeline({
            scrollTrigger: { trigger: section, scroller: root, start: "top 76%", once: true },
            defaults: { ease: "power3.out" },
          });
          if (index) timeline.fromTo(index, { autoAlpha: 0, y: 32 }, { autoAlpha: 1, y: 0, duration: .75 });
          if (lines.length) timeline.fromTo(lines, { yPercent: 112, scaleY: .82 }, { yPercent: 0, scaleY: 1, duration: 1.22, stagger: .09, ease: "power4.out" }, index ? "<+.12" : 0);
          if (copies.length) timeline.fromTo(copies, { autoAlpha: 0, y: 44 }, { autoAlpha: 1, y: 0, duration: .88, stagger: .10 }, "<+.18");
          groups.forEach((group) => {
            const items = Array.from(group.querySelectorAll<HTMLElement>(":scope>[data-motion-stagger-item],:scope>.archive-card,:scope>.border-glow-card"));
            timeline.fromTo(group, { y: 72 }, { y: 0, duration: 1.05 }, "<+.12");
            if (items.length) timeline.fromTo(items, { clipPath: "inset(100% 0 0 0)", willChange: "clip-path" }, { clipPath: "inset(0% 0 0 0)", duration: 1.05, stagger: .14, clearProps: "clipPath,willChange" }, "<+.05");
          });
          if (blocks.length) timeline.fromTo(blocks, { autoAlpha: 0, clipPath: "inset(12% 0 12% 0)" }, { autoAlpha: 1, clipPath: "inset(0% 0 0% 0)", duration: 1.15, stagger: .14, clearProps: "clipPath" }, "<+.12");
          if (mediaFrame) timeline.fromTo(mediaFrame, { clipPath: "inset(14% 0 14% 0)" }, { clipPath: "inset(0% 0 0% 0)", duration: 1.35, clearProps: "clipPath" }, "<+.08");
          if (media) timeline.fromTo(media, { scale: 1.06 }, { scale: 1, duration: 1.5, clearProps: "scale" }, "<");
        });

        if (hero && heroMedia) {
          gsap.fromTo(heroMedia, { yPercent: -3 }, { yPercent: 3, ease: "none", scrollTrigger: { trigger: hero, scroller: root, start: "top top", end: "bottom top", scrub: .9 } });
        }
        const demoSection = root.querySelector<HTMLElement>("#demo");
        const demoMedia = demoSection?.querySelector<HTMLElement>("[data-motion-media]");
        if (demoSection && demoMedia) {
          gsap.fromTo(demoMedia, { yPercent: -4 }, { yPercent: 4, ease: "none", scrollTrigger: { trigger: demoSection, scroller: root, start: "top bottom", end: "bottom top", scrub: 1 } });
        }
      };
      let contextInitializationError: unknown;
      let contextInitializationFailed = false;
      context = gsap.context(() => {
        try {
          initializeScopedMotion();
        } catch (error) {
          contextInitializationFailed = true;
          contextInitializationError = error;
        }
      }, root);
      if (contextInitializationFailed) throw contextInitializationError;

      refreshFrame = window.requestAnimationFrame(() => ScrollTrigger.refresh());
    } catch {
      context?.revert();
      clearMotionStyles(root);
      opening?.setAttribute("hidden", "");
      unsubscribeScroll?.();
      if (ticker) gsap.ticker.remove(ticker);
      lenis?.destroy();
      root.removeEventListener("click", handleAnchorClick);
      root.classList.remove("showcase-motion-active");
      root.classList.remove("showcase-opening-active");
      resolveOpening();
      return;
    }

    return () => {
      window.cancelAnimationFrame(refreshFrame);
      root.removeEventListener("click", handleAnchorClick);
      unsubscribeScroll?.();
      if (ticker) gsap.ticker.remove(ticker);
      lenis?.stop();
      lenis?.destroy();
      context?.revert();
      opening?.setAttribute("hidden", "");
      root.classList.remove("showcase-motion-active");
      root.classList.remove("showcase-opening-active");
    };
  }, [rootRef]);
}
