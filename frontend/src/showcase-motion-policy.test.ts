/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { resolveShowcaseAnchor, shouldEnableShowcaseMotion } from "./showcase-motion-policy";

describe("showcase motion policy", () => {
  it.each([
    [false, true, true],
    [true, true, false],
    [false, false, false],
    [true, false, false],
  ])("gates reduced=%s desktop=%s to %s", (reducedMotion, desktopFinePointer, expected) => {
    expect(shouldEnableShowcaseMotion({ reducedMotion, desktopFinePointer })).toBe(expected);
  });

  it("resolves only same-showcase hash targets", () => {
    document.body.innerHTML = `<main id="showcase"><section id="product"></section></main><div id="outside"></div>`;
    const root = document.querySelector("#showcase") as HTMLElement;
    expect(resolveShowcaseAnchor(root, "#product")).toBe(document.querySelector("#product"));
    expect(resolveShowcaseAnchor(root, "#outside")).toBeNull();
    expect(resolveShowcaseAnchor(root, "mailto:test@example.com")).toBeNull();
    expect(resolveShowcaseAnchor(root, "#missing")).toBeNull();
  });
});
