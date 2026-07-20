import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { CockpitNav } from "./CockpitNav";
import { ReportScreen } from "../features/diagnosis/ReportScreen";
import type { ReportV2 } from "../features/diagnosis/contracts";
import { GlobalDiagnosisScreen } from "./GlobalDiagnosisScreen";
import { LiveAnalysisScreen, type CockpitMonitoring } from "./LiveAnalysisScreen";
import { PersistentScenePlayer, type CameraPerceptionObject } from "./PersistentScenePlayer";
import { SceneEntryScreen } from "./SceneEntryScreen";
import type { CockpitScreen, SceneManifestEntry } from "./types";
import { cockpitScrollBehavior, useCockpitScroll } from "./useCockpitScroll";
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
  report: ReportV2 | null;
  selectedEvidenceTime: number | null;
  motionReady?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onSceneSelect: (sceneKey: string) => void;
  onSeekReportEvidence: (time: number) => void;
  onReturnToDiagnosis: (time: number | null) => void;
  onRerunDiagnosis: () => void;
  onReturnSite: () => void;
  onContact: () => void;
  onScreenChange?: (screen: CockpitScreen) => void;
};

type PersistentEvidenceLayerProps = {
  displayScreen: CockpitScreen;
  parkingRef: RefObject<HTMLDivElement | null>;
  liveTargetRef: RefObject<HTMLDivElement | null>;
  diagnosisTargetRef: RefObject<HTMLDivElement | null>;
  lidarSlot: ReactNode;
  mapSlot: ReactNode;
};

