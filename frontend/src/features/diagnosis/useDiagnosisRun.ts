import { useCallback, useEffect, useReducer, useRef } from "react";
import { cancelDiagnosisJob, createDiagnosisJob, pollDiagnosisJob } from "./api";
import type { DiagnosisJobSnapshot, ReportV2 } from "./contracts";

export type DiagnosisRunOptions = { apiUrl: string; sceneKey: string; sceneName?: string; dataVersion: string };
export type DiagnosisRunState = {
  status: "idle" | "running" | "complete" | "failed" | "cancelled";
  snapshot: DiagnosisJobSnapshot | null;
  report: ReportV2 | null;
  error: string | null;
  selectedEvidenceId: string | null;
  start: () => void;
  rerun: () => void;
  cancel: () => void;
  selectEvidence: (id: string) => void;
};

type State = Omit<DiagnosisRunState, "start" | "rerun" | "cancel" | "selectEvidence">;
type Action =
  | { type: "running" }
  | { type: "progress"; snapshot: DiagnosisJobSnapshot }
  | { type: "complete"; snapshot: DiagnosisJobSnapshot; report: ReportV2 }
  | { type: "failed"; snapshot: DiagnosisJobSnapshot | null; error: string }
  | { type: "cancelled"; snapshot?: DiagnosisJobSnapshot | null }
  | { type: "selectEvidence"; id: string };

const initialState: State = { status: "idle", snapshot: null, report: null, error: null, selectedEvidenceId: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "running": return { ...initialState, status: "running" };
    case "progress": return { ...state, status: "running", snapshot: action.snapshot, error: null };
    case "complete": return { ...state, status: "complete", snapshot: action.snapshot, report: action.report, error: null };
    case "failed": return { ...state, status: "failed", snapshot: action.snapshot, report: null, error: action.error };
    case "cancelled": return {
      ...state,
      status: "cancelled",
      snapshot: action.snapshot ?? state.snapshot,
      report: null,
      error: null,
      selectedEvidenceId: null,
    };
    case "selectEvidence": return { ...state, selectedEvidenceId: action.id };
  }
}

