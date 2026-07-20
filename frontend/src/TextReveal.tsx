import { useRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

type TextRevealTag = "p" | "span" | "div";

type TextRevealProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  tag?: TextRevealTag;
  children: ReactNode;
  delay?: number;
  enabled?: boolean;
};

export default function TextReveal({
  tag = "p",
  children,
  className = "",
  delay = 0,
  enabled = true,
  ...attributes
}: TextRevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useGSAP(() => {
    const element = ref.current;
    const reduced = typeof window === "undefined"
      || typeof window.matchMedia !== "function"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!element || reduced || !enabled) return;

    const scroller = element.closest<HTMLElement>(".showcase, .cockpit-experience") ?? undefined;
    const tween = gsap.fromTo(element, { autoAlpha: 0, y: 24 }, {
      autoAlpha: 1,
      y: 0,
      duration: 0.65,
      ease: "power2.out",
      delay,
      scrollTrigger: {
        trigger: element,
        scroller,
        start: "top 90%-=80px",
        toggleActions: "restart none restart none",
        fastScrollEnd: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, { dependencies: [delay, enabled], scope: ref, revertOnUpdate: true });

  const Tag = tag;
  return (
    <Tag {...attributes} ref={ref as never} className={className} data-text-reveal="">
      {children}
    </Tag>
  );
}
