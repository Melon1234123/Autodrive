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

  it("defines one wide desktop geometry contract", () => {
    expect(styles).toMatch(/\.showcase\s*\{[^}]*--showcase-content-width:min\(90vw,2480px\);/s);
    expect(styles).toMatch(/\.content-width\s*\{[^}]*width:var\(--showcase-content-width\);/s);
    expect(styles).toMatch(/\.showcase-nav\s*\{[^}]*width:var\(--showcase-content-width\);/s);
    expect(styles).toMatch(/\.showcase-scroll-content>\.intro-section,[^\{]+\{[^}]*min-height:100svh;[^}]*height:auto;[^}]*overflow:visible;/s);
  });

  it("keeps hero media inside one viewport page", () => {
    expect(styles).toMatch(/\.showcase-hero\s*\{[^}]*height:100svh;[^}]*max-height:100svh;[^}]*overflow:hidden;/s);
    expect(styles).toMatch(/\.showcase-scroll-content>\.showcase-hero\s*\{[^}]*height:100svh;[^}]*max-height:100svh;[^}]*overflow:hidden;/s);
  });

  it("keeps the demo label positioned while matching the first chevron motion", () => {
    expect(styles).toMatch(/\.demo-swipe-label\s*\{[^}]*top: 50%;[^}]*right: calc\(var\(--demo-glass-width\) \+ 8px\);[^}]*width: 90px;[^}]*transform: translateY\(-50%\);/s);
    expect(styles).toMatch(/\.demo-swipe-label\s*\{[^}]*color: var\(--acid\);/s);
    expect(styles).toMatch(/\.demo-swipe-label-motion > span:first-child\s*\{[^}]*color: #9fd2c4;/s);
    expect(styles).toMatch(/\.demo-swipe-label-motion > span:last-child\s*\{[^}]*color: var\(--acid\);/s);
    expect(styles).toMatch(/\.demo-swipe-label-motion\s*\{[^}]*animation: demo-swipe-chevron 1\.35s ease-in-out infinite;/s);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.demo-swipe-label-motion\s*\{\s*animation: none;\s*\}/s);
  });

  it("uses lighter colors for the closing support words without reducing their weight", () => {
    expect(styles).toMatch(/\.footer-statement--primary\s*\{[^}]*color: #426c55;[^}]*font-weight: 500;/s);
    expect(styles).toMatch(/\.footer-statement--secondary\s*\{[^}]*color: #e7f59a;[^}]*font-weight: 500;/s);
    expect(styles).toMatch(/\.footer-statement-focus--primary,[^{]*\.footer-statement-focus--secondary\s*\{[^}]*font-weight: 700;/s);
    expect(styles).toMatch(/\.footer-statement-focus--primary\s*\{[^}]*color: #143b2e;/s);
    expect(styles).toMatch(/\.footer-statement-focus--secondary\s*\{[^}]*color: var\(--acid\);/s);
  });

  it("serves the closing road decorations as WebP images", () => {
    expect(styles).toContain('url("/closing-road-no-tree.webp")');
  });
});
