/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import ContextCardsDemo from "./ContextCardsDemo";

vi.mock("./GlassSurface", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

it("renders the reference-style three-card safety evidence demo", () => {
  render(<ContextCardsDemo />);

  expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  expect(screen.getByText("02 / 安全命题")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "规模化上路之后，安全需要过程可信" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "安全命题证据卡片" })).toBeInTheDocument();
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getByText(/《智能汽车创新发展战略》/)).toBeInTheDocument();
  expect(screen.getByText(/监管与规模化研发效率正在同时改变安全命题/)).toBeInTheDocument();
  expect(screen.getByText("2023 L3 / L4 试点")).toBeInTheDocument();
  expect(screen.getByText("58% L2及以上新车占比")).toBeInTheDocument();
  expect(screen.getByText("3 个工作日 → 分钟级")).toBeInTheDocument();
  expect(screen.getByText("前 20% 高价值样本")).toBeInTheDocument();
  expect(screen.getByText("L2及以上新车占比")).toBeInTheDocument();
  expect(screen.getByText("人工复盘")).toBeInTheDocument();
  expect(screen.getByText("智能诊断")).toBeInTheDocument();
  expect(document.querySelectorAll(".context-demo-policy-arrow")).toHaveLength(0);
  expect(document.querySelectorAll(".context-demo-workflow-arrow-piece")).toHaveLength(3);
  expect(screen.getByText(/进入真实道路场景后/)).toBeInTheDocument();
  expect(screen.getByText(/视频、点云、地图与车辆状态/)).toBeInTheDocument();
  expect(screen.queryByText(/申报书给出的/)).not.toBeInTheDocument();
  expect(screen.getByText("走向")).toBeInTheDocument();
  expect(screen.getByText("过程可信")).toBeInTheDocument();
  expect(screen.getByText("长尾风险")).toBeInTheDocument();
  expect(screen.getByText("压缩")).toBeInTheDocument();
  expect(screen.getByText("证据闭环")).toBeInTheDocument();
  expect(screen.queryByText("POLICY / 2020 → 2025")).not.toBeInTheDocument();
  expect(screen.queryByText("RISK / SCALE EFFECT")).not.toBeInTheDocument();
  expect(screen.queryByText("WORKFLOW / DIAGNOSIS LOOP")).not.toBeInTheDocument();
});
