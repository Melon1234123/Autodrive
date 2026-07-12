/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  resolveShowcaseAnchor,
  resolveShowcasePageCommand,
  resolveShowcasePageDestination,
  shouldEnableShowcaseMotion,
} from "./showcase-motion-policy";

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

describe("showcase page navigation", () => {
  it.each([
    ["ArrowDown", false, "next"],
    ["PageDown", false, "next"],
    [" ", false, "next"],
    ["ArrowUp", false, "previous"],
    ["PageUp", false, "previous"],
    [" ", true, "previous"],
    ["Home", false, "first"],
    ["End", false, "last"],
  ] as const)("maps %s shift=%s to %s", (key, shiftKey, expected) => {
    expect(resolveShowcasePageCommand({
      key, shiftKey, altKey: false, ctrlKey: false, metaKey: false,
      defaultPrevented: false, repeat: false,
    }, document.body)).toBe(expected);
  });

  it("ignores modified, repeated, editable, and button-space input", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    expect(resolveShowcasePageCommand({ key: "PageDown", shiftKey: false, altKey: false, ctrlKey: true, metaKey: false, defaultPrevented: false, repeat: false }, document.body)).toBeNull();
    expect(resolveShowcasePageCommand({ key: "PageDown", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, repeat: true }, document.body)).toBeNull();
    expect(resolveShowcasePageCommand({ key: "PageDown", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, repeat: false }, input)).toBeNull();
    expect(resolveShowcasePageCommand({ key: " ", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, repeat: false }, button)).toBeNull();
  });

  it.each([
    ["next", 0, 7, 1],
    ["previous", 3, 7, 2],
    ["first", 4, 7, 0],
    ["last", 2, 7, 6],
    ["previous", 0, 7, null],
    ["next", 6, 7, null],
  ] as const)("resolves %s from %s/%s to %s", (command, current, count, expected) => {
    expect(resolveShowcasePageDestination(command, current, count)).toBe(expected);
  });
});
