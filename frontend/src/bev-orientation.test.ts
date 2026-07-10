import { describe, expect, it } from "vitest";
import { forwardToScreenDown, verticalVisibleBounds } from "./bev-orientation";

describe("BEV top-to-bottom orientation", () => {
  it("maps increasing forward distance to increasing screen y", () => {
    expect(forwardToScreenDown(0, 120, 4)).toBe(120);
    expect(forwardToScreenDown(10, 120, 4)).toBe(160);
  });

  it("keeps forward screen-down with map depth scaling", () => {
    expect(forwardToScreenDown(12, 80, 3, .9)).toBeCloseTo(112.4);
  });

  it("keeps rear space above ego and forward space below it", () => {
    expect(verticalVisibleBounds(20, 420, 80, 4)).toEqual({ minForward: -15, maxForward: 85 });
  });
});
