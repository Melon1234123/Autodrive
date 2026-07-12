import type { ReactNode, RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { sceneDisplayName } from "./scene-labels";
import type { SceneManifestEntry } from "./types";

type GlobalDiagnosisScreenProps = {
  scenes: readonly SceneManifestEntry[];
  selectedSceneKey: string;
  sceneLoading: boolean;
  active: boolean;
  videoSlotRef: RefObject<HTMLDivElement | null>;
  reportRef: RefObject<HTMLDivElement | null>;
  lidarSlot: ReactNode;
  mapSlot: ReactNode;
  diagnosisSlot: ReactNode;
  onSceneSelect: (sceneKey: string) => void;
};

export function GlobalDiagnosisScreen({
  scenes,
  selectedSceneKey,
  sceneLoading,
  active,
  videoSlotRef,
  reportRef,
  lidarSlot,
  mapSlot,
  diagnosisSlot,
  onSceneSelect,
}: GlobalDiagnosisScreenProps) {
  return (
    <section className="cockpit-screen cockpit-diagnosis" data-cockpit-screen="diagnosis" aria-label="全域诊断">
      <div className="cockpit-screen__heading cockpit-screen__heading--compact" ref={reportRef}>
        <div><p className="cockpit-screen__index">03 / 全域诊断</p><h2>从关键帧，<em>追溯完整因果链</em></h2></div>
        {active ? (
          <label className="cockpit-scene-select cockpit-scene-select--heading">
            <span>场景切换</span>
            <select value={selectedSceneKey} onChange={(event) => onSceneSelect(event.target.value)} disabled={sceneLoading} aria-label="选择数据场景">
              {scenes.map((scene) => <option value={scene.id} key={scene.id}>{sceneDisplayName(scene)}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        ) : <span className="cockpit-screen__scene">{sceneDisplayName(scenes.find((scene) => scene.id === selectedSceneKey) ?? scenes[0])}</span>}
      </div>
      <div className="cockpit-diagnosis__body">
        <div className="cockpit-video-frame cockpit-glass-panel">
          <div className="cockpit-panel-label"><span>风险证据回放</span><strong>检测框开启</strong></div>
          <div ref={videoSlotRef} className="cockpit-video-slot cockpit-video-slot--diagnosis" />
        </div>
        <div className="cockpit-diagnosis__evidence">
          <div className="cockpit-evidence-panel cockpit-glass-panel cockpit-mini-panel">
            {active ? lidarSlot : null}
          </div>
          <div className="cockpit-evidence-panel cockpit-glass-panel cockpit-mini-panel map-panel">
            {active ? mapSlot : null}
          </div>
          <div className="cockpit-diagnosis__action cockpit-glass-panel">{active ? diagnosisSlot : null}</div>
        </div>
      </div>
    </section>
  );
}
