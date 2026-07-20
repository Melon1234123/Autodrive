import type { CockpitScreen } from "./types";

export type CockpitScrollCommand = "previous" | "next";

export function resolveCockpitDestination(
  order: readonly CockpitScreen[],
  command: CockpitScrollCommand,
  current: CockpitScreen,
): CockpitScreen | null {
  const index = order.indexOf(current);
  if (index < 0) return null;
  return order[index + (command === "next" ? 1 : -1)] ?? null;
}
