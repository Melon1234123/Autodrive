import { RotateCcw, ScanSearch, X } from "lucide-react";
import { useRef } from "react";
import type { DiagnosisStage } from "./contracts";
import type { DiagnosisRunState } from "./useDiagnosisRun";

const stageLabels: Record<DiagnosisStage, string> = {
  queued: "正在等待诊断资源",
  validation: "正在校验场景数据",
  alignment: "正在对齐多源时间线",
  features: "正在提取驾驶特征",
  events: "正在定位风险事件",
  evidence: "正在组织可回放证据",
  narrative: "正在形成诊断结论",
  report: "正在校验报告结构",
  complete: "诊断报告已完成",
  failed: "诊断未完成",
  cancelled: "诊断已取消",
};

export function DiagnosisProgress({
  state,
  onStart,
  onRetry,
  onCancel,
}: {
  state: DiagnosisRunState;
  onStart: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const previousStatus = useRef(state.status);
  const progress = useRef(0);
  if (state.status === "running") {
    if (previousStatus.current !== "running") progress.current = 0;
    progress.current = Math.max(progress.current, state.snapshot?.percent ?? 0);
  } else if (state.status === "complete") {
    progress.current = 100;
  } else if (state.status === "cancelled") {
    progress.current = Math.max(progress.current, state.snapshot?.percent ?? 0);
  } else if (state.status === "idle") {
    progress.current = 0;
  }
  previousStatus.current = state.status;

  const running = state.status === "running";
  const stage = state.snapshot?.stage ?? (state.status === "complete" ? "complete" : "queued");
  const statusText = running
    ? "正在建立诊断证据链"
    : state.status === "complete"
      ? "诊断报告已完成"
      : state.status === "failed"
        ? "诊断任务已中止"
        : state.status === "cancelled"
          ? "诊断任务已取消"
          : "等待启动全场景诊断";

  return (
    <div className="diagnosis-progress">
      <div className="diagnosis-action__header">
        <span>驾驶诊断</span>
        <strong aria-live="polite">{statusText}</strong>
      </div>
      <div className="diagnosis-action__status-grid">
        <div>
          <span>全场景报告</span>
          <strong>{running || state.status === "cancelled" ? `${progress.current}%` : state.status === "complete" ? "已完成" : "待执行"}</strong>
        </div>
        <div>
          <span>当前阶段</span>
          <strong>{state.status === "failed" ? "任务中止" : state.status === "cancelled" ? "已取消" : stageLabels[stage]}</strong>
        </div>
      </div>
      <div
        className="cockpit-diagnosis-progress"
        role="progressbar"
        aria-label="诊断进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.current}
      >
        <i style={{ width: `${progress.current}%` }} />
      </div>
      {state.status === "failed" ? <p className="diagnosis-progress__notice" role="status">诊断未完成，请重试</p> : null}
      {state.status === "cancelled" ? <p className="diagnosis-progress__notice" role="status">诊断已取消，可重新启动</p> : null}
      {state.status === "failed" ? (
        <button className="diagnose-button" type="button" onClick={onRetry}>
          <RotateCcw size={14} aria-hidden="true" />
          重新诊断
        </button>
      ) : (
        <button className="diagnose-button" type="button" onClick={onStart} disabled={running}>
          <ScanSearch size={14} aria-hidden="true" />
          {running ? "正在诊断" : "启动全域诊断"}
        </button>
      )}
      {running ? (
        <button className="diagnose-button" type="button" onClick={onCancel}>
          <X size={14} aria-hidden="true" />
          取消诊断
        </button>
      ) : null}
    </div>
  );
}
