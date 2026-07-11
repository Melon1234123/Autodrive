import { describe, expect, it } from "vitest";
import {
  SHOWCASE_TERRAIN_PRESETS,
  TERRAIN_RISK_MULTIPLIERS,
  TERRAIN_TRANSITION_MS,
  interpolateTerrainTarget,
  resolveTerrainTarget,
  type Rgb,
  type TerrainRiskLevel,
} from "./terrain-presets";

function hue([red, green, blue]: Rgb) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta < 0.08) return null;
  const raw = max === red
    ? ((green - blue) / delta) % 6
    : max === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return (raw * 60 + 360) % 360;
}

describe("terrain presets", () => {
  it("uses the approved 700 millisecond palette transition", () => {
    expect(TERRAIN_TRANSITION_MS).toBe(700);
  });

  it("resolves every showcase preset to finite shader values", () => {
    Object.keys(SHOWCASE_TERRAIN_PRESETS).forEach((preset) => {
      const target = resolveTerrainTarget("showcase", preset as keyof typeof SHOWCASE_TERRAIN_PRESETS, "unknown");
      const values = [
        ...target.colors.flat(),
        ...target.lineColor,
        target.opacity,
        target.speed,
        target.contourDensity,
        target.lineStrength,
      ];
      expect(values.every(Number.isFinite)).toBe(true);
    });
  });

  it("hides the hero and shows the positioning terrain", () => {
    expect(resolveTerrainTarget("showcase", "hidden", "unknown").opacity).toBe(0);
    expect(resolveTerrainTarget("showcase", "positioning", "unknown").opacity).toBe(1);
  });

  it("applies the exact cockpit risk multipliers", () => {
    const risks: TerrainRiskLevel[] = ["low", "medium", "high", "unknown"];
    const low = resolveTerrainTarget("dashboard", "hidden", "low");
    risks.forEach((risk) => {
      const target = resolveTerrainTarget("dashboard", "hidden", risk);
      const multiplier = TERRAIN_RISK_MULTIPLIERS[risk];
      expect(target.speed / low.speed).toBeCloseTo(multiplier.speed, 6);
      expect(target.contourDensity / low.contourDensity).toBeCloseTo(multiplier.density, 6);
    });
  });

  it("keeps saturated dashboard colors outside red and orange hues", () => {
    (["low", "medium", "high", "unknown"] as TerrainRiskLevel[]).forEach((risk) => {
      const target = resolveTerrainTarget("dashboard", "hidden", risk);
      [...target.colors, target.lineColor].forEach((color) => {
        const colorHue = hue(color);
        if (colorHue !== null) expect(colorHue).toBeGreaterThanOrEqual(55);
        if (colorHue !== null) expect(colorHue).toBeLessThanOrEqual(180);
      });
    });
  });

  it("interpolates complete targets without mutating endpoints", () => {
    const from = resolveTerrainTarget("showcase", "positioning", "unknown");
    const to = resolveTerrainTarget("showcase", "pain", "unknown");
    const middle = interpolateTerrainTarget(from, to, 0.5);
    expect(middle.opacity).toBeCloseTo((from.opacity + to.opacity) / 2);
    expect(middle.colors[0][0]).toBeCloseTo((from.colors[0][0] + to.colors[0][0]) / 2);
    expect(interpolateTerrainTarget(from, to, 0)).toEqual(from);
    expect(interpolateTerrainTarget(from, to, 1)).toEqual(to);
  });
});
