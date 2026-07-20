import type { ReactNode, RefObject } from "react";
import LineReveal from "../LineReveal";
import TextReveal from "../TextReveal";

type GlobalDiagnosisScreenProps = {
  active: boolean;
  motionReady: boolean;
  videoSlotRef: RefObject<HTMLDivElement | null>;
  evidenceSlotRef: RefObject<HTMLDivElement | null>;
  evidenceRef: RefObject<HTMLDivElement | null>;
  diagnosisSlot: ReactNode;
};

export function GlobalDiagnosisScreen({
  active,
  motionReady,
  videoSlotRef,
  evidenceSlotRef,
  evidenceRef,
  diagnosisSlot,
}: GlobalDiagnosisScreenProps) {
  return (
    <section className="cockpit-screen cockpit-diagnosis" data-cockpit-screen="diagnosis" aria-label="全域诊断">
      <div className="cockpit-screen__heading cockpit-screen__heading--compact" ref={evidenceRef}>
        <div><TextReveal tag="p" className="cockpit-screen__index" enabled={motionReady}>03 / 全域诊断</TextReveal><LineReveal tag="h2" label="从关键帧，追溯完整因果链" enabled={motionReady} lines={[<>从关键帧，<em>追溯完整因果链</em></>]} /></div>
      </div>
      <div className="cockpit-diagnosis__body">
        <div className="cockpit-video-frame cockpit-glass-panel">
          <div className="cockpit-panel-label"><span>风险证据回放</span><strong>检测框开启</strong></div>
          <div ref={videoSlotRef} className="cockpit-video-slot cockpit-video-slot--diagnosis" />
        </div>
        <div className="cockpit-diagnosis__evidence">
          <div ref={evidenceSlotRef} className="cockpit-persistent-evidence-slot" />
          <div className="cockpit-diagnosis__action cockpit-glass-panel" aria-label="诊断任务">{active ? diagnosisSlot : null}</div>
        </div>
      </div>
    </section>
  );
}
