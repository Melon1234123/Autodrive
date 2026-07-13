/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewTransitionStage } from "./ViewTransitionStage";

afterEach(cleanup);

describe("ViewTransitionStage", () => {
  it("exposes the phase and keeps the cockpit layer offscreen before entry", () => {
    render(
      createElement(ViewTransitionStage, {
        phase: "site",
        site: createElement("div", null, "site content"),
        cockpit: createElement("div", null, "cockpit content"),
        onTransitionComplete: vi.fn(),
      }),
    );

    const stage = screen.getByTestId("view-transition-stage");
    expect(stage).toHaveAttribute("data-view-transition-phase", "site");
    expect(screen.getByTestId("view-layer-site")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTestId("view-layer-cockpit")).toHaveAttribute("aria-hidden", "true");
  });

  it.each(["entering", "exiting"] as const)("reports completion for %s", (phase) => {
    const onTransitionComplete = vi.fn();
    render(
      createElement(ViewTransitionStage, {
        phase,
        site: createElement("div"),
        cockpit: createElement("div"),
        onTransitionComplete,
      }),
    );

    fireEvent.transitionEnd(screen.getByTestId("view-transition-stage"), { propertyName: "transform" });

    expect(onTransitionComplete).toHaveBeenCalledWith(phase);
  });

  it("ignores unrelated transition properties", () => {
    const onTransitionComplete = vi.fn();
    render(
      createElement(ViewTransitionStage, {
        phase: "entering",
        site: createElement("div"),
        cockpit: createElement("div"),
        onTransitionComplete,
      }),
    );

    fireEvent.transitionEnd(screen.getByTestId("view-transition-stage"), { propertyName: "opacity" });

    expect(onTransitionComplete).not.toHaveBeenCalled();
  });
});
