import { decodeDiagnosisSnapshot, type DiagnosisJobSnapshot, type ReportV2 } from "./contracts";

function endpoint(apiUrl: string, path: string) { return `${apiUrl.replace(/\/$/, "")}${path}`; }
function abortError() { return new DOMException("Aborted", "AbortError"); }
function delay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", handleAbort);
      reject(abortError());
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}
async function readSnapshot(response: Response, action: "创建" | "读取" | "取消") {
  if (!response.ok) throw new Error(`诊断任务${action}失败：HTTP ${response.status}`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error(`诊断任务${action}失败：响应不是合法 JSON`); }
  return decodeDiagnosisSnapshot(payload);
}

export async function createDiagnosisJob(
  apiUrl: string,
  sceneKey: string,
  dataVersion: string,
  signal: AbortSignal,
  force = false,
): Promise<DiagnosisJobSnapshot> {
  const response = await fetch(endpoint(apiUrl, "/api/v1/diagnoses"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneKey, dataVersion, force }),
    signal,
  });
  return readSnapshot(response, "创建");
}

export async function pollDiagnosisJob(apiUrl: string, jobId: string, signal: AbortSignal, onProgress: (snapshot: DiagnosisJobSnapshot) => void, intervalMs = 350): Promise<ReportV2> {
  let highestPercent = 0;
  while (!signal.aborted) {
    const response = await fetch(endpoint(apiUrl, `/api/v1/diagnoses/${encodeURIComponent(jobId)}`), { signal });
    const snapshot = await readSnapshot(response, "读取");
    highestPercent = Math.max(highestPercent, snapshot.percent);
    onProgress(snapshot.percent === highestPercent ? snapshot : { ...snapshot, percent: highestPercent });
    if (snapshot.stage === "complete") return snapshot.report!;
    if (snapshot.stage === "failed") throw new Error(snapshot.error ?? "诊断任务失败");
    if (snapshot.stage === "cancelled") throw new DOMException("Cancelled", "AbortError");
    await delay(intervalMs, signal);
  }
  throw abortError();
}

export async function cancelDiagnosisJob(apiUrl: string, jobId: string): Promise<DiagnosisJobSnapshot> {
  const response = await fetch(endpoint(apiUrl, `/api/v1/diagnoses/${encodeURIComponent(jobId)}`), { method: "DELETE" });
  return readSnapshot(response, "取消");
}
