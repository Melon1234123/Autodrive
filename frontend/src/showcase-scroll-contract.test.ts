import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const motion = readFileSync(resolve(process.cwd(), "src/showcase-motion.css"), "utf8");

describe("showcase full-page scroll contract", () => {
  it("restores native snap as the final-content fallback", () => {
    expect(styles).toMatch(/\.showcase\s*\{[^}]*scroll-behavior:smooth;[^}]*scroll-snap-type:y mandatory;/s);
    expect(styles).toMatch(/\.showcase-scroll-content>[^\{]+\{[^}]*scroll-snap-align:start;[^}]*scroll-snap-stop:always;/s);
  });

  it("disables CSS snap only while Lenis Snap owns motion", () => {
    expect(motion).toMatch(/\.showcase\.showcase-motion-active\s*\{[^}]*scroll-behavior:auto;[^}]*scroll-snap-type:none;/s);
  });

  it("contains no opening rule styling", () => {
    expect(motion).not.toContain("showcase-opening-rule");
  });
});
