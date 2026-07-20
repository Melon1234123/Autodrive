// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportFixture, snapshotFixture } from "./test-fixtures";

const api = vi.hoisted(() => ({
  createDiagnosisJob: vi.fn(),
  pollDiagnosisJob: vi.fn(),
  cancelDiagnosisJob: vi.fn(),
}));

vi.mock("./api", () => api);

import { useDiagnosisRun } from "./useDiagnosisRun";

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  api.cancelDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "cancelled", percent: 0, report: null }));
});

function renderRun(sceneKey = "default", dataVersion = "test-v2") {
  return renderHook(({ scene, version }) => useDiagnosisRun({ apiUrl: "/api", sceneKey: scene, dataVersion: version }), {
    initialProps: { scene: sceneKey, version: dataVersion },
  });
}

describe("useDiagnosisRun", () => {
  it("publishes a diagnosis run after the StrictMode effect probe", async () => {
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(snapshotFixture());
      return reportFixture;
    });
    const { result } = renderHook(
      () => useDiagnosisRun({ apiUrl: "/api", sceneKey: "default", dataVersion: "test-v2" }),
      { wrapper: ({ children }) => createElement(StrictMode, null, children) },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("complete"));
  });

  it("rejects a creation snapshot for another scene without polling", async () => {
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ sceneKey: "other-scene", stage: "validation", percent: 10, report: null }));
    const { result } = renderRun("default", "test-v2");
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("诊断任务读取失败：任务归属不匹配");
    expect(api.pollDiagnosisJob).not.toHaveBeenCalled();
  });

  it("rejects a polling snapshot for another job owner", async () => {
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(snapshotFixture({ dataVersion: "other-version", stage: "evidence", percent: 60, report: null }));
      return reportFixture;
    });
    const { result } = renderRun("default", "test-v2");
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("诊断任务读取失败：任务归属不匹配");
    expect(result.current.report).toBeNull();
  });

  it("rejects a polling snapshot with another job id", async () => {
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(snapshotFixture({ jobId: "job-2", stage: "evidence", percent: 60, report: null }));
      return reportFixture;
    });
    const { result } = renderRun();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("诊断任务读取失败：任务归属不匹配");
    expect(result.current.report).toBeNull();
  });

  it("rejects a completed report with a mismatched data version", async () => {
    const mismatchedReport = { ...reportFixture, meta: { ...reportFixture.meta, data_version: "other-version" } };
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(snapshotFixture({ report: mismatchedReport }));
      return mismatchedReport;
    });
    const { result } = renderRun("default", "test-v2");
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("诊断任务读取失败：报告归属不匹配");
    expect(result.current.report).toBeNull();
  });

  it("rejects a completed report with a mismatched caller-supplied scene name", async () => {
    const mismatchedReport = { ...reportFixture, meta: { ...reportFixture.meta, scene_name: "其他场景" } };
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(snapshotFixture({ report: mismatchedReport }));
      return mismatchedReport;
    });
    const { result } = renderHook(() => useDiagnosisRun({
      apiUrl: "/api",
      sceneKey: "default",
      sceneName: reportFixture.meta.scene_name,
      dataVersion: "test-v2",
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("诊断任务读取失败：报告归属不匹配");
  });

  it("publishes normal progress and a completed report", async () => {
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(snapshotFixture({ stage: "evidence", percent: 60, report: null }));
      onProgress(snapshotFixture());
      return reportFixture;
    });
    const { result } = renderRun();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(result.current.snapshot?.stage).toBe("complete");
    expect(result.current.report).toEqual(reportFixture);
  });

  it("forces a fresh job when rerunning a completed report", async () => {
    api.createDiagnosisJob
      .mockResolvedValueOnce(snapshotFixture())
      .mockResolvedValueOnce(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementationOnce(async (_url, _id, _signal, onProgress) => {
      onProgress(snapshotFixture());
      return reportFixture;
    });
    const { result } = renderRun();

    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("complete"));
    act(() => result.current.rerun());
    await waitFor(() => expect(api.createDiagnosisJob).toHaveBeenCalledTimes(2));

    expect(api.createDiagnosisJob.mock.calls[0][4]).toBe(false);
    expect(api.createDiagnosisJob.mock.calls[1][4]).toBe(true);
  });

  it("maps server failed and cancelled snapshots to terminal states", async () => {
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "failed", percent: 20, report: null, error: "场景无效" }));
    const failed = renderRun();
    act(() => failed.result.current.start());
    await waitFor(() => expect(failed.result.current.status).toBe("failed"));
    expect(failed.result.current.error).toBe("场景无效");
    failed.unmount();

    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "cancelled", percent: 20, report: null }));
    const cancelled = renderRun();
    act(() => cancelled.result.current.start());
    await waitFor(() => expect(cancelled.result.current.status).toBe("cancelled"));
  });

  it("retains the server failure snapshot received during polling", async () => {
    const failedSnapshot = snapshotFixture({ stage: "failed", percent: 35, report: null, error: "场景无效" });
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(failedSnapshot);
      throw new Error("场景无效");
    });
    const { result } = renderRun();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.snapshot).toEqual(failedSnapshot);
  });

  it("treats AbortError as cancelled and requests server cancellation only for an active job", async () => {
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(() => new Promise(() => undefined));
    api.cancelDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "cancelled", percent: 10, report: null }));
    const { result } = renderRun();
    act(() => result.current.start());
    await waitFor(() => expect(api.pollDiagnosisJob).toHaveBeenCalled());
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    expect(api.cancelDiagnosisJob).toHaveBeenCalledWith("/api", "job-1");
    expect(result.current.snapshot).toMatchObject({ stage: "validation", percent: 10 });
  });

  it("publishes a newer cancelled snapshot returned by manual cancellation", async () => {
    let resolveCancellation: ((snapshot: ReturnType<typeof snapshotFixture>) => void) | undefined;
    const cancelledSnapshot = snapshotFixture({ stage: "cancelled", percent: 64, report: null });
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(() => new Promise(() => undefined));
    api.cancelDiagnosisJob.mockImplementation(() => new Promise((resolve) => { resolveCancellation = resolve; }));
    const { result } = renderRun();

    act(() => result.current.start());
    await waitFor(() => expect(api.pollDiagnosisJob).toHaveBeenCalled());
    act(() => result.current.cancel());
    await act(async () => resolveCancellation?.(cancelledSnapshot));

    expect(result.current.status).toBe("cancelled");
    expect(result.current.snapshot).toEqual(cancelledSnapshot);
  });

  it("ignores a delayed cancellation response after a new run starts", async () => {
    let resolveCancellation: ((snapshot: ReturnType<typeof snapshotFixture>) => void) | undefined;
    const staleCancelledSnapshot = snapshotFixture({ stage: "cancelled", percent: 64, report: null });
    api.createDiagnosisJob
      .mockResolvedValueOnce(snapshotFixture({ stage: "validation", percent: 10, report: null }))
      .mockResolvedValueOnce(snapshotFixture({ jobId: "job-2", stage: "validation", percent: 20, report: null }));
    api.pollDiagnosisJob.mockImplementation(() => new Promise(() => undefined));
    api.cancelDiagnosisJob.mockImplementation(() => new Promise((resolve) => { resolveCancellation = resolve; }));
    const { result } = renderRun();

    act(() => result.current.start());
    await waitFor(() => expect(api.pollDiagnosisJob).toHaveBeenCalledTimes(1));
    act(() => result.current.cancel());
    act(() => result.current.start());
    await waitFor(() => expect(api.pollDiagnosisJob).toHaveBeenCalledTimes(2));
    await act(async () => resolveCancellation?.(staleCancelledSnapshot));

    expect(result.current.status).toBe("running");
    expect(result.current.snapshot).toMatchObject({ jobId: "job-2", stage: "validation", percent: 20 });
  });

  it("ignores a delayed cancellation response after switching scenes", async () => {
    let resolveCancellation: ((snapshot: ReturnType<typeof snapshotFixture>) => void) | undefined;
    const staleCancelledSnapshot = snapshotFixture({ stage: "cancelled", percent: 64, report: null });
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(() => new Promise(() => undefined));
    api.cancelDiagnosisJob.mockImplementation(() => new Promise((resolve) => { resolveCancellation = resolve; }));
    const { result, rerender } = renderRun();

    act(() => result.current.start());
    await waitFor(() => expect(api.pollDiagnosisJob).toHaveBeenCalled());
    rerender({ scene: "scene-b", version: "test-v2" });
    await act(async () => resolveCancellation?.(staleCancelledSnapshot));

    expect(result.current.status).toBe("cancelled");
    expect(result.current.snapshot).toMatchObject({ stage: "validation", percent: 10 });
  });

  it("retains the server cancellation snapshot received during polling", async () => {
    const cancelledSnapshot = snapshotFixture({ stage: "cancelled", percent: 64, report: null });
    api.createDiagnosisJob.mockResolvedValue(snapshotFixture({ stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementation(async (_url, _id, _signal, onProgress) => {
      onProgress(cancelledSnapshot);
      throw new DOMException("Cancelled", "AbortError");
    });
    const { result } = renderRun();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    expect(result.current.snapshot).toEqual(cancelledSnapshot);
  });

  it("treats an aborted request as cancelled rather than failed", async () => {
    api.createDiagnosisJob.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const { result } = renderRun();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    expect(result.current.error).toBeNull();
  });

  it("fences stale scene completion and retries with a new owner", async () => {
    let finishFirst: ((report: typeof reportFixture) => void) | undefined;
    api.createDiagnosisJob
      .mockResolvedValueOnce(snapshotFixture({ stage: "validation", percent: 10, report: null }))
      .mockResolvedValueOnce(snapshotFixture({ sceneKey: "scene-b", stage: "validation", percent: 10, report: null }));
    api.pollDiagnosisJob.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(async (_url, _id, _signal, onProgress) => {
        onProgress(snapshotFixture({ sceneKey: "scene-b" }));
        return reportFixture;
      });
    const { result, rerender } = renderRun();
    act(() => result.current.start());
    await waitFor(() => expect(api.pollDiagnosisJob).toHaveBeenCalledTimes(1));
    rerender({ scene: "scene-b", version: "test-v2" });
    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    await act(async () => finishFirst?.(reportFixture));
    expect(result.current.report).toBeNull();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(api.createDiagnosisJob).toHaveBeenCalledTimes(2);
  });
});
