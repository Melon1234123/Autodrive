/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TechnicalRouteSection from "./TechnicalRouteSection";

afterEach(() => {
  cleanup();
  triggerIntersection = null;
  vi.unstubAllGlobals();
});

let triggerIntersection: ((isIntersecting: boolean) => void) | null = null;

class IntersectionObserverMock {
  constructor(private readonly callback: IntersectionObserverCallback) {
    triggerIntersection = (isIntersecting) => callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  observe() {}
  disconnect() {}
}

it("renders the migrated glass route page in the formal 03 section", () => {
  render(<TechnicalRouteSection />);

  const section = screen.getByRole("region", { name: "03 技术路线" });
  const deck = within(section).getByRole("group", { name: "技术路线四个环节" });
  const heading = within(section).getByRole("heading", { level: 1 });

  expect(within(deck).getAllByRole("button")).toHaveLength(4);
  expect(within(deck).getByRole("button", { name: "感知诊断" })).toHaveAttribute("aria-pressed", "true");
  expect(within(deck).getByRole("button", { name: "RLHF 闭环" })).toHaveTextContent("带根因标签的正确/错误推理对训练包。");
  expect(deck.querySelectorAll(".technical-route-note__description-line")).toHaveLength(0);
  expect(within(deck).getByRole("button", { name: "协议接入" })).toHaveTextContent("标准化算法结构描述协议");
  expect(within(deck).getByRole("button", { name: "感知诊断" })).toHaveTextContent("测地距离");
  expect(within(deck).getByRole("button", { name: "决策审计" })).toHaveTextContent("行业安全知识库");
  expect(deck.querySelector(".archive-deck")).not.toBeInTheDocument();
  expect(section).toHaveAttribute("data-motion-section");
  expect(heading).toHaveTextContent("把故障诊断拆成四个可审计环节");
  expect(heading).toHaveAttribute("data-split-text");
  expect(heading.querySelectorAll(".technical-route-demo__title-line")).toHaveLength(2);
  expect(section.querySelector("[data-motion-copy]")).toBeInTheDocument();
  expect(section.querySelector(".technical-route-demo__index")).toHaveTextContent("03 / 技术路线");
  expect(section.querySelector(".technical-route-note__meta")).not.toBeInTheDocument();
});

it("keeps click and keyboard switching on the formal route page", () => {
  render(<TechnicalRouteSection />);

  const section = screen.getByRole("region", { name: "03 技术路线" });
  const decisionNote = screen.getByRole("button", { name: "决策审计" });

  fireEvent.click(decisionNote);
  expect(decisionNote).toHaveAttribute("aria-pressed", "true");

  fireEvent.keyDown(section, { key: "4" });
  expect(screen.getByRole("button", { name: "RLHF 闭环" })).toHaveAttribute("aria-pressed", "true");

  fireEvent.keyDown(section, { key: "ArrowUp" });
  expect(decisionNote).toHaveAttribute("aria-pressed", "true");
});

it("replays the drop animation when the route section is entered again", async () => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  render(<TechnicalRouteSection />);

  await waitFor(() => expect(triggerIntersection).not.toBeNull());
  triggerIntersection?.(true);
  const firstNote = screen.getByRole("button", { name: "协议接入" });

  triggerIntersection?.(false);
  triggerIntersection?.(true);
  await waitFor(() => expect(screen.getByRole("button", { name: "协议接入" })).not.toBe(firstNote));
});
