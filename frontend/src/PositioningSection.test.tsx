/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import PositioningSection from "./PositioningSection";

afterEach(cleanup);

it("renders positioning copy and four archive cards without the prototype card", () => {
  render(<PositioningSection />);
  const section = document.querySelector("#origin") as HTMLElement;
  expect(section).toBeInTheDocument();
  expect(section.querySelector(".positioning-copy-single")).toBeInTheDocument();
  expect(screen.queryByText("RESEARCH PROTOTYPE")).not.toBeInTheDocument();
  expect(screen.queryByText("从单帧现象到全链路证据")).not.toBeInTheDocument();
  const deck = within(section).getByRole("group", { name: "项目定位四项能力" });
  expect(within(deck).getAllByRole("button")).toHaveLength(4);
  expect(within(deck).getByText("把失效逻辑沉淀为推理对与高价值样本，反哺后续优化。")).toBeInTheDocument();
  expect(section).toHaveAttribute("data-motion-section");
  expect(screen.getByRole("heading", { level: 2, name: "一套面向研发测试的可解释性诊断与优化系统" })).toHaveAttribute("data-motion-headline");
  expect(section.querySelector("[data-motion-copy]")).toBeInTheDocument();
  expect(section.querySelector("[data-motion-stagger]")).toHaveClass("archive-deck");
});
