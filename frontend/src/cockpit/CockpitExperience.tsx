import { useCallback, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { CockpitNav } from "./CockpitNav";
import { GlobalDiagnosisScreen } from "./GlobalDiagnosisScreen";
import { LiveAnalysisScreen, type CockpitMonitoring } from "./LiveAnalysisScreen";
import { PersistentScenePlayer, type CameraPerceptionObject } from "./PersistentScenePlayer";
import { SceneEntryScreen } from "./SceneEntryScreen";
import type { CockpitScreen, SceneManifestEntry } from "./types";
import { useCockpitScroll } from "./useCockpitScroll";
import "./cockpit.css";

export type CockpitExperienceProps = {
  scenes: readonly SceneManifestEntry[];
  selectedSceneKey: string;
  sceneVideoSrc: string;
  sceneLoading: boolean;
  objects: readonly CameraPerceptionObject[];
  monitoring: CockpitMonitoring;
  lidarSlot: ReactNode;
  mapSlot: ReactNode;
  historySlot: ReactNode;
  diagnosisSlot: ReactNode;
  reportExpanded: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onSceneSelect: (sceneKey: string) => void;
  onReturnSite: () => void;
  onContact: () => void;
  onScreenChange?: (screen: CockpitScreen) => void;
};

export function CockpitExperience({
  scenes,
  selectedSceneKey,
  sceneVideoSrc,
  sceneLoading,
  objects,
  monitoring,
  lidarSlot,
  mapSlot,
  historySlot,
  diagnosisSlot,
  reportExpanded,
  videoRef,
  onSceneSelect,
  onReturnSite,
  onContact,
  onScreenChange,
}: CockpitExperienceProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const entryVideoSlotRef = useRef<HTMLDivElement | null>(null);
  const liveVideoSlotRef = useRef<HTMLDivElement | null>(null);
  const diagnosisVideoSlotRef = useRef<HTMLDivElement | null>(null);
  const [activeScreen, setActiveScreen] = useState<CockpitScreen>("entry");
  const handleScreenChange = useCallback((screen: CockpitScreen) => {
    setActiveScreen(screen);
    onScreenChange?.(screen);
  }, [onScreenChange]);

  useCockpitScroll({ rootRef, reportRef, reportExpanded, onScreenChange: handleScreenChange });

  const slots: Record<CockpitScreen, RefObject<HTMLElement | null>> = {
    entry: entryVideoSlotRef,
    live: liveVideoSlotRef,
    diagnosis: diagnosisVideoSlotRef,
  };

  return (
    <main ref={rootRef} className="cockpit-experience" data-active-screen={activeScreen}>
      <CockpitNav onReturnSite={onReturnSite} onContact={onContact} />
      <SceneEntryScreen
        scenes={scenes}
        selectedSceneKey={selectedSceneKey}
        sceneLoading={sceneLoading}
        active={activeScreen === "entry"}
        videoSlotRef={entryVideoSlotRef}
        onSceneSelect={onSceneSelect}
      />
      <LiveAnalysisScreen
        scenes={scenes}
        selectedSceneKey={selectedSceneKey}
        sceneLoading={sceneLoading}
        active={activeScreen === "live"}
        videoSlotRef={liveVideoSlotRef}
        monitoring={monitoring}
        lidarSlot={lidarSlot}
        mapSlot={mapSlot}
        historySlot={historySlot}
        onSceneSelect={onSceneSelect}
      />
      <GlobalDiagnosisScreen
        scenes={scenes}
        selectedSceneKey={selectedSceneKey}
        sceneLoading={sceneLoading}
        active={activeScreen === "diagnosis"}
        videoSlotRef={diagnosisVideoSlotRef}
        reportRef={reportRef}
        lidarSlot={lidarSlot}
        mapSlot={mapSlot}
        diagnosisSlot={diagnosisSlot}
        onSceneSelect={onSceneSelect}
      />
      <PersistentScenePlayer
        sceneKey={selectedSceneKey}
        src={sceneVideoSrc}
        activeScreen={activeScreen}
        slots={slots}
        scrollRootRef={rootRef}
        showDetections={activeScreen !== "entry"}
        objects={objects}
        videoRef={videoRef}
      />
    </main>
  );
}
