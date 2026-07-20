/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { DiagnosisRunState } from "./useDiagnosisRun";
import { DiagnosisProgress } from "./DiagnosisProgress";

afterEach(cleanup);

function runState(overrides: Partial<DiagnosisRunState> = {}): DiagnosisRunState {
  return {
    status: "idle",
    snapshot: null,
    report: null,
    error: null,
    selectedEvidenceId: null,
    start: vi.fn(),
    rerun: vi.fn(),
    cancel: vi.fn(),
    selectEvidence: vi.fn(),
    ...overrides,
  };
}

it("keeps progress in screen 03 until the report is complete", () => {
  const onCancel = vi.fn();
  const state = runState({
    status: "running",
    snapshot: {
      jobId: "job-1",
      sceneKey: "default",
      dataVersion: "test-v2",
      stage: "evidence",
      percent: 64,
      report: null,
      error: null,
    },
  });

  render(createElement(DiagnosisProgress, { state, onStart: vi.fn(), onRetry: vi.fn(), onCancel }));

  expect(screen.getByText("正在建立诊断证据链")).toBeVisible();
  expect(screen.getByText("正在组织可回放证据")).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "诊断进度" })).toHaveAttribute("aria-valuenow", "64");
  expect(screen.queryByRole("region", { name: "诊断报告" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "正在诊断" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "取消诊断" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it("keeps failed and cancelled jobs in screen 03 with an enabled next action", () => {
  const onRetry = vi.fn();
  const { rerender } = render(createElement(DiagnosisProgress, {
    state: runState({ status: "failed", error: "provider detail must stay hidden" }),
    onStart: vi.fn(),
    onRetry,
    onCancel: vi.fn(),
  }));

  expect(screen.getByText("诊断未完成，请重试")).toBeVisible();
  expect(screen.queryByText("provider detail must stay hidden")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新诊断" }));
  expect(onRetry).toHaveBeenCalledOnce();

  const onStart = vi.fn();
  rerender(createElement(DiagnosisProgress, {
    state: runState({ status: "cancelled" }),
    onStart,
    onRetry,
    onCancel: vi.fn(),
  }));
  expect(screen.getByText("诊断已取消，可重新启动")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "启动全域诊断" }));
  expect(onStart).toHaveBeenCalledOnce();
});

it("keeps the last backend progress visible after cancellation", () => {
  render(createElement(DiagnosisProgress, {
    state: runState({
      status: "cancelled",
      snapshot: {
        jobId: "job-1",
        sceneKey: "default",
        dataVersion: "test-v2",
        stage: "cancelled",
        percent: 64,
        report: null,
        error: null,
      },
    }),
    onStart: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
  }));

  expect(screen.getByRole("progressbar", { name: "诊断进度" })).toHaveAttribute("aria-valuenow", "64");
});
