/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import PositioningOrbitDemo from "./PositioningOrbitDemo";

afterEach(cleanup);

it("renders four orbit items and follows the selected item", () => {
  render(<PositioningOrbitDemo />);

  const region = screen.getByRole("region", { name: "一套面向研发测试的可解释性诊断与优化系统" });
  const world = region.querySelector<HTMLDivElement>(".positioning-orbit-rotation-layer");
  const buttons = Array.from(region.querySelectorAll<HTMLButtonElement>("button.positioning-orbit-card"));
  expect(buttons).toHaveLength(4);
  expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  expect(buttons[2]).toHaveAttribute("aria-pressed", "false");
  expect(world).toHaveStyle("--orbit-angle: 0deg");
  expect(region.querySelectorAll(".positioning-orbit-bound-row.is-visible")).toHaveLength(3);
  expect(region.querySelector(".positioning-orbit-bound-row.is-hidden")).toHaveClass("is-hidden");
  expect(Array.from(region.querySelectorAll(".positioning-orbit-anchor")).every((anchor) => anchor.textContent === "")).toBe(true);
  expect(region.querySelectorAll(".positioning-orbit-card-number")).toHaveLength(4);

  region.querySelectorAll(".positioning-orbit-bound-row").forEach((row) => {
    const rowContent = row.querySelector(".positioning-orbit-row-content");
    expect(rowContent).toContainElement(row.querySelector(".positioning-orbit-anchor"));
    expect(rowContent).toContainElement(row.querySelector(".positioning-orbit-connector"));
    expect(rowContent).toContainElement(row.querySelector(".positioning-orbit-card"));
  });

  fireEvent.click(buttons[2]);

  expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
  expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("当前聚焦 · 03 / 非侵入式接入")).not.toBeInTheDocument();
  expect(world).not.toHaveStyle("--orbit-angle: 0deg");
  expect(world).not.toHaveStyle("--orbit-counter-angle: 0deg");
  expect(region.querySelector(".positioning-orbit-bound-row.is-hidden")).toHaveClass("is-hidden");

  fireEvent.keyDown(region, { key: "4" });

  expect(buttons[3]).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("当前聚焦 · 04 / 诊断即训练")).not.toBeInTheDocument();
});
