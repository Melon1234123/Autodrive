import type { ReactNode } from "react";
import { Clock3 } from "lucide-react";
import type { AnalysisSection, DiagnosisReport, EvidenceRef } from "./types";

type DiagnosisReportViewProps = {
  report: DiagnosisReport;
  onSeekEvidence: (time: number) => void;
};

const scoreLabels: Record<keyof DiagnosisReport["scores"], string> = {
  perception: "感知",
  motion: "运动",
  control: "控制",
  trajectory: "轨迹",
  data_quality: "数据质量",
  overall: "综合风险",
  confidence: "置信度",
};

const metricLabels: Record<string, string> = {
  description: "场景描述",
  duration_seconds: "时长（秒）",
  telemetry_samples: "车辆状态样本",
  perception_samples: "感知样本",
  lidar_available: "激光雷达",
  object_peak: "目标峰值",
  high_risk_object_peak: "高风险目标峰值",
  tracking_continuity: "跟踪连续性",
  peak_speed_kmh: "峰值车速（km/h）",
  peak_abs_accel: "峰值加速度",
  peak_abs_jerk: "峰值加加速度",
  control_conflict_seconds: "控制冲突时长（秒）",
  demo_path_lateral_deviation: "计划路径横向偏移（米）",
};

const sourceLabels: Record<EvidenceRef["source"], string> = {
  camera: "相机",
  perception: "感知",
  lidar: "激光雷达",
  ego_pose: "自车位姿",
  telemetry: "车辆状态",
  trajectory: "轨迹",
};

