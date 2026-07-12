import type { RefObject } from "react";
import { ChevronDown, Play } from "lucide-react";
import { sceneDisplayName } from "./scene-labels";
import type { SceneManifestEntry } from "./types";

type SceneEntryScreenProps = {
  scenes: readonly SceneManifestEntry[];
  selectedSceneKey: string;
  sceneLoading: boolean;
  active: boolean;
  videoSlotRef: RefObject<HTMLDivElement | null>;
  onSceneSelect: (sceneKey: string) => void;
};

export function SceneEntryScreen({
  scenes,
  selectedSceneKey,
  sceneLoading,
  active,
  videoSlotRef,
  onSceneSelect,
}: SceneEntryScreenProps) {
  return (
    <section className="cockpit-screen cockpit-entry" data-cockpit-screen="entry" aria-label="场景入口">
      <div className="cockpit-screen__heading cockpit-entry__heading">
        <div>
          <p className="cockpit-screen__index">01 / 场景入口</p>
          <h1>选择一段真实路况，<br /><em>开始证据回放</em></h1>
        </div>
        <p>同一条时间轴将连续驱动视频、感知目标、激光雷达点云、地图轨迹与风险事件。</p>
      </div>
      <div className="cockpit-entry__layout">
        <div className="cockpit-video-frame cockpit-video-frame--entry">
          <div ref={videoSlotRef} className="cockpit-video-slot cockpit-video-slot--entry" />
          <div className="cockpit-video-caption" aria-hidden="true">
            <span><i />真实前视视频</span>
            <strong>{sceneDisplayName(scenes.find((scene) => scene.id === selectedSceneKey) ?? scenes[0])}</strong>
          </div>
        </div>
        <div className="scene-rail cockpit-glass-panel" aria-label="可选场景">
          <div className="scene-rail__heading">
            <span>场景库</span>
            <strong>{String(scenes.length).padStart(2, "0")}</strong>
          </div>
          {active ? (
            <label className="cockpit-scene-select">
              <span>当前场景</span>
              <select
                value={selectedSceneKey}
                onChange={(event) => onSceneSelect(event.target.value)}
                disabled={sceneLoading}
                aria-label="选择数据场景"
              >
                {scenes.map((scene) => <option value={scene.id} key={scene.id}>{sceneDisplayName(scene)}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
          ) : null}
          <div className="scene-rail__list" data-lenis-prevent-wheel>
            {scenes.map((scene, index) => (
              <button
                type="button"
                key={scene.id}
                className={scene.id === selectedSceneKey ? "is-active" : ""}
                onClick={() => onSceneSelect(scene.id)}
                disabled={sceneLoading && scene.id !== selectedSceneKey}
                aria-pressed={scene.id === selectedSceneKey}
                aria-label={sceneDisplayName(scene)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{sceneDisplayName(scene)}</strong>
                <Play size={13} fill="currentColor" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
