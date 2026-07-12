import { describe, expect, it } from "vitest";
import {
  egoScreenYForForwardRange,
  forwardToScreenUp,
  screenXForLeft,
  verticalVisibleBoundsForForwardUp,
} from "./bev-orientation";

describe("BEV fixed-ego orientation", () => {
  it("places farther forward references above the fixed ego", () => {
    expect(forwardToScreenUp(0, 380, 4)).toBe(380);
    expect(forwardToScreenUp(10, 380, 4)).toBe(340);
  });

  it("moves fixed world references down as the ego advances", () => {
    expect(forwardToScreenUp(20, 380, 4)).toBe(300);
    expect(forwardToScreenUp(18, 380, 4)).toBe(308);
  });

  it("keeps rear space below ego and forward space above it", () => {
    expect(verticalVisibleBoundsForForwardUp(20, 420, 380, 4)).toEqual({ minForward: -10, maxForward: 90 });
  });

  it("places positive left on the left side of the screen for every layer", () => {
    expect(screenXForLeft(6, 200, 4)).toBe(176);
    expect(screenXForLeft(-4.5, 200, 4)).toBe(218);
    expect(screenXForLeft(3, 200, 4, 0.5)).toBe(194);
  });

  it("places ego near the lower edge for the default 76m/12m view", () => {
    const panelTop = 20;
    const panelHeight = 400;
    const scale = panelHeight / (76 + 12);
    const egoScreenY = egoScreenYForForwardRange(panelTop, panelHeight, scale, 76, 12);

    expect(egoScreenY).toBeCloseTo(panelTop + 76 * scale);
    expect(forwardToScreenUp(76, egoScreenY, scale)).toBeCloseTo(panelTop);
    expect(forwardToScreenUp(-12, egoScreenY, scale)).toBeCloseTo(panelTop + panelHeight);
    const bounds = verticalVisibleBoundsForForwardUp(panelTop, panelTop + panelHeight, egoScreenY, scale);
    expect(bounds.minForward).toBeCloseTo(-12);
    expect(bounds.maxForward).toBeCloseTo(76);
  });
});
