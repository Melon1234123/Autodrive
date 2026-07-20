import { createElement, type ReactNode } from "react";
import SplitText from "./SplitText";
import "./showcase-motion.css";

type MotionHeadlineProps = {
  as: "h1" | "h2";
  label: string;
  lines: readonly ReactNode[];
  className?: string;
  startDelay?: number;
  split?: boolean;
};

export default function MotionHeadline({ as, label, lines, className, startDelay = 0, split = false }: MotionHeadlineProps) {
  const content = lines.map((line, index) => (
    <span aria-hidden="true" className="motion-line-mask" key={index}>
      <span className="motion-line" data-motion-line>{line}</span>
    </span>
  ));

  if (!split) {
    return createElement(as, {
      "aria-label": label,
      "data-motion-headline": "",
      className,
    }, content);
  }

  return (
    <SplitText
      tag={as}
      ariaLabel={label}
      className={className}
      data-motion-headline=""
      startDelay={startDelay}
    >
      {content}
    </SplitText>
  );
}
