import type { CockpitScreen } from "./types";

export type CockpitScrollCommand = "previous" | "next";

const SCREEN_ORDER: readonly CockpitScreen[] = ["entry", "live", "diagnosis"];

export function resolveCockpitDestination(
  command: CockpitScrollCommand,
  current: CockpitScreen,
  reportExpanded: boolean,
  reportAtTop: boolean,
): CockpitScreen | null {
  if (current === "diagnosis" && reportExpanded && !reportAtTop) return null;
  const destinationIndex = SCREEN_ORDER.indexOf(current) + (command === "next" ? 1 : -1);
  return SCREEN_ORDER[destinationIndex] ?? null;
}
