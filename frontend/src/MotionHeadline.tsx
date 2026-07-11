import { createElement, type ReactNode } from "react";
import "./showcase-motion.css";

type MotionHeadlineProps = {
  as: "h1" | "h2";
  label: string;
  lines: readonly ReactNode[];
  className?: string;
};

export default function MotionHeadline({ as, label, lines, className }: MotionHeadlineProps) {
  return createElement(
    as,
    { "aria-label": label, "data-motion-headline": "", className },
    lines.map((line, index) => (
      <span aria-hidden="true" className="motion-line-mask" key={index}>
        <span className="motion-line" data-motion-line>{line}</span>
      </span>
    )),
  );
}
