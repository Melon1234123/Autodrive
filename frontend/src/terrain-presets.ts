export type ShowcaseTerrainPreset = "hidden" | "positioning" | "pain" | "route" | "demo" | "product" | "closing";
export type TerrainView = "showcase" | "dashboard";
export type TerrainRiskLevel = "low" | "medium" | "high" | "unknown";
export type Rgb = readonly [number, number, number];
export type TerrainTarget = {
  colors: readonly [Rgb, Rgb, Rgb, Rgb];
  lineColor: Rgb;
  opacity: number;
  speed: number;
  contourDensity: number;
  lineStrength: number;
};

type HexPalette = {
  colors: readonly [string, string, string, string];
  lineColor: string;
  opacity: number;
  speed: number;
  contourDensity: number;
  lineStrength: number;
};

export const TERRAIN_TRANSITION_MS = 700;
const COCKPIT_BASE_SPEED = 0.05;
const COCKPIT_BASE_DENSITY = 18;

export const SHOWCASE_TERRAIN_PRESETS: Record<ShowcaseTerrainPreset, HexPalette> = {
  hidden: { colors: ["#F3F4E8", "#DCE9DC", "#AECBB5", "#6F9F82"], lineColor: "#3F705D", opacity: 0, speed: 0.052, contourDensity: 17, lineStrength: 0.22 },
  positioning: { colors: ["#F3F4E8", "#DCE9DC", "#AECBB5", "#6F9F82"], lineColor: "#3F705D", opacity: 1, speed: 0.052, contourDensity: 17, lineStrength: 0.22 },
  pain: { colors: ["#102E27", "#255B45", "#76A88B", "#D3E5D6"], lineColor: "#A7CAB2", opacity: 1, speed: 0.046, contourDensity: 19, lineStrength: 0.25 },
  route: { colors: ["#E6EFE6", "#D7E7D8", "#A8C8B0", "#3E725C"], lineColor: "#4C7E68", opacity: 1, speed: 0.05, contourDensity: 20, lineStrength: 0.27 },
  demo: { colors: ["#D8E6DE", "#C8DDD0", "#7FA98E", "#234F40"], lineColor: "#5E8D76", opacity: 1, speed: 0.044, contourDensity: 18, lineStrength: 0.21 },
  product: { colors: ["#BFD4C3", "#DDE8DC", "#81AC91", "#285C48"], lineColor: "#315F4B", opacity: 1, speed: 0.048, contourDensity: 19, lineStrength: 0.24 },
  closing: { colors: ["#102E27", "#1E513F", "#6D9E82", "#C5DECB"], lineColor: "#A5C8B1", opacity: 1, speed: 0.038, contourDensity: 18, lineStrength: 0.22 },
};

const COCKPIT_COLORS: Record<TerrainRiskLevel, Pick<HexPalette, "colors" | "lineColor">> = {
  low: { colors: ["#F0F4E9", "#DCE8DF", "#AFCBB8", "#4F806A"], lineColor: "#56856F" },
  medium: { colors: ["#F0F2DE", "#D9DFBD", "#A4B986", "#496E57"], lineColor: "#70835E" },
  high: { colors: ["#E7EEE5", "#C6D8CB", "#8CAE98", "#3E6250"], lineColor: "#4F765F" },
  unknown: { colors: ["#F0F4E9", "#DCE8DF", "#AFCBB8", "#4F806A"], lineColor: "#56856F" },
};

export const TERRAIN_RISK_MULTIPLIERS: Record<TerrainRiskLevel, { speed: number; density: number }> = {
  low: { speed: 1, density: 1 },
  medium: { speed: 1.08, density: 1.06 },
  high: { speed: 1.16, density: 1.12 },
  unknown: { speed: 1, density: 1 },
};

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function resolveHexPalette(view: TerrainView, preset: ShowcaseTerrainPreset, risk: TerrainRiskLevel): HexPalette {
  if (view === "showcase") return SHOWCASE_TERRAIN_PRESETS[preset];
  const colors = COCKPIT_COLORS[risk];
  const multiplier = TERRAIN_RISK_MULTIPLIERS[risk];
  return {
    ...colors,
    opacity: 1,
    speed: COCKPIT_BASE_SPEED * multiplier.speed,
    contourDensity: COCKPIT_BASE_DENSITY * multiplier.density,
    lineStrength: 0.22,
  };
}

export function resolveTerrainTarget(view: TerrainView, preset: ShowcaseTerrainPreset, risk: TerrainRiskLevel): TerrainTarget {
  const source = resolveHexPalette(view, preset, risk);
  return {
    colors: source.colors.map(hexToRgb) as unknown as TerrainTarget["colors"],
    lineColor: hexToRgb(source.lineColor),
    opacity: source.opacity,
    speed: source.speed,
    contourDensity: source.contourDensity,
    lineStrength: source.lineStrength,
  };
}

const mix = (from: number, to: number, progress: number) => {
  if (progress === 0) return from;
  if (progress === 1) return to;
  return from + (to - from) * progress;
};
const mixRgb = (from: Rgb, to: Rgb, progress: number): Rgb => [
  mix(from[0], to[0], progress),
  mix(from[1], to[1], progress),
  mix(from[2], to[2], progress),
];

export function interpolateTerrainTarget(from: TerrainTarget, to: TerrainTarget, progress: number): TerrainTarget {
  const amount = Math.min(1, Math.max(0, progress));
  return {
    colors: from.colors.map((color, index) => mixRgb(color, to.colors[index], amount)) as unknown as TerrainTarget["colors"],
    lineColor: mixRgb(from.lineColor, to.lineColor, amount),
    opacity: mix(from.opacity, to.opacity, amount),
    speed: mix(from.speed, to.speed, amount),
    contourDensity: mix(from.contourDensity, to.contourDensity, amount),
    lineStrength: mix(from.lineStrength, to.lineStrength, amount),
  };
}
