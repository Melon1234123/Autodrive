import type { SceneManifestEntry } from "./types";

export const SCENE_DISPLAY_NAMES = {
  default: "城市路口侧向超车",
  "scene-0061": "工区左转跟车",
  "scene-0103": "人车混流待转",
  "scene-0553": "斑马线母婴穿越",
  "scene-0655": "停车场行人横穿",
  "scene-0757": "繁忙路口公交博弈",
  "scene-0916": "停车区人车密集",
  "scene-1077": "夜间主干道施工",
  "scene-1094": "雨夜行人横穿",
  "scene-1100": "低照路口混行",
} as const satisfies Readonly<Record<string, string>>;

export function sceneDisplayName(scene: Pick<SceneManifestEntry, "id" | "label">): string {
  return SCENE_DISPLAY_NAMES[scene.id as keyof typeof SCENE_DISPLAY_NAMES] ?? "未命名场景";
}
