import type { DiagnosisJobSnapshot, DiagnosisReport } from "./types";

function endpoint(apiUrl: string, path: string) {
  return `${apiUrl.replace(/\/$/, "")}${path}`;
}

async function readSnapshot(response: Response, action: "创建" | "读取") {
  if (!response.ok) throw new Error(`诊断任务${action}失败：HTTP ${response.status}`);
  try {
    return await response.json() as DiagnosisJobSnapshot;
  } catch {
    throw new Error(`诊断任务${action}失败：响应不是合法 JSON`);
  }
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", handleAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function createDiagnosisJob(
  apiUrl: string,
  sceneKey: string,
  dataVersion: string,
  signal: AbortSignal,
): Promise<DiagnosisJobSnapshot> {
  const response = await fetch(endpoint(apiUrl, "/api/v1/diagnoses"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneKey, dataVersion }),
    signal,
  });
  return readSnapshot(response, "创建");
}

export async function pollDiagnosisJob(
  apiUrl: string,
  jobId: string,
  signal: AbortSignal,
  onProgress: (snapshot: DiagnosisJobSnapshot) => void,
): Promise<DiagnosisReport> {
  let highestPercent = 0;
  while (!signal.aborted) {
    const response = await fetch(
      endpoint(apiUrl, `/api/v1/diagnoses/${encodeURIComponent(jobId)}`),
      { signal },
    );
    const snapshot = await readSnapshot(response, "读取");
    highestPercent = Math.max(highestPercent, snapshot.percent);
    const monotonicSnapshot = snapshot.percent === highestPercent
      ? snapshot
      : { ...snapshot, percent: highestPercent };
    onProgress(monotonicSnapshot);
    if (snapshot.stage === "complete") {
      if (!snapshot.report) throw new Error("诊断任务完成但未返回报告");
      return snapshot.report;
    }
    if (snapshot.stage === "failed") throw new Error(snapshot.error ?? "诊断任务失败");
    await abortableDelay(350, signal);
  }
  throw abortError();
}
