import type { ReactNode, RefObject } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { sceneDisplayName } from "./scene-labels";
import type { SceneManifestEntry } from "./types";

export type MonitoringDetail = { label: string; value: string };

export type CockpitMonitoring = {
  currentObjects: number;
  highRiskObjects: number;
  mediumRiskObjects: number;
  frameRiskLabel: string;
  details: readonly MonitoringDetail[];
  errorMessage?: string | null;
};

type LiveAnalysisScreenProps = {
  scenes: readonly SceneManifestEntry[];
  selectedSceneKey: string;
  sceneLoading: boolean;
  active: boolean;
  videoSlotRef: RefObject<HTMLDivElement | null>;
  monitoring: CockpitMonitoring;
  lidarSlot: ReactNode;
  mapSlot: ReactNode;
  historySlot: ReactNode;
  onSceneSelect: (sceneKey: string) => void;
};

export function LiveAnalysisScreen({
  scenes,
  selectedSceneKey,
  sceneLoading,
  active,
  videoSlotRef,
  monitoring,
  lidarSlot,
  mapSlot,
  historySlot,
  onSceneSelect,
}: LiveAnalysisScreenProps) {
  return (
    <section className="cockpit-screen cockpit-live" data-cockpit-screen="live" aria-label="实时解析">
      <div className="cockpit-screen__heading cockpit-screen__heading--compact">
        <div><p className="cockpit-screen__index">02 / 实时解析</p><h2>多模态证据，<em>逐帧同步</em></h2></div>
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
      <div className="cockpit-live__body">
        <div className="cockpit-video-frame cockpit-glass-panel">
          <div className="cockpit-panel-label"><span>带框前视回放</span><strong>时间轴连续</strong></div>
          <div ref={videoSlotRef} className="cockpit-video-slot cockpit-video-slot--analysis" />
        </div>
        <div className="cockpit-live__evidence">
          <div className="cockpit-evidence-stack">
            <div className="cockpit-evidence-panel cockpit-glass-panel cockpit-mini-panel">
              {active ? lidarSlot : null}
            </div>
            <div className="cockpit-evidence-panel cockpit-glass-panel cockpit-mini-panel">
              {active ? mapSlot : null}
            </div>
          </div>
          <aside className="cockpit-monitor cockpit-glass-panel" aria-label="实时监测">
            <div className="cockpit-monitor__title"><Activity size={17} aria-hidden="true" /><span>实时监测</span><strong>{monitoring.frameRiskLabel}</strong></div>
            <div className="cockpit-monitor__overview">
              <span>当前目标<strong>{monitoring.currentObjects}</strong></span>
              <span>高危目标<strong>{monitoring.highRiskObjects}</strong></span>
              <span>中危目标<strong>{monitoring.mediumRiskObjects}</strong></span>
            </div>
            <div className="cockpit-monitor__details">
              {monitoring.details.map((item) => <span key={item.label}>{item.label}<strong>{item.value}</strong></span>)}
            </div>
            {monitoring.errorMessage ? <div className="cockpit-monitor__error" role="status">{monitoring.errorMessage}</div> : null}
            <div className="cockpit-monitor__history" data-lenis-prevent-wheel>{active ? historySlot : null}</div>
          </aside>
        </div>
      </div>
    </section>
  );
}
