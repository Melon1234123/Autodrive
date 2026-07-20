import { Clock3, Play, Radar } from "lucide-react";
import type { ReportV2, RiskEpisode } from "./contracts";
import type { ReportViewModel } from "./report-view-model";

function timeRange(start: number, end: number) {
  return `${start.toFixed(2)}–${end.toFixed(2)} 秒`;
}

export function EvidenceWorkspace({
  report,
  viewModel,
  onSeek,
  onSelectEvidence,
  onSelectTimeline,
}: {
  report: ReportV2;
  viewModel: ReportViewModel;
  onSeek: (time: number) => void;
  onSelectEvidence: (id: string) => void;
  onSelectTimeline: (episode: RiskEpisode) => number;
}) {
  const selected = viewModel.selectedEvidence;
  return (
    <div className="report-evidence-workspace">
      <section className="report-evidence-current">
        <div className="report-rail-heading"><Radar size={14} aria-hidden="true" /><span>当前证据</span></div>
        {selected ? (
          <>
            <strong>{selected.detail}</strong>
            <p>{viewModel.evidenceLabel(selected)}</p>
            <span>{timeRange(selected.start_time, selected.end_time)}</span>
            <button type="button" onClick={() => onSeek(selected.start_time)}>
              <Play size={13} aria-hidden="true" />
              回放 {selected.start_time.toFixed(2)} 秒证据
            </button>
          </>
        ) : <p className="report-empty">报告未提供可回放证据。</p>}
      </section>

      <section className="report-time-rail">
        <div className="report-rail-heading"><Clock3 size={14} aria-hidden="true" /><span>风险时间轴</span></div>
        <div>
          {report.evidence.timeline.length === 0 ? <p className="report-empty">未发现独立风险区间。</p> : report.evidence.timeline.map((episode) => (
            <button
              key={episode.id}
              type="button"
              onClick={() => {
                onSeek(onSelectTimeline(episode));
              }}
              data-risk={episode.risk}
            >
              <span>{timeRange(episode.start_time, episode.end_time)}</span>
              <strong>{episode.summary}</strong>
              <small>峰值 {episode.peak_time.toFixed(2)} 秒{episode.control_conflict ? " · 存在控制冲突" : ""}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="report-evidence-index">
        <div className="report-rail-heading"><span>证据来源</span><small>{report.evidence.index.length} 条</small></div>
        <div>
          {report.evidence.index.map((evidence) => (
            <button
              key={evidence.id}
              type="button"
              className={selected?.id === evidence.id ? "is-selected" : ""}
              onClick={() => {
                onSelectEvidence(evidence.id);
                onSeek(evidence.start_time);
              }}
            >
              <span>{viewModel.evidenceLabel(evidence)}</span>
              <strong>{evidence.detail}</strong>
              <small>{timeRange(evidence.start_time, evidence.end_time)}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
