import { useEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText as GSAPSplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import "./SplitText.css";

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);
}

type SplitTextTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span";
type MotionVars = Record<string, string | number | boolean | undefined>;

export type SplitTextProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  tag?: SplitTextTag;
  text?: string;
  children?: ReactNode;
  ariaLabel?: string;
  delay?: number;
  duration?: number;
  ease?: string;
  splitType?: string;
  from?: MotionVars;
  to?: MotionVars;
  threshold?: number;
  rootMargin?: string;
  textAlign?: CSSProperties["textAlign"];
  startDelay?: number;
  onLetterAnimationComplete?: () => void;
};

function shouldReduceMotion() {
  return typeof window === "undefined"
    || typeof window.matchMedia !== "function"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollStart(threshold: number, rootMargin: string) {
  const startPct = (1 - threshold) * 100;
  const match = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(rootMargin);
  const value = match ? Number.parseFloat(match[1]) : 0;
  const unit = match?.[2] || "px";
  const adjustment = value === 0 ? "" : value < 0 ? `-=${Math.abs(value)}${unit}` : `+=${value}${unit}`;
  return `top ${startPct}%${adjustment}`;
}

export default function SplitText({
  tag = "p",
  text = "",
  children,
  ariaLabel,
  className = "",
  delay = 45,
  duration = 0.8,
  ease = "elastic.out(1, 0.3)",
  splitType = "chars",
  from = { opacity: 0, y: 40 },
  to = { opacity: 1, y: 0 },
  threshold = 0.1,
  rootMargin = "-80px",
  textAlign,
  startDelay = 0,
  onLetterAnimationComplete,
  style,
  ...attributes
}: SplitTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const completedRef = useRef(false);
  const completionRef = useRef(onLetterAnimationComplete);
  const [fontsLoaded, setFontsLoaded] = useState(() => (
    typeof document === "undefined" || !document.fonts || document.fonts.status === "loaded"
  ));

  useEffect(() => {
    completionRef.current = onLetterAnimationComplete;
  }, [onLetterAnimationComplete]);

  useEffect(() => {
    if (fontsLoaded || !document.fonts) return;
    let active = true;
    document.fonts.ready.then(() => {
      if (active) setFontsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [fontsLoaded]);

  useGSAP(() => {
    const element = ref.current;
    if (!element || !fontsLoaded || completedRef.current || shouldReduceMotion()) return;

    let split: GSAPSplitText | null = null;
    let tween: gsap.core.Tween | null = null;
    try {
      split = new GSAPSplitText(element, {
        type: splitType,
        smartWrap: true,
        autoSplit: splitType.includes("lines"),
        linesClass: "split-line",
        wordsClass: "split-word",
        charsClass: "split-char",
        reduceWhiteSpace: false,
        onSplit(self) {
          const targets = splitType.includes("chars") && self.chars.length
            ? self.chars
            : splitType.includes("words") && self.words.length
              ? self.words
              : self.lines;
          if (!targets.length) return;
          const scroller = element.closest<HTMLElement>(".showcase, .cockpit-experience") ?? undefined;
          tween = gsap.fromTo(targets, { ...from }, {
            ...to,
            duration,
            ease,
            stagger: delay / 1000,
            delay: startDelay,
            scrollTrigger: {
              trigger: element,
              scroller,
              start: scrollStart(threshold, rootMargin),
              toggleActions: "restart none restart none",
              fastScrollEnd: true,
              anticipatePin: 0.4,
            },
            onComplete: () => {
              completedRef.current = true;
              completionRef.current?.();
            },
            willChange: "transform, opacity",
            force3D: true,
          });
        },
      });
    } catch {
      split?.revert();
      return;
    }

    return () => {
      tween?.scrollTrigger?.kill();
      tween?.kill();
      split?.revert();
    };
  }, {
    dependencies: [
      text,
      ariaLabel,
      delay,
      duration,
      ease,
      splitType,
      JSON.stringify(from),
      JSON.stringify(to),
      threshold,
      rootMargin,
      startDelay,
      fontsLoaded,
    ],
    scope: ref,
    revertOnUpdate: true,
  });

  const Tag = tag;
  return (
    <Tag
      {...attributes}
      ref={ref as never}
      aria-label={ariaLabel}
      className={`split-parent ${className}`.trim()}
      data-split-text=""
      style={{ ...style, textAlign }}
    >
      {children ?? text}
    </Tag>
  );
}
