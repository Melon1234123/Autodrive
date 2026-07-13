import { describe, expect, it } from "vitest";
import { transformCoverBox } from "./video-cover-geometry";

describe("transformCoverBox", () => {
  it("centers the vertical crop for landscape video in a wider slot", () => {
    expect(transformCoverBox(
      { x: 192, y: 108, width: 384, height: 216, sourceWidth: 1920, sourceHeight: 1080 },
      { width: 1000, height: 500 },
    )).toEqual({ left: 100, top: 25, width: 200, height: 112.5 });
  });

  it("centers the horizontal crop for landscape video in a tall slot", () => {
    const transformed = transformCoverBox(
      { x: 720, y: 108, width: 384, height: 216, sourceWidth: 1920, sourceHeight: 1080 },
      { width: 400, height: 600 },
    );
    expect(transformed.left).toBeCloseTo(66.6666667, 6);
    expect(transformed.top).toBe(60);
    expect(transformed.width).toBeCloseTo(213.3333333, 6);
    expect(transformed.height).toBe(120);
  });

  it("uses a zero-offset scale when source and slot have the same aspect ratio", () => {
    expect(transformCoverBox(
      { x: 100, y: 50, width: 200, height: 100, sourceWidth: 1920, sourceHeight: 1080 },
      { width: 960, height: 540 },
    )).toEqual({ left: 50, top: 25, width: 100, height: 50 });
  });
});
