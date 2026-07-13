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

  it.each(["entering", "exiting"] as const)("reports one completion for the layer transform in %s", (phase) => {
    const onTransitionComplete = vi.fn();
    render(
      createElement(ViewTransitionStage, {
        phase,
        site: createElement("div"),
        cockpit: createElement("div"),
        onTransitionComplete,
      }),
    );

    fireEvent.transitionEnd(screen.getByTestId("view-layer-site"), { propertyName: "transform" });
    fireEvent.transitionEnd(screen.getByTestId("view-layer-cockpit"), { propertyName: "transform" });

    expect(onTransitionComplete).toHaveBeenCalledTimes(1);
    expect(onTransitionComplete).toHaveBeenCalledWith(phase);
  });

  it("ignores stage, child, and unrelated transition events", () => {
    const onTransitionComplete = vi.fn();
    render(
      createElement(ViewTransitionStage, {
        phase: "entering",
        site: createElement("div", null, createElement("button", { "data-testid": "site-child" })),
        cockpit: createElement("div"),
        onTransitionComplete,
      }),
    );

    fireEvent.transitionEnd(screen.getByTestId("view-transition-stage"), { propertyName: "transform" });
    fireEvent.transitionEnd(screen.getByTestId("site-child"), { propertyName: "transform" });
    fireEvent.transitionEnd(screen.getByTestId("view-transition-stage"), { propertyName: "opacity" });
    fireEvent.transitionEnd(screen.getByTestId("view-layer-site"), { propertyName: "opacity" });

    expect(onTransitionComplete).not.toHaveBeenCalled();
  });

  it("marks every non-current layer inert while preserving ARIA and pointer state", () => {
    const { rerender } = render(
      createElement(ViewTransitionStage, {
        phase: "site",
        site: createElement("button"),
        cockpit: createElement("button"),
        onTransitionComplete: vi.fn(),
      }),
    );

    expect(screen.getByTestId("view-layer-site")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("view-layer-cockpit")).toHaveAttribute("inert");
    expect(screen.getByTestId("view-layer-cockpit")).toHaveAttribute("aria-hidden", "true");

    rerender(
      createElement(ViewTransitionStage, {
        phase: "entering",
        site: createElement("button"),
        cockpit: createElement("button"),
        onTransitionComplete: vi.fn(),
      }),
    );

    expect(screen.getByTestId("view-layer-site")).toHaveAttribute("inert");
    expect(screen.getByTestId("view-layer-cockpit")).toHaveAttribute("inert");
  });
});