function PersistentEvidenceLayer({
  displayScreen,
  parkingRef,
  liveTargetRef,
  diagnosisTargetRef,
  lidarSlot,
  mapSlot,
}: PersistentEvidenceLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const target = displayScreen === "live"
      ? liveTargetRef.current
      : displayScreen === "diagnosis"
        ? diagnosisTargetRef.current
        : parkingRef.current;
    if (!layer || !target || layer.parentElement === target) return;
    target.appendChild(layer);
  }, [diagnosisTargetRef, displayScreen, liveTargetRef, parkingRef]);

  useEffect(() => () => {
    const layer = layerRef.current;
    const parking = parkingRef.current;
    if (layer && parking && layer.parentElement !== parking) parking.appendChild(layer);
  }, [parkingRef]);

  return (
    <div ref={layerRef} className="cockpit-persistent-evidence-layer" data-testid="persistent-cockpit-evidence">
      <div className="cockpit-evidence-panel cockpit-glass-panel cockpit-mini-panel" data-testid="persistent-lidar-panel">
        {lidarSlot}
      </div>
      <div className="cockpit-evidence-panel cockpit-glass-panel cockpit-mini-panel" data-testid="persistent-map-panel">
        {mapSlot}
      </div>
    </div>
  );
}

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
  report,
  selectedEvidenceTime,
  motionReady = true,
  videoRef,
  onSceneSelect,
  onSeekReportEvidence,
  onReturnToDiagnosis,
  onRerunDiagnosis,
  onReturnSite,
  onContact,
  onScreenChange,
}: CockpitExperienceProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLDivElement | null>(null);
  const entryVideoSlotRef = useRef<HTMLDivElement | null>(null);
  const liveVideoSlotRef = useRef<HTMLDivElement | null>(null);
  const diagnosisVideoSlotRef = useRef<HTMLDivElement | null>(null);
  const reportVideoSlotRef = useRef<HTMLDivElement | null>(null);
  const reportScreenRef = useRef<HTMLElement | null>(null);
  const lastAutoScrolledReport = useRef<ReportV2 | null>(null);
  const evidenceParkingRef = useRef<HTMLDivElement | null>(null);
  const liveEvidenceSlotRef = useRef<HTMLDivElement | null>(null);
  const diagnosisEvidenceSlotRef = useRef<HTMLDivElement | null>(null);
  const [activeScreen, setActiveScreen] = useState<CockpitScreen>("entry");
  const [pendingScreen, setPendingScreen] = useState<CockpitScreen | null>(null);
  const [seekTime, setSeekTime] = useState<number | null>(selectedEvidenceTime);
  const [seekVersion, setSeekVersion] = useState(0);
  const rerunPendingRef = useRef(false);
  const handleScreenChange = useCallback((screen: CockpitScreen) => {
    setActiveScreen(screen);
    onScreenChange?.(screen);
  }, [onScreenChange]);
  const handleScreenIntent = useCallback((screen: CockpitScreen) => {
    setPendingScreen(screen);
  }, []);
  const handleScreenSettled = useCallback((screen: CockpitScreen) => {
    setPendingScreen((current) => current === screen ? null : current);
  }, []);
  const displayScreen = pendingScreen === "live" || pendingScreen === "diagnosis"
    ? pendingScreen
    : activeScreen;

  const screenOrder = useMemo<readonly CockpitScreen[]>(() => report
    ? ["entry", "live", "diagnosis", "report"]
    : ["entry", "live", "diagnosis"], [report]);

  useCockpitScroll({
    rootRef,
    onScreenChange: handleScreenChange,
    screenOrder,
    activeScreen,
    pendingScreen,
    onScreenIntent: handleScreenIntent,
    onScreenSettled: handleScreenSettled,
  });

  const handleSeekReportEvidence = useCallback((time: number) => {
    setSeekTime(time);
    setSeekVersion((version) => version + 1);
    onSeekReportEvidence(time);
  }, [onSeekReportEvidence]);

  const navigateToDiagnosis = useCallback(() => {
    handleScreenIntent("diagnosis");
    handleScreenChange("diagnosis");
    requestAnimationFrame(() => {
      evidenceRef.current?.scrollIntoView({ behavior: cockpitScrollBehavior(), block: "start" });
    });
  }, [handleScreenChange, handleScreenIntent]);

  const handleReturnToDiagnosis = useCallback((time: number | null) => {
    if (time !== null) handleSeekReportEvidence(time);
    navigateToDiagnosis();
    onReturnToDiagnosis(time);
  }, [handleSeekReportEvidence, navigateToDiagnosis, onReturnToDiagnosis]);

  const handleRerunDiagnosis = useCallback(() => {
    rerunPendingRef.current = true;
    navigateToDiagnosis();
  }, [navigateToDiagnosis]);

  useEffect(() => {
    if (!rerunPendingRef.current || activeScreen !== "diagnosis") return;
    rerunPendingRef.current = false;
    onRerunDiagnosis();
  }, [activeScreen, onRerunDiagnosis]);

  useEffect(() => {
    const defaultEvidenceTime = report?.evidence.index[0]?.start_time ?? null;
    setSeekTime(selectedEvidenceTime ?? defaultEvidenceTime);
  }, [report, selectedEvidenceTime]);

  useEffect(() => {
    if (!report) {
      lastAutoScrolledReport.current = null;
      if (activeScreen === "report" || pendingScreen === "report") navigateToDiagnosis();
      return;
    }
    if (lastAutoScrolledReport.current === report) return;
    lastAutoScrolledReport.current = report;
    handleScreenIntent("report");
    handleScreenChange("report");
    requestAnimationFrame(() => {
      reportScreenRef.current?.scrollIntoView({
        behavior: cockpitScrollBehavior(),
        block: "start",
      });
    });
  }, [report, activeScreen, pendingScreen, handleScreenChange, handleScreenIntent, navigateToDiagnosis]);

  const slots: Record<CockpitScreen, RefObject<HTMLElement | null>> = {
    entry: entryVideoSlotRef,
    live: liveVideoSlotRef,
    diagnosis: diagnosisVideoSlotRef,
    report: reportVideoSlotRef,
  };

  return (
    <main ref={rootRef} className="cockpit-experience" data-active-screen={activeScreen} data-motion-ready={motionReady}>
      <CockpitNav onReturnSite={onReturnSite} onContact={onContact} />
      <SceneEntryScreen
        scenes={scenes}
        selectedSceneKey={selectedSceneKey}
        sceneLoading={sceneLoading}
        active={activeScreen === "entry"}
        motionReady={motionReady}
        videoSlotRef={entryVideoSlotRef}
        onSceneSelect={onSceneSelect}
      />
      <LiveAnalysisScreen
        scenes={scenes}
        selectedSceneKey={selectedSceneKey}
        sceneLoading={sceneLoading}
        active={activeScreen === "live"}
        motionReady={motionReady}
        videoSlotRef={liveVideoSlotRef}
        monitoring={monitoring}
        evidenceSlotRef={liveEvidenceSlotRef}
        historySlot={historySlot}
        onSceneSelect={onSceneSelect}
      />
      <GlobalDiagnosisScreen
        active={activeScreen === "diagnosis"}
        motionReady={motionReady}
        videoSlotRef={diagnosisVideoSlotRef}
        evidenceSlotRef={diagnosisEvidenceSlotRef}
        evidenceRef={evidenceRef}
        diagnosisSlot={diagnosisSlot}
      />
      {report ? (
        <ReportScreen
          report={report}
          selectedEvidenceTime={selectedEvidenceTime}
          videoSlotRef={reportVideoSlotRef}
          screenRef={reportScreenRef}
          onSeekReportEvidence={handleSeekReportEvidence}
          onReturnToDiagnosis={handleReturnToDiagnosis}
          onRerunDiagnosis={handleRerunDiagnosis}
        />
      ) : null}
      <div ref={evidenceParkingRef} className="cockpit-evidence-parking">
        <PersistentEvidenceLayer
          displayScreen={displayScreen}
          parkingRef={evidenceParkingRef}
          liveTargetRef={liveEvidenceSlotRef}
          diagnosisTargetRef={diagnosisEvidenceSlotRef}
          lidarSlot={lidarSlot}
          mapSlot={mapSlot}
        />
      </div>
      <PersistentScenePlayer
        sceneKey={selectedSceneKey}
        src={sceneVideoSrc}
        activeScreen={activeScreen}
        slots={slots}
        scrollRootRef={rootRef}
        showDetections={activeScreen !== "entry"}
        objects={objects}
        videoRef={videoRef}
        seekTime={seekTime}
        seekVersion={seekVersion}
      />
    </main>
  );
}
