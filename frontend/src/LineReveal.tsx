import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import "./showcase-motion.css";

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

type LineRevealProps = Omit<HTMLAttributes<HTMLHeadingElement>, "children"> & {
  tag: "h1" | "h2";
  label: string;
  lines: readonly ReactNode[];
  enabled?: boolean;
};

export default function LineReveal({ tag: Tag, label, lines, className = "", enabled = true, ...attributes }: LineRevealProps) {
  const ref = useRef<HTMLHeadingElement | null>(null);

  useGSAP(() => {
    const heading = ref.current;
    const reduced = typeof window === "undefined"
      || typeof window.matchMedia !== "function"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!heading || reduced || !enabled) return;

    const targets = Array.from(heading.querySelectorAll<HTMLElement>("[data-motion-line]"));
    const scroller = heading.closest<HTMLElement>(".cockpit-experience") ?? undefined;
    const tween = gsap.fromTo(targets, { yPercent: 112, scaleY: .82 }, {
      yPercent: 0,
      scaleY: 1,
      duration: 1.22,
      stagger: .09,
      ease: "power4.out",
      scrollTrigger: {
        trigger: heading,
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
  }, { dependencies: [enabled], scope: ref, revertOnUpdate: true });

  return (
    <Tag {...attributes} ref={ref} aria-label={label} className={className} data-line-reveal="">
      {lines.map((line, index) => (
        <span aria-hidden="true" className="motion-line-mask" key={index}>
          <span className="motion-line" data-motion-line>{line}</span>
        </span>
      ))}
    </Tag>
  );
}
