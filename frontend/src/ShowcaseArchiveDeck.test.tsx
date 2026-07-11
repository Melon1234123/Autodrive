/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ShowcaseArchiveDeck, { type ShowcaseArchiveItem } from "./ShowcaseArchiveDeck";

const items: ShowcaseArchiveItem[] = [
  { id: 1, title: "能力一", meta: "ONE", description: "第一项说明" },
  { id: 2, title: "能力二", meta: "TWO", description: "第二项说明" },
  { id: 3, title: "能力三", meta: "THREE", description: "第三项说明" },
  { id: 4, title: "能力四", meta: "FOUR", description: "第四项说明" },
];

afterEach(cleanup);

describe("ShowcaseArchiveDeck", () => {
  it("renders four accessible cards with item two active by default", () => {
    render(<ShowcaseArchiveDeck ariaLabel="测试档案" items={items} />);
    const group = screen.getByRole("group", { name: "测试档案" });
    const cards = within(group).getAllByRole("button");
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveAttribute("aria-pressed", "false");
    expect(cards[1]).toHaveAttribute("aria-pressed", "true");
    expect(group.querySelectorAll(".archive-number-mask")).toHaveLength(4);
  });

  it("keeps exactly one card active and does not collapse the active card", () => {
    render(<ShowcaseArchiveDeck ariaLabel="测试档案" items={items} />);
    const group = screen.getByRole("group", { name: "测试档案" });
    const fourth = within(group).getByRole("button", { name: "能力四" });
    fireEvent.click(fourth);
    expect(fourth).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "能力二" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(fourth);
    expect(fourth).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps two deck states independent and renders no rejected chrome", () => {
    render(<>
      <ShowcaseArchiveDeck ariaLabel="档案 A" items={items} />
      <ShowcaseArchiveDeck ariaLabel="档案 B" items={items} />
    </>);
    const first = screen.getByRole("group", { name: "档案 A" });
    const second = screen.getByRole("group", { name: "档案 B" });
    fireEvent.click(within(first).getByRole("button", { name: "能力三" }));
    expect(within(first).getByRole("button", { name: "能力三" })).toHaveAttribute("aria-pressed", "true");
    expect(within(second).getByRole("button", { name: "能力二" })).toHaveAttribute("aria-pressed", "true");
    expect(first.querySelector("svg")).not.toBeInTheDocument();
    expect(within(first).queryByText("MORE")).not.toBeInTheDocument();
  });
});
