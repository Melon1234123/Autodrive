import { useLayoutEffect, useRef, type RefObject } from "react";
import Lenis, { type VirtualScrollData } from "lenis";
import Snap from "lenis/snap";
import "lenis/dist/lenis.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  DESKTOP_SHOWCASE_MOTION_QUERY,
  resolveShowcaseAnchor,
  resolveShowcasePageCommand,
  resolveShowcasePageDestination,
  shouldEnableShowcaseMotion,
} from "./showcase-motion-policy";

gsap.registerPlugin(ScrollTrigger);

type ShowcaseMotionOptions = {
  rootRef: RefObject<HTMLElement | null>;
  playOpening: boolean;
  onOpeningComplete: () => void;
  enabled?: boolean;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const WHEEL_GESTURE_SETTLE_MS = 120;
const WHEEL_GESTURE_EXCLUSION = [
  "input", "textarea", "select", "[contenteditable]:not([contenteditable='false'])",
  "[data-lenis-prevent]", "[data-lenis-prevent-wheel]", "[data-lenis-prevent-vertical]",
].join(",");

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

function subscribeToMediaQuery(query: MediaQueryList | null, listener: () => void) {
  if (!query) return () => undefined;
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }
  query.addListener(listener);
  return () => query.removeListener(listener);
}

