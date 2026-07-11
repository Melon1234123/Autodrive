/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import TechnicalRouteSection from "./TechnicalRouteSection";

afterEach(cleanup);

it("renders the four exact route modules through the archive deck", () => {
  render(<TechnicalRouteSection />);
  const section = document.querySelector("#route") as HTMLElement;
  expect(section).toBeInTheDocument();
  const deck = within(section).getByRole("group", { name: "技术路线四个环节" });
  expect(within(deck).getAllByRole("button")).toHaveLength(4);
  expect(within(deck).getByRole("button", { name: "感知诊断" })).toHaveAttribute("aria-pressed", "true");
  expect(within(deck).getByText("把诊断 Agent 输出的失效逻辑反向生成正确/错误推理对，形成高价值训练数据包。")).toBeInTheDocument();
  expect(deck.querySelector("article.border-glow-card")).not.toBeInTheDocument();
  expect(section).toHaveAttribute("data-motion-section");
  expect(screen.getByRole("heading", { level: 2, name: "把故障诊断拆成四个可审计环节" })).toHaveAttribute("data-motion-headline");
  expect(section.querySelector("[data-motion-copy]")).toBeInTheDocument();
  expect(section.querySelector("[data-motion-stagger]")).toHaveClass("archive-deck");
});
