/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ClosingTypographyDemo from "./ClosingTypographyDemo";

afterEach(cleanup);

it("lets the user compare and select three closing-page typography directions", () => {
  render(<ClosingTypographyDemo />);

  const choices = screen.getByRole("group", { name: "选择字体方案" });
  const evidence = screen.getByRole("button", { name: "选择 B · 证据宋体" });
  const verdict = screen.getByRole("button", { name: "选择 C · 裁决混排" });
  const stage = screen.getByRole("region", { name: "终页字体方案：B · 证据宋体" });

  expect(choices.querySelectorAll("button")).toHaveLength(3);
  expect(evidence).toHaveAttribute("aria-pressed", "true");
  expect(stage).toHaveClass("closing-type-demo__stage--evidence");
  expect(screen.getByLabelText("安全不是一句承诺")).toBeInTheDocument();
  expect(screen.getByLabelText("它应当被证明")).toBeInTheDocument();

  fireEvent.click(verdict);

  expect(verdict).toHaveAttribute("aria-pressed", "true");
  expect(evidence).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("region", { name: "终页字体方案：C · 裁决混排" })).toHaveClass("closing-type-demo__stage--verdict");
});
