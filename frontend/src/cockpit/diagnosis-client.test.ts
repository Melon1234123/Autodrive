import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisJobSnapshot, DiagnosisReport } from "./types";
import { createDiagnosisJob, pollDiagnosisJob } from "./diagnosis-client";

const report = {
  schema_version: "1.0",
  scene_name: "城市路口侧向超车",
  data_version: "test-v1",
  generation_mode: "local-harness",
  executive_summary: "分析完成。",
  scene_overview: {},
  data_quality: [],
  scores: {
    perception: 20,
    motion: 10,
    control: 5,
    trajectory: 10,
    data_quality: 100,
    overall: 13,
    confidence: 1,
  },
  key_findings: [],
  timeline: [],
  perception_analysis: { summary: "未发现异常。", metrics: {}, evidence_ids: [] },
  motion_control_analysis: { summary: "未发现异常。", metrics: {}, evidence_ids: [] },
  trajectory_analysis: { summary: "未发现异常。", metrics: {}, evidence_ids: [] },
  causal_chains: [],
  recommendations: [],
  regression_tests: [],
  evidence_index: [],
  limitations: [],
} satisfies DiagnosisReport;

function job(
  stage: DiagnosisJobSnapshot["stage"],
  percent: number,
  completedReport: DiagnosisReport | null = null,
): DiagnosisJobSnapshot {
  return {
    jobId: "job-1",
    sceneKey: "internal-scene",
    dataVersion: "test-v1",
    stage,
    percent,
    report: completedReport,
    error: null,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createDiagnosisJob", () => {
  it("posts the scene and data version to the diagnosis route", async () => {
    const snapshot = job("validation", 10);
    const fetchMock = vi.fn(async () => jsonResponse(snapshot, 202));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(createDiagnosisJob("http://localhost:8080/", "scene key", "v 1", signal))
      .resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/diagnoses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneKey: "scene key", dataVersion: "v 1" }),
      signal,
    });
  });

  it("reports HTTP and invalid JSON failures in Chinese", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(createDiagnosisJob("http://localhost:8080", "a", "v1", new AbortController().signal))
      .rejects.toThrow("诊断任务创建失败：HTTP 503");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 202 })));
    await expect(createDiagnosisJob("http://localhost:8080", "a", "v1", new AbortController().signal))
      .rejects.toThrow("诊断任务创建失败：响应不是合法 JSON");
  });
});

describe("pollDiagnosisJob", () => {
  it("polls monotonic progress and stops after complete", async () => {
    vi.useFakeTimers();
    const responses = [job("validation", 10), job("report", 86), job("complete", 100, report)];
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(responses.shift())));
    const progress: number[] = [];

    const polling = pollDiagnosisJob(
      "http://localhost:8080",
      "job-1",
      new AbortController().signal,
      (snapshot) => progress.push(snapshot.percent),
    );
    await vi.runAllTimersAsync();

    await expect(polling).resolves.toEqual(report);
    expect(progress).toEqual([10, 86, 100]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never publishes regressing progress", async () => {
    vi.useFakeTimers();
    const responses = [job("validation", 42), job("timeline", 18), job("complete", 100, report)];
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(responses.shift())));
    const progress: number[] = [];

    const polling = pollDiagnosisJob(
      "http://localhost:8080",
      "job-1",
      new AbortController().signal,
      (snapshot) => progress.push(snapshot.percent),
    );
    await vi.runAllTimersAsync();

    await polling;
    expect(progress).toEqual([42, 42, 100]);
  });

  it("supports abort and reports HTTP, invalid JSON, and failed jobs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 502 })));
    await expect(pollDiagnosisJob("http://localhost:8080", "job/1", new AbortController().signal, vi.fn()))
      .rejects.toThrow("诊断任务读取失败：HTTP 502");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    await expect(pollDiagnosisJob("http://localhost:8080", "job/1", new AbortController().signal, vi.fn()))
      .rejects.toThrow("诊断任务读取失败：响应不是合法 JSON");

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...job("failed", 20), error: "场景数据损坏" })));
    await expect(pollDiagnosisJob("http://localhost:8080", "job/1", new AbortController().signal, vi.fn()))
      .rejects.toThrow("场景数据损坏");

    const controller = new AbortController();
    controller.abort();
    await expect(pollDiagnosisJob("http://localhost:8080", "job/1", controller.signal, vi.fn()))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
