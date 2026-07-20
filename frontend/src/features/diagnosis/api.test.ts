import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelDiagnosisJob, createDiagnosisJob, pollDiagnosisJob } from "./api";
import { reportFixture, snapshotFixture } from "./test-fixtures";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("diagnosis API", () => {
  it("creates, polls, and URL-encodes cancellation requests", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshotFixture({ stage: "queued", percent: 0, report: null }), 202))
      .mockResolvedValueOnce(jsonResponse(snapshotFixture({ stage: "complete", percent: 100, report: reportFixture })))
      .mockResolvedValueOnce(jsonResponse(snapshotFixture({ stage: "cancelled", percent: 20, report: null })));
    vi.stubGlobal("fetch", fetchMock);

    await createDiagnosisJob("http://localhost:8080/", "scene key", "v 2", signal);
    await expect(pollDiagnosisJob("http://localhost:8080", "job/1", signal, vi.fn(), 0)).resolves.toEqual(reportFixture);
    await cancelDiagnosisJob("http://localhost:8080/", "job/1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:8080/api/v1/diagnoses", expect.objectContaining({ method: "POST", signal }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://localhost:8080/api/v1/diagnoses/job%2F1", { signal });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://localhost:8080/api/v1/diagnoses/job%2F1", { method: "DELETE" });
  });

  it("marks an explicit rerun as forced without changing ordinary creation", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshotFixture({ stage: "queued", percent: 0, report: null }), 202))
      .mockResolvedValueOnce(jsonResponse(snapshotFixture({ stage: "queued", percent: 0, report: null }), 202));
    vi.stubGlobal("fetch", fetchMock);

    await createDiagnosisJob("/api", "default", "v2", signal);
    await createDiagnosisJob("/api", "default", "v2", signal, true);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sceneKey: "default", dataVersion: "v2", force: false });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sceneKey: "default", dataVersion: "v2", force: true });
  });

  it("maps HTTP, JSON, and malformed snapshot responses to safe Chinese errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(createDiagnosisJob("/api", "a", "v2", new AbortController().signal)).rejects.toThrow("诊断任务创建失败：HTTP 503");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    await expect(cancelDiagnosisJob("/api", "a")).rejects.toThrow("诊断任务取消失败：响应不是合法 JSON");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(snapshotFixture({ stage: "complete", report: null }))));
    await expect(pollDiagnosisJob("/api", "a", new AbortController().signal, vi.fn(), 0)).rejects.toThrow("报告结构不合法");
  });

  it("removes the successful poll-delay abort listener", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshotFixture({ stage: "validation", percent: 10, report: null })))
      .mockResolvedValueOnce(jsonResponse(snapshotFixture())));

    const polling = pollDiagnosisJob("/api", "job-1", controller.signal, vi.fn(), 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(polling).resolves.toEqual(reportFixture);
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