type Owner = { runId: number; sceneKey: string; dataVersion: string; jobId?: string; latestSnapshot?: DiagnosisJobSnapshot };
function isAbort(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
function ownershipError() { return new Error("诊断任务读取失败：任务归属不匹配"); }
function reportOwnershipError() { return new Error("诊断任务读取失败：报告归属不匹配"); }
function matchesCreatedOwner(owner: Owner, snapshot: DiagnosisJobSnapshot) {
  return snapshot.sceneKey === owner.sceneKey && snapshot.dataVersion === owner.dataVersion;
}
function matchesJobOwner(owner: Owner, snapshot: DiagnosisJobSnapshot) {
  return matchesCreatedOwner(owner, snapshot) && snapshot.jobId === owner.jobId;
}
function reportBelongsToOwner(owner: Owner, snapshot: DiagnosisJobSnapshot, report: ReportV2, sceneName?: string) {
  // The report deliberately carries a display-safe scene name, while the job
  // snapshot carries the opaque scene key used to correlate ownership.
  return matchesJobOwner(owner, snapshot)
    && report.meta.data_version === owner.dataVersion
    && (sceneName === undefined || report.meta.scene_name === sceneName);
}
function failureMessage(failure: unknown): string {
  if (failure instanceof Error) return failure.message;
  return "诊断任务失败";
}

export function useDiagnosisRun(options: DiagnosisRunOptions): DiagnosisRunState {
  const [state, dispatch] = useReducer(reducer, initialState);
  const ownerRef = useRef<Owner | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const cancelGenerationRef = useRef(0);
  const sceneRef = useRef(options.sceneKey);
  const sceneNameRef = useRef(options.sceneName);
  const versionRef = useRef(options.dataVersion);
  const mountedRef = useRef(true);

  const owns = useCallback((owner: Owner) => ownerRef.current === owner && sceneRef.current === owner.sceneKey && versionRef.current === owner.dataVersion, []);
  const publish = useCallback((action: Action) => { if (mountedRef.current) dispatch(action); }, []);

  const cancel = useCallback(() => {
    const active = ownerRef.current;
    const cancelGeneration = ++cancelGenerationRef.current;
    controllerRef.current?.abort();
    controllerRef.current = null;
    ownerRef.current = null;
    if (active?.jobId) {
      void cancelDiagnosisJob(options.apiUrl, active.jobId)
        .then((snapshot) => {
          const isCurrentCancellation = cancelGenerationRef.current === cancelGeneration
            && runRef.current === active.runId
            && ownerRef.current === null
            && sceneRef.current === active.sceneKey
            && versionRef.current === active.dataVersion;
          if (isCurrentCancellation
            && snapshot.stage === "cancelled"
            && matchesJobOwner(active, snapshot)
            && snapshot.percent > (active.latestSnapshot?.percent ?? -1)) {
            publish({ type: "cancelled", snapshot });
          }
        })
        .catch(() => undefined);
    }
    publish({ type: "cancelled" });
  }, [options.apiUrl, publish]);

  useEffect(() => {
    sceneRef.current = options.sceneKey;
    sceneNameRef.current = options.sceneName;
    versionRef.current = options.dataVersion;
    return () => cancel();
  }, [cancel, options.dataVersion, options.sceneKey, options.sceneName]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const run = useCallback((force: boolean) => {
    cancel();
    const owner: Owner = { runId: ++runRef.current, sceneKey: sceneRef.current, dataVersion: versionRef.current };
    const controller = new AbortController();
    const sceneName = sceneNameRef.current;
    ownerRef.current = owner;
    controllerRef.current = controller;
    publish({ type: "running" });
    let latestSnapshot: DiagnosisJobSnapshot | null = null;

    const acceptSnapshot = (snapshot: DiagnosisJobSnapshot) => {
      if (!owns(owner)) return false;
      if (!matchesJobOwner(owner, snapshot)) throw ownershipError();
      if (snapshot.stage === "complete" && (!snapshot.report || !reportBelongsToOwner(owner, snapshot, snapshot.report, sceneName))) {
        throw reportOwnershipError();
      }
      latestSnapshot = snapshot;
      owner.latestSnapshot = snapshot;
      return true;
    };
    const finish = () => {
      if (!owns(owner)) return;
      const snapshot = latestSnapshot;
      if (!snapshot || snapshot.stage !== "complete" || !snapshot.report || !reportBelongsToOwner(owner, snapshot, snapshot.report, sceneName)) {
        throw reportOwnershipError();
      }
      publish({ type: "complete", snapshot, report: snapshot.report });
    };

    void createDiagnosisJob(options.apiUrl, owner.sceneKey, owner.dataVersion, controller.signal, force)
      .then(async (created) => {
        if (!owns(owner)) {
          void cancelDiagnosisJob(options.apiUrl, created.jobId).catch(() => undefined);
          return null;
        }
        if (!matchesCreatedOwner(owner, created)) {
          void cancelDiagnosisJob(options.apiUrl, created.jobId).catch(() => undefined);
          throw ownershipError();
        }
        owner.jobId = created.jobId;
        if (created.stage === "complete" && (!created.report || !reportBelongsToOwner(owner, created, created.report, sceneName))) {
          throw reportOwnershipError();
        }
        latestSnapshot = created;
        owner.latestSnapshot = created;
        if (created.stage === "failed") throw new Error(created.error ?? "诊断任务失败");
        if (created.stage === "cancelled") {
          publish({ type: "cancelled", snapshot: created });
          return null;
        }
        if (created.stage === "complete") return created.report!;
        publish({ type: "progress", snapshot: created });
        return pollDiagnosisJob(options.apiUrl, created.jobId, controller.signal, (snapshot) => {
          if (!acceptSnapshot(snapshot)) return;
          if (snapshot.stage === "failed") publish({ type: "failed", snapshot, error: snapshot.error ?? "诊断任务失败" });
          else if (snapshot.stage === "cancelled") publish({ type: "cancelled", snapshot });
          else publish({ type: "progress", snapshot });
        });
      })
      .then((report) => { if (report) finish(); })
      .catch((failure: unknown) => {
        if (!owns(owner)) return;
        if (isAbort(failure)) { publish({ type: "cancelled" }); return; }
        publish({ type: "failed", snapshot: latestSnapshot, error: failureMessage(failure) });
      })
      .finally(() => {
        if (!owns(owner)) return;
        ownerRef.current = null;
        if (controllerRef.current === controller) controllerRef.current = null;
      });
  }, [cancel, options.apiUrl, owns, publish]);

  const start = useCallback(() => run(false), [run]);
  const rerun = useCallback(() => run(true), [run]);

  const selectEvidence = useCallback((id: string) => { publish({ type: "selectEvidence", id }); }, [publish]);
  return { ...state, start, rerun, cancel, selectEvidence };
}
