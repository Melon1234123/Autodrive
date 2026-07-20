import { ArrowLeft, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { AnalysisWorkspace } from "./AnalysisWorkspace";
import type { GenerationMetadata, ReportV2, RiskEpisode } from "./contracts";
import { EvidenceWorkspace } from "./EvidenceWorkspace";
import { createReportViewModel } from "./report-view-model";
import { SupportModules } from "./SupportModules";
import "./diagnosis-report.css";

type ReportScreenProps = {
  report: ReportV2;
  videoSlotRef: RefObject<HTMLDivElement | null>;
  screenRef?: RefObject<HTMLElement | null>;
  selectedEvidenceTime?: number | null;
  onSeekEvidence?: (time: number) => void;
  onSeekReportEvidence?: (time: number) => void;
  onReturnToDiagnosis: (time: number | null) => void;
  onRerunDiagnosis: () => void;
};

const fallbackLabels: Record<NonNullable<GenerationMetadata["fallback_reason"]>, string> = {
  timeout: "模型响应超时，已切换为本地可验证分析",
  unavailable: "模型服务暂不可用，已切换为本地可验证分析",
  invalid_response: "模型结果未通过校验，已切换为本地可验证分析",
  disabled: "当前使用本地可验证分析",
};

export function ReportGenerationBadge({ generation }: { generation: GenerationMetadata }) {
  const text = generation.mode === "model-grounded"
    ? "模型分析已通过事实校验"
    : fallbackLabels[generation.fallback_reason ?? "disabled"];
  return <span className="report-generation-badge"><ShieldCheck size={13} aria-hidden="true" />{text}</span>;
}

export function ReportScreen({
  report,
  selectedEvidenceTime,
  videoSlotRef,
  screenRef,
  onSeekEvidence,
  onSeekReportEvidence,
  onReturnToDiagnosis,
  onRerunDiagnosis,
}: ReportScreenProps) {
  const initialEvidence = report.evidence.index.find((item) => item.start_time === selectedEvidenceTime)
    ?? report.evidence.index.find((item) => item.id === report.evidence.default_evidence_id)
    ?? report.evidence.index[0]
    ?? null;
  const initialEvidenceId = initialEvidence?.id ?? null;
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(initialEvidenceId);
  const [returnEvidenceTime, setReturnEvidenceTime] = useState<number | null>(initialEvidence?.start_time ?? null);
  useEffect(() => {
    setSelectedEvidenceId(initialEvidenceId);
    setReturnEvidenceTime(initialEvidence?.start_time ?? null);
  }, [initialEvidence, initialEvidenceId, report]);
  const viewModel = useMemo(
    () => createReportViewModel(report, selectedEvidenceId),
    [report, selectedEvidenceId],
  );
  const handleSeek = onSeekEvidence ?? onSeekReportEvidence ?? (() => undefined);
  const handleSelectEvidence = useCallback((id: string) => {
    const evidence = report.evidence.index.find((item) => item.id === id);
    if (!evidence) return;
    setSelectedEvidenceId(evidence.id);
    setReturnEvidenceTime(evidence.start_time);
  }, [report]);
  const handleSelectTimeline = useCallback((episode: RiskEpisode) => {
    const evidence = episode.evidence_ids
      .map((id) => report.evidence.index.find((item) => item.id === id))
      .find((item) => item !== undefined);
    if (evidence) {
      handleSelectEvidence(evidence.id);
      return evidence.start_time;
    }
    setSelectedEvidenceId(null);
    setReturnEvidenceTime(episode.peak_time);
    return episode.peak_time;
  }, [handleSelectEvidence, report]);

  return (
    <section
      ref={screenRef}
      className="cockpit-screen cockpit-report"
      data-cockpit-screen="report"
      aria-label="诊断报告"
    >
      <header className="cockpit-report__topbar">
        <div>
          <p>04 / 诊断报告</p>
          <h2>{report.meta.scene_name}</h2>
        </div>
        <ReportGenerationBadge generation={report.meta.generation} />
        <div className="cockpit-report__actions">
          <button type="button" onClick={() => onReturnToDiagnosis(returnEvidenceTime ?? viewModel.selectedEvidence?.start_time ?? null)}>
            <ArrowLeft size={13} aria-hidden="true" />
            返回 03
          </button>
          <button type="button" onClick={onRerunDiagnosis}>
            <RotateCcw size={13} aria-hidden="true" />
            重新诊断
          </button>
        </div>
      </header>
      <div className="cockpit-report__workspace" data-cockpit-scroll-surface="">
        <section className="cockpit-report__analysis" aria-label="分析" data-cockpit-scroll-surface="">
          <AnalysisWorkspace
            report={report}
            viewModel={viewModel}
            onSelectEvidence={handleSelectEvidence}
          />
          <SupportModules report={report} />
        </section>
        <aside className="cockpit-report__evidence" aria-label="证据" data-cockpit-scroll-surface="">
          <div className="cockpit-report__video">
            <div ref={videoSlotRef} className="cockpit-video-slot" data-testid="report-video-slot" />
          </div>
          <EvidenceWorkspace
            report={report}
            viewModel={viewModel}
            onSeek={handleSeek}
            onSelectEvidence={handleSelectEvidence}
            onSelectTimeline={handleSelectTimeline}
          />
        </aside>
      </div>
    </section>
  );
}
