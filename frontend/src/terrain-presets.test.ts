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

  it("matches the complete approved showcase palette literals", () => {
    expect(SHOWCASE_TERRAIN_PRESETS).toEqual({
      hidden: { colors: ["#F3F4E8", "#DCE9DC", "#AECBB5", "#6F9F82"], lineColor: "#3F705D", opacity: 0, speed: 0.052, contourDensity: 17, lineStrength: 0.22 },
      positioning: { colors: ["#F3F4E8", "#DCE9DC", "#AECBB5", "#6F9F82"], lineColor: "#3F705D", opacity: 1, speed: 0.052, contourDensity: 17, lineStrength: 0.22 },
      pain: { colors: ["#102E27", "#255B45", "#76A88B", "#D3E5D6"], lineColor: "#A7CAB2", opacity: 1, speed: 0.046, contourDensity: 19, lineStrength: 0.25 },
      route: { colors: ["#E6EFE6", "#D7E7D8", "#A8C8B0", "#3E725C"], lineColor: "#4C7E68", opacity: 1, speed: 0.05, contourDensity: 20, lineStrength: 0.27 },
      demo: { colors: ["#D8E6DE", "#C8DDD0", "#7FA98E", "#234F40"], lineColor: "#5E8D76", opacity: 1, speed: 0.044, contourDensity: 18, lineStrength: 0.21 },
      product: { colors: ["#BFD4C3", "#DDE8DC", "#81AC91", "#285C48"], lineColor: "#315F4B", opacity: 1, speed: 0.048, contourDensity: 19, lineStrength: 0.24 },
      closing: { colors: ["#102E27", "#1E513F", "#6D9E82", "#C5DECB"], lineColor: "#A5C8B1", opacity: 1, speed: 0.038, contourDensity: 18, lineStrength: 0.22 },
    });
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

  it("matches the exact cockpit risk multiplier literals", () => {
    expect(TERRAIN_RISK_MULTIPLIERS).toEqual({
      low: { speed: 1, density: 1 },
      medium: { speed: 1.08, density: 1.06 },
      high: { speed: 1.16, density: 1.12 },
      unknown: { speed: 1, density: 1 },
    });
  });

  it("applies the exact cockpit risk multipliers", () => {
    const risks: TerrainRiskLevel[] = ["low", "medium", "high", "unknown"];
    const expectedMultipliers: Record<TerrainRiskLevel, { speed: number; density: number }> = {
      low: { speed: 1, density: 1 },
      medium: { speed: 1.08, density: 1.06 },
      high: { speed: 1.16, density: 1.12 },
      unknown: { speed: 1, density: 1 },
    };
    const low = resolveTerrainTarget("dashboard", "hidden", "low");
    risks.forEach((risk) => {
      const target = resolveTerrainTarget("dashboard", "hidden", risk);
      const multiplier = expectedMultipliers[risk];
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
