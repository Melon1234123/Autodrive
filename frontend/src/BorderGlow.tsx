import { createElement, type CSSProperties, type PointerEvent, type ReactNode, useMemo, useRef } from "react";
import "./BorderGlow.css";

type BorderGlowProps = {
  as?: "div" | "article";
  children: ReactNode;
  className?: string;
  edgeSensitivity?: number;
  glowColor?: string;
  backgroundColor?: string;
  borderRadius?: number;
  glowRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  colors?: string[];
  fillOpacity?: number;
};

type GlowStyle = CSSProperties & Record<`--${string}`, string | number>;

const gradientPositions = ["80% 55%", "69% 34%", "8% 6%", "41% 38%", "86% 85%", "82% 18%", "51% 4%"];
const gradientKeys = ["--gradient-one", "--gradient-two", "--gradient-three", "--gradient-four", "--gradient-five", "--gradient-six", "--gradient-seven"];
const colorMap = [0, 1, 2, 0, 1, 2, 1];

function buildGlowVars(glowColor: string, intensity: number): GlowStyle {
  const match = glowColor.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  const [hue, saturation, lightness] = match ? match.slice(1).map(Number) : [166, 70, 62];
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const suffixes = ["", "-60", "-50", "-40", "-30", "-20", "-10"];
  return opacities.reduce<GlowStyle>((variables, opacity, index) => {
    variables[`--glow-color${suffixes[index]}`] = `hsl(${hue}deg ${saturation}% ${lightness}% / ${Math.min(opacity * intensity, 100)}%)`;
    return variables;
  }, {});
}

function buildGradientVars(colors: string[]): GlowStyle {
  const palette = colors.length ? colors : ["#d9f35b", "#6fe2c1", "#9ddcff"];
  return gradientKeys.reduce<GlowStyle>((variables, key, index) => {
    const color = palette[Math.min(colorMap[index], palette.length - 1)];
    variables[key as `--${string}`] = `radial-gradient(at ${gradientPositions[index]}, ${color} 0, transparent 52%)`;
    if (index === gradientKeys.length - 1) variables["--gradient-base"] = `linear-gradient(${palette[0]} 0 100%)`;
    return variables;
  }, {});
}

export default function BorderGlow({
  as = "div",
  children,
  className = "",
  edgeSensitivity = 32,
  glowColor = "166 70 62",
  backgroundColor = "#dcecdf",
  borderRadius = 8,
  glowRadius = 18,
  glowIntensity = 0.72,
  coneSpread = 22,
  colors = ["#d9f35b", "#6fe2c1", "#9ddcff"],
  fillOpacity = 0.12,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLElement | null>(null);

  const style = useMemo<GlowStyle>(() => ({
    "--card-bg": backgroundColor,
    "--edge-sensitivity": edgeSensitivity,
    "--border-radius": `${borderRadius}px`,
    "--glow-padding": `${glowRadius}px`,
    "--cone-spread": coneSpread,
    "--fill-opacity": fillOpacity,
    "--card-tilt-x": "0deg",
    "--card-tilt-y": "0deg",
    ...buildGlowVars(glowColor, glowIntensity),
    ...buildGradientVars(colors),
  }), [backgroundColor, borderRadius, colors, coneSpread, edgeSensitivity, fillOpacity, glowColor, glowIntensity, glowRadius]);

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const dx = x - centerX;
    const dy = y - centerY;
    const kx = dx === 0 ? Infinity : centerX / Math.abs(dx);
    const ky = dy === 0 ? Infinity : centerY / Math.abs(dy);
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const normalizedX = centerX === 0 ? 0 : dx / centerX;
    const normalizedY = centerY === 0 ? 0 : dy / centerY;
    const tiltX = Math.max(-5, Math.min(5, -normalizedY * 5));
    const tiltY = Math.max(-5, Math.min(5, normalizedX * 5));
    card.style.setProperty("--edge-proximity", `${(edge * 100).toFixed(3)}`);
    card.style.setProperty("--cursor-angle", `${(angle < 0 ? angle + 360 : angle).toFixed(3)}deg`);
    card.style.setProperty("--card-tilt-x", `${tiltX.toFixed(3)}deg`);
    card.style.setProperty("--card-tilt-y", `${tiltY.toFixed(3)}deg`);
  }

  function handlePointerLeave() {
    const card = cardRef.current;
    card?.style.setProperty("--edge-proximity", "0");
    card?.style.setProperty("--card-tilt-x", "0deg");
    card?.style.setProperty("--card-tilt-y", "0deg");
  }

  return createElement(
    as,
    { ref: cardRef, onPointerMove: handlePointerMove, onPointerLeave: handlePointerLeave, onMouseLeave: handlePointerLeave, className: `border-glow-card ${className}`.trim(), style },
    createElement("span", { className: "edge-light", "aria-hidden": true }),
    createElement("div", { className: "border-glow-inner" }, children),
  );
}
