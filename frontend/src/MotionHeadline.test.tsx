/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import MotionHeadline from "./MotionHeadline";

afterEach(cleanup);

it("keeps the original ordered-line effect as the default", () => {
  render(<MotionHeadline as="h1" label="让每一次自动驾驶决策有据可循" lines={[
    <>让每一次</>,
    <><em>自动驾驶决策</em>有据可循</>,
  ]} />);
  const heading = screen.getByRole("heading", { level: 1, name: "让每一次自动驾驶决策有据可循" });
  expect(heading).toHaveAttribute("data-motion-headline");
  expect(heading).not.toHaveAttribute("data-split-text");
  expect(heading.querySelectorAll("[data-motion-line]")).toHaveLength(2);
  expect(heading.querySelectorAll("[aria-hidden=true]")).toHaveLength(2);
});

it("uses SplitText only when explicitly requested", () => {
  render(<MotionHeadline as="h1" split label="让每一次自动驾驶决策有据可循" lines={[
    <>让每一次</>,
    <><em>自动驾驶决策</em>有据可循</>,
  ]} />);

  expect(screen.getByRole("heading", { name: "让每一次自动驾驶决策有据可循" })).toHaveAttribute("data-split-text");
});
