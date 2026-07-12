/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import PositioningSection from "./PositioningSection";

afterEach(cleanup);

it("renders the positioning orbit with desktop keyboard navigation", () => {
  render(<PositioningSection />);
  const section = document.querySelector("#origin") as HTMLElement;
  expect(section).toBeInTheDocument();
  expect(screen.getByText("01 / 项目定位")).toBeInTheDocument();
  expect(screen.queryByText("RESEARCH PROTOTYPE")).not.toBeInTheDocument();
  expect(screen.queryByText("从单帧现象到全链路证据")).not.toBeInTheDocument();
  const region = screen.getByRole("region", { name: "一套面向研发测试的可解释性诊断与优化系统" });
  const buttons = Array.from(region.querySelectorAll<HTMLButtonElement>("button.positioning-orbit-card"));
  expect(buttons).toHaveLength(4);
  expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  expect(region.querySelectorAll(".positioning-orbit-card-number")).toHaveLength(4);
  expect(region.querySelectorAll(".positioning-orbit-ring-line")).toHaveLength(4);
  expect(region.querySelectorAll(".positioning-orbit-arrow")).toHaveLength(0);
  expect(region.querySelectorAll(".positioning-orbit-card-copy small")).toHaveLength(0);
  expect(Array.from(region.querySelectorAll(".positioning-orbit-anchor")).every((anchor) => anchor.textContent === "")).toBe(true);
  expect(region.querySelector(".positioning-orbit-world")).toHaveAttribute("data-motion-stagger");
  expect(buttons[3]).toHaveTextContent("诊断即训练");
  expect(section).toHaveAttribute("data-motion-section");
  expect(screen.getByRole("heading", { level: 2, name: "一套面向研发测试的可解释性诊断与优化系统" })).toHaveAttribute("data-motion-headline");
  expect(section.querySelector("[data-motion-copy]")).toBeInTheDocument();
});