export function useShowcaseMotion({ rootRef, playOpening, onOpeningComplete, enabled = true }: ShowcaseMotionOptions) {
  const playOnMountRef = useRef(playOpening);
  const completeRef = useRef(onOpeningComplete);
  const openingResolvedRef = useRef(false);
  if (!playOpening) playOnMountRef.current = false;
  completeRef.current = onOpeningComplete;

  useLayoutEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    const opening = root.querySelector<HTMLElement>("[data-motion-opening]");
    const resolveOpening = () => {
      if (!playOnMountRef.current || openingResolvedRef.current) return;
      openingResolvedRef.current = true;
      completeRef.current();
    };

    const reducedQuery = window.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
    const desktopQuery = window.matchMedia?.(DESKTOP_SHOWCASE_MOTION_QUERY) ?? null;
    let disposeRuntime: (() => void) | null = null;
    let effectDisposed = false;

    const revealFinalState = (clearStyles: boolean) => {
      opening?.setAttribute("hidden", "");
      root.classList.remove("showcase-motion-active");
      root.classList.remove("showcase-opening-active");
      if (clearStyles) clearMotionStyles(root);
    };

    const createRuntime = (): (() => void) | null => {
      const content = root.querySelector<HTMLElement>("[data-lenis-content]");
      if (!content) {
        revealFinalState(false);
        resolveOpening();
        return null;
      }

      const shouldPlayOpening = playOnMountRef.current && !openingResolvedRef.current;
      const pages = Array.from(content.querySelectorAll<HTMLElement>(
        ":scope > .showcase-hero, :scope > [data-motion-section]",
      ));
      const easing = (time: number) => Math.min(1, 1.001 - Math.pow(2, -10 * time));
      let context: gsap.Context | null = null;
      let lenis: Lenis | null = null;
      let snap: Snap | null = null;
      let pageNavigationLocked = shouldPlayOpening;
      let unsubscribeScroll: (() => void) | null = null;
      let refreshFrame = 0;
      let wheelGestureTimer = 0;
      let wheelGestureActive = false;
      let ticker: ((time: number) => void) | null = null;
      let runtimeActive = true;

      const currentPageIndex = () => pages.reduce((best, page, index) => (
        Math.abs(page.offsetTop - root.scrollTop) < Math.abs(pages[best].offsetTop - root.scrollTop) ? index : best
      ), 0);

      const goToPage = (index: number) => {
        if (!snap || lenis?.isLocked || pageNavigationLocked || index < 0 || index >= pages.length) return false;
        if (index === currentPageIndex()) return true;
        snap.goTo(index);
        return true;
      };

      const resumeSnapWhenReady = () => {
        if (runtimeActive && !pageNavigationLocked && !wheelGestureActive) snap?.start();
      };

      const holdWheelGesture = () => {
        wheelGestureActive = true;
        window.clearTimeout(wheelGestureTimer);
        wheelGestureTimer = window.setTimeout(() => {
          wheelGestureTimer = 0;
          wheelGestureActive = false;
          resumeSnapWhenReady();
        }, WHEEL_GESTURE_SETTLE_MS);
      };

      const hasExcludedWheelTarget = (event: WheelEvent) => {
        const path = event.composedPath();
        const rootIndex = path.indexOf(root);
        const scopedPath = rootIndex >= 0 ? path.slice(0, rootIndex) : path;
        if (scopedPath.some((node) => node instanceof Element && node.matches(WHEEL_GESTURE_EXCLUSION))) return true;
        let target = event.target instanceof Element ? event.target : null;
        while (target && target !== root) {
          if (target.matches(WHEEL_GESTURE_EXCLUSION)) return true;
          target = target.parentElement;
        }
        return false;
      };

      const handleVirtualScroll = ({ deltaX, deltaY, event }: VirtualScrollData) => {
        if (!runtimeActive) return true;
        if (event.type !== "wheel") return true;
        const wheelEvent = event as WheelEvent;
        const gestureWasActive = wheelGestureActive;
        snap?.stop();
        holdWheelGesture();

        const isVertical = deltaY !== 0 && Math.abs(deltaY) > Math.abs(deltaX);
        const isModified = wheelEvent.altKey || wheelEvent.ctrlKey || wheelEvent.metaKey || wheelEvent.shiftKey;
        if (
          !wheelEvent.cancelable || wheelEvent.defaultPrevented || !isVertical || isModified ||
          hasExcludedWheelTarget(wheelEvent)
        ) return false;

        wheelEvent.preventDefault();
        if (gestureWasActive || pageNavigationLocked || lenis?.isLocked) return false;
        const command = deltaY > 0 ? "next" : "previous";
        const destination = resolveShowcasePageDestination(command, currentPageIndex(), pages.length);
        if (destination !== null) goToPage(destination);
        return false;
      };

      const handleAnchorClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
        if (!link || !root.contains(link)) return;
        const target = resolveShowcaseAnchor(root, link.getAttribute("href") ?? "");
        if (!target) return;
        event.preventDefault();
        const pageIndex = pages.findIndex((page) => page === target || page.contains(target));
        if (pageIndex >= 0) {
          if (goToPage(pageIndex)) window.history.pushState(null, "", link.hash);
          return;
        }
        if (!lenis || lenis.isLocked || pageNavigationLocked) return;
        lenis.scrollTo(target, { duration: 1.05, lock: true });
        window.history.pushState(null, "", link.hash);
      };

      const handlePageKey = (event: KeyboardEvent) => {
        const command = resolveShowcasePageCommand(event, event.target);
        if (!command) return;
        const destination = resolveShowcasePageDestination(command, currentPageIndex(), pages.length);
        if (destination === null || !goToPage(destination)) return;
        event.preventDefault();
      };

      const finishOpening = () => {
        if (!runtimeActive) return;
        opening?.setAttribute("hidden", "");
        root.classList.remove("showcase-opening-active");
        pageNavigationLocked = false;
        resumeSnapWhenReady();
        lenis?.start();
        resolveOpening();
      };

      const dispose = () => {
        if (!runtimeActive) return;
        runtimeActive = false;
        window.cancelAnimationFrame(refreshFrame);
        window.clearTimeout(wheelGestureTimer);
        root.removeEventListener("click", handleAnchorClick);
        window.removeEventListener("keydown", handlePageKey);
        unsubscribeScroll?.();
        if (ticker) gsap.ticker.remove(ticker);
        snap?.stop();
        snap?.destroy();
        snap = null;
        lenis?.stop();
        lenis?.destroy();
        context?.revert();
        revealFinalState(true);
      };

      try {
        root.classList.add("showcase-motion-active");
        lenis = new Lenis({
          wrapper: root,
          content,
          autoRaf: false,
          duration: 1.32,
          easing,
          smoothWheel: true,
          syncTouch: false,
          overscroll: true,
          virtualScroll: handleVirtualScroll,
        });
        snap = new Snap(lenis, {
          type: "lock",
          duration: 1.05,
          debounce: 90,
          easing,
          onSnapStart: () => {
            pageNavigationLocked = true;
            snap?.stop();
          },
          onSnapComplete: () => {
            pageNavigationLocked = false;
            resumeSnapWhenReady();
          },
        });
        snap.addElements(pages, { align: "start", ignoreTransform: true });
        unsubscribeScroll = lenis.on("scroll", ScrollTrigger.update);
        ticker = (time) => lenis?.raf(time * 1000);
        gsap.ticker.add(ticker);
        root.addEventListener("click", handleAnchorClick);
        window.addEventListener("keydown", handlePageKey);
        if (shouldPlayOpening) {
          root.classList.add("showcase-opening-active");
          snap.stop();
          lenis.stop();
        } else {
          snap.start();
        }

        const initializeScopedMotion = () => {
          const hero = root.querySelector<HTMLElement>("[data-motion-hero]");
          const heroMedia = root.querySelector<HTMLElement>("[data-motion-hero-media]");
          const openingPanels = Array.from(root.querySelectorAll<HTMLElement>("[data-motion-opening-panel]"));
          const heroLines = Array.from(hero?.querySelectorAll<HTMLElement>("[data-motion-line]") ?? []);
          const navSurface = root.querySelector<HTMLElement>(".showcase-nav-glass");

          if (shouldPlayOpening && opening && hero && heroMedia) {
            opening.removeAttribute("hidden");
            const openingTimeline = gsap.timeline({ defaults: { ease: "power4.out" }, onComplete: finishOpening });
            openingTimeline
              .fromTo(heroMedia, { scale: 1.08 }, { scale: 1, duration: 3, willChange: "transform" }, 0)
              .fromTo(openingPanels, { yPercent: 0 }, { yPercent: (index) => index % 2 ? 102 : -102, duration: 1.68, stagger: .08 }, .34)
              .fromTo(heroLines, { yPercent: 115, scaleY: .78 }, { yPercent: 0, scaleY: 1, duration: 1.4, stagger: .10 }, .88)
              .fromTo(".showcase-hero .kicker", { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: .9 }, 1.16)
              .fromTo(".hero-copy", { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: .98 }, 1.38)
              .fromTo(".hero-actions", { autoAlpha: 0, y: 38 }, { autoAlpha: 1, y: 0, duration: .98 }, 1.54)
              .fromTo(navSurface, { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 1.1 }, 1.72)
              .fromTo(".hero-foot", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 1 }, 2)
              .set([heroMedia, ...heroLines, navSurface], { clearProps: "willChange" });
          } else if (shouldPlayOpening) {
            finishOpening();
          } else {
            opening?.setAttribute("hidden", "");
          }

          if (hero) {
            const heroReturnTimeline = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
            heroReturnTimeline
              .fromTo(heroLines, { yPercent: 112, scaleY: .82 }, { yPercent: 0, scaleY: 1, duration: 1.22, stagger: .09, ease: "power4.out", immediateRender: false })
              .fromTo(hero.querySelector(".kicker"), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: .75, immediateRender: false }, "<+.08")
              .fromTo(hero.querySelector(".hero-copy"), { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: .88, immediateRender: false }, "<+.12")
              .fromTo(hero.querySelector(".hero-actions"), { autoAlpha: 0, y: 38 }, { autoAlpha: 1, y: 0, duration: .88, immediateRender: false }, "<+.12")
              .fromTo(hero.querySelector(".hero-foot"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .8, immediateRender: false }, "<+.12");

            ScrollTrigger.create({
              trigger: hero,
              scroller: root,
              start: "top top",
              end: "bottom 24%",
              onEnterBack: () => {
                if (runtimeActive) heroReturnTimeline.restart();
              },
            });
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
              scrollTrigger: {
                trigger: section,
                scroller: root,
                start: "top 76%",
                end: "bottom 24%",
                toggleActions: "restart none restart none",
              },
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
            if (media) timeline.fromTo(media, { scale: 1.06 }, { scale: 1, duration: 1.5 }, "<");
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

        refreshFrame = window.requestAnimationFrame(() => {
          snap?.resize();
          ScrollTrigger.refresh();
        });
        return dispose;
      } catch {
        dispose();
        resolveOpening();
        return null;
      }
    };

    const reconcileMotion = () => {
      if (effectDisposed) return;
      const enabled = shouldEnableShowcaseMotion({
        reducedMotion: reducedQuery?.matches ?? true,
        desktopFinePointer: desktopQuery?.matches ?? false,
      });
      if (!enabled) {
        disposeRuntime?.();
        disposeRuntime = null;
        revealFinalState(false);
        resolveOpening();
        return;
      }
      if (!disposeRuntime) disposeRuntime = createRuntime();
    };

    const unsubscribeReducedQuery = subscribeToMediaQuery(reducedQuery, reconcileMotion);
    const unsubscribeDesktopQuery = subscribeToMediaQuery(desktopQuery, reconcileMotion);
    reconcileMotion();

    return () => {
      effectDisposed = true;
      unsubscribeReducedQuery();
      unsubscribeDesktopQuery();
      disposeRuntime?.();
      disposeRuntime = null;
    };
  }, [enabled, rootRef]);
}