const provenanceLabels: Record<EvidenceRef["provenance"], string> = {
  real: "真实数据",
  "real-derived": "真实数据推导",
  estimated: "估算数据",
  "demo-visualization": "演示可视化",
};

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "可用" : "不可用";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "--";
  if (Array.isArray(value)) return value.map(displayValue).join("、");
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${metricLabels[key] ?? key}：${displayValue(item)}`)
    .join("；");
}

function ReportSection({ title, children, className = "" }: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`diagnosis-report__section ${className}`} aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function EvidenceButtons({ ids, report, onSeek }: {
  ids: readonly string[];
  report: DiagnosisReport;
  onSeek: (time: number) => void;
}) {
  const evidence = ids.flatMap((id) => {
    const item = report.evidence_index.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });
  if (evidence.length === 0) return null;
  return (
    <div className="diagnosis-report__evidence-actions">
      {evidence.map((item) => (
        <button type="button" key={item.id} onClick={() => onSeek(item.start_time)}>
          <Clock3 size={13} aria-hidden="true" />
          {item.start_time.toFixed(2)} 秒 · {sourceLabels[item.source]}
        </button>
      ))}
    </div>
  );
}

function Analysis({ title, analysis, report, onSeek }: {
  title: string;
  analysis: AnalysisSection;
  report: DiagnosisReport;
  onSeek: (time: number) => void;
}) {
  return (
    <ReportSection title={title}>
      <p>{analysis.summary}</p>
      <dl className="diagnosis-report__metrics">
        {Object.entries(analysis.metrics).map(([key, value]) => (
          <div key={key}><dt>{metricLabels[key] ?? key}</dt><dd>{displayValue(value)}</dd></div>
        ))}
      </dl>
      <EvidenceButtons ids={analysis.evidence_ids} report={report} onSeek={onSeek} />
    </ReportSection>
  );
}

export function DiagnosisReportView({ report, onSeekEvidence }: DiagnosisReportViewProps) {
  return (
    <article className="diagnosis-report" aria-label="全场景诊断报告">
      <header className="diagnosis-report__header">
        <div><p>结构化诊断报告</p><h2>{report.scene_name}</h2></div>
        <span>{report.generation_mode === "model-enhanced" ? "模型增强" : "本地确定性分析"}</span>
      </header>

      <ReportSection title="执行摘要" className="diagnosis-report__summary"><p>{report.executive_summary}</p></ReportSection>

      <ReportSection title="场景概览">
        <dl className="diagnosis-report__metrics">
          {Object.entries(report.scene_overview).map(([key, value]) => (
            <div key={key}><dt>{metricLabels[key] ?? key}</dt><dd>{displayValue(value)}</dd></div>
          ))}
        </dl>
      </ReportSection>

      <ReportSection title="数据质量">
        <div className="diagnosis-report__list">
          {report.data_quality.length > 0 ? report.data_quality.map((finding) => (
            <div key={finding.code} data-tone={finding.severity}>
              <strong>{finding.message}</strong>
              <p>影响模块：{finding.affected_modules.join("、") || "无"}</p>
            </div>
          )) : <p>未发现数据质量问题。</p>}
        </div>
      </ReportSection>

      <ReportSection title="风险评分">
        <dl className="diagnosis-report__scores">
          {Object.entries(report.scores).map(([key, value]) => (
            <div key={key}><dt>{scoreLabels[key as keyof typeof scoreLabels]}</dt><dd>{value === null ? "不可评估" : key === "confidence" ? `${Math.round(value * 100)}%` : value}</dd></div>
          ))}
        </dl>
      </ReportSection>

      <ReportSection title="关键发现">
        <div className="diagnosis-report__list">
          {report.key_findings.length > 0 ? report.key_findings.map((finding) => (
            <div key={finding.id} data-tone={finding.severity}>
              <strong>{finding.title}</strong><p>{finding.summary}</p>
              <EvidenceButtons ids={finding.evidence_ids} report={report} onSeek={onSeekEvidence} />
            </div>
          )) : <p>未发现需要单列的关键问题。</p>}
        </div>
      </ReportSection>

      <ReportSection title="历史风险事件">
        <div className="diagnosis-report__list">
          {report.historical_risk_events.length > 0 ? report.historical_risk_events.map((episode) => (
            <div key={`history-${episode.id}`} data-tone={episode.risk}>
              <strong>{episode.summary}</strong>
              <p>{episode.start_time.toFixed(2)}–{episode.end_time.toFixed(2)} 秒 · {episode.control_conflict ? "存在控制冲突" : "未检出控制冲突"}</p>
              <button className="diagnosis-report__time" type="button" onClick={() => onSeekEvidence(episode.peak_time)}>
                <Clock3 size={13} aria-hidden="true" />峰值 {episode.peak_time.toFixed(2)} 秒
              </button>
              <EvidenceButtons ids={episode.evidence_ids} report={report} onSeek={onSeekEvidence} />
            </div>
          )) : <p>已完成场景中未归档持续风险事件。</p>}
        </div>
      </ReportSection>

      <ReportSection title="风险时间线">
        <div className="diagnosis-report__list">
          {report.timeline.length > 0 ? report.timeline.map((episode) => (
            <div key={episode.id} data-tone={episode.risk}>
              <strong>{episode.summary}</strong>
              <p>{episode.start_time.toFixed(2)}–{episode.end_time.toFixed(2)} 秒 · {episode.control_conflict ? "存在控制冲突" : "未检出控制冲突"}</p>
              <button className="diagnosis-report__time" type="button" onClick={() => onSeekEvidence(episode.peak_time)}>
                <Clock3 size={13} aria-hidden="true" />峰值 {episode.peak_time.toFixed(2)} 秒
              </button>
            </div>
          )) : <p>时间线上未检出持续风险事件。</p>}
        </div>
      </ReportSection>

      <Analysis title="感知分析" analysis={report.perception_analysis} report={report} onSeek={onSeekEvidence} />
      <Analysis title="运动与控制分析" analysis={report.motion_control_analysis} report={report} onSeek={onSeekEvidence} />
      <Analysis title="轨迹分析" analysis={report.trajectory_analysis} report={report} onSeek={onSeekEvidence} />

      <ReportSection title="因果链">
        <div className="diagnosis-report__list">
          {report.causal_chains.length > 0 ? report.causal_chains.map((chain, index) => (
            <div key={`${chain.observation}-${index}`}>
              <p><b>观察：</b>{chain.observation}</p><p><b>机制：</b>{chain.mechanism}</p><p><b>可能影响：</b>{chain.possible_impact}</p>
              <small>置信度 {Math.round(chain.confidence * 100)}%</small>
              <EvidenceButtons ids={chain.evidence_ids} report={report} onSeek={onSeekEvidence} />
            </div>
          )) : <p>当前证据不足以建立因果链。</p>}
        </div>
      </ReportSection>

      <ReportSection title="优化建议">
        <div className="diagnosis-report__list">
          {report.recommendations.length > 0 ? report.recommendations.map((recommendation) => (
            <div key={recommendation.id} data-tone={recommendation.priority}>
              <strong>{recommendation.action}</strong><p>{recommendation.rationale}</p>
              <EvidenceButtons ids={recommendation.evidence_ids} report={report} onSeek={onSeekEvidence} />
            </div>
          )) : <p>暂无专项优化建议。</p>}
        </div>
      </ReportSection>

      <ReportSection title="回归测试">
        <div className="diagnosis-report__list">
          {report.regression_tests.length > 0 ? report.regression_tests.map((test) => (
            <div key={test.name}><strong>{test.name}</strong><p>{test.criterion}</p><small>{test.rationale}</small></div>
          )) : <p>暂无专项回归测试。</p>}
        </div>
      </ReportSection>

      <ReportSection title="证据索引">
        <div className="diagnosis-report__list">
          {report.evidence_index.length > 0 ? report.evidence_index.map((evidence) => (
            <div key={evidence.id}>
              <strong>{sourceLabels[evidence.source]} · {provenanceLabels[evidence.provenance]}</strong><p>{evidence.detail}</p>
              <button className="diagnosis-report__time" type="button" onClick={() => onSeekEvidence(evidence.start_time)}>
                <Clock3 size={13} aria-hidden="true" />{evidence.start_time.toFixed(2)} 秒
              </button>
            </div>
          )) : <p>没有可定位的证据条目。</p>}
        </div>
      </ReportSection>

      <ReportSection title="分析限制">
        {report.limitations.length > 0 ? <ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>无额外分析限制。</p>}
      </ReportSection>
    </article>
  );
}
