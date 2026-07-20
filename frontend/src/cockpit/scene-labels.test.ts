import { expect, it } from "vitest";
import scenes from "../../public/scenes.json";
import { SCENE_DISPLAY_NAMES, sceneDisplayName } from "./scene-labels";

it("defines exactly ten approved Chinese scene names", () => {
  expect(SCENE_DISPLAY_NAMES).toEqual({
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
  });
  expect(scenes.scenes).toHaveLength(10);
  expect(scenes.scenes.map((scene) => scene.label)).toEqual(Object.values(SCENE_DISPLAY_NAMES));
});

it("never falls back to a raw internal id", () => {
  expect(sceneDisplayName({ id: "scene-private", label: "" })).toBe("未命名场景");
  expect(sceneDisplayName({ id: "scene-private", label: "scene-private" })).toBe("未命名场景");
  expect(sceneDisplayName({ id: "private", label: " private " })).toBe("未命名场景");
  expect(sceneDisplayName({ id: "private", label: "Unapproved English label" })).toBe("未命名场景");
  expect(sceneDisplayName({ id: "private", label: "未批准的中文名称" })).toBe("未命名场景");
});
