/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ShowcaseOpening from "./ShowcaseOpening";

afterEach(cleanup);

it("is hidden by default, decorative, and non-interactive", () => {
  const { container } = render(<ShowcaseOpening />);
  const opening = container.querySelector("[data-motion-opening]");
  expect(opening).toHaveAttribute("hidden");
  expect(opening).toHaveAttribute("aria-hidden", "true");
  expect(opening?.querySelectorAll("[data-motion-opening-panel]")).toHaveLength(3);
  expect(opening?.querySelector("button,a,[tabindex]")).not.toBeInTheDocument();
});
