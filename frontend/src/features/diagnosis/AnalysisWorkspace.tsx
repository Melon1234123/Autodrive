import { ArrowRight, Gauge, Link2, ListChecks, ScanLine } from "lucide-react";
import type { ReactNode } from "react";
import type { EvidenceRef, ReportV2 } from "./contracts";
import type { ReportViewModel } from "./report-view-model";

const scoreLabels: Record<keyof ReportV2["analysis"]["risk_profile"], string> = {
  perception: "感知",
  motion: "运动",
  control: "控制",
  trajectory: "轨迹",
  data_quality: "数据",
  overall: "综合",
  confidence: "置信",
};

function scoreText(key: keyof ReportV2["analysis"]["risk_profile"], value: number | null) {
  if (value === null) return "未评估";
  return key === "confidence" ? `${Math.round(value * 100)}%` : value.toFixed(0);
}

function ModuleTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <h3 className="report-module__title">{icon}{children}</h3>;
}

function EvidenceActions({
  ids,
  viewModel,
  onSelectEvidence,
}: {
  ids: string[];
  viewModel: ReportViewModel;
  onSelectEvidence: (id: string) => void;
}) {
  const evidence = ids
    .map((id) => viewModel.evidenceById.get(id))
    .filter((item): item is EvidenceRef => Boolean(item));
  if (evidence.length === 0) return null;
  return (
    <div className="report-evidence-links">
      {evidence.map((item, index) => (
        <button key={item.id} type="button" onClick={() => onSelectEvidence(item.id)}>
          <ScanLine size={12} aria-hidden="true" />
          证据 {index + 1} · {item.start_time.toFixed(2)} 秒
        </button>
      ))}
    </div>
  );
}

export function AnalysisWorkspace({
  report,
  viewModel,
  onSelectEvidence,
}: {
  report: ReportV2;
  viewModel: ReportViewModel;
  onSelectEvidence: (id: string) => void;
}) {
  const { analysis } = report;
  return (
    <div className="report-analysis-workspace">
      <article className="report-executive">
        <span>执行结论</span>
        <p>{analysis.executive_summary}</p>
      </article>

      <dl className="report-score-strip" aria-label="风险评分">
        {Object.entries(analysis.risk_profile).map(([key, value]) => (
          <div key={key}>
            <dt>{scoreLabels[key as keyof typeof scoreLabels]}</dt>
            <dd>{scoreText(key as keyof typeof scoreLabels, value)}</dd>
          </div>
        ))}
      </dl>

      <section className="report-module">
        <ModuleTitle icon={<Gauge size={15} aria-hidden="true" />}>优先发现</ModuleTitle>
        <div className="report-finding-list">
          {analysis.priority_findings.length === 0 ? <p className="report-empty">未发现需要优先处理的问题。</p> : analysis.priority_findings.map((finding, index) => {
            const explanation = analysis.finding_explanations.find((item) => item.finding_id === finding.id);
            return (
              <article key={finding.id} className="report-finding" data-severity={finding.severity}>
                <span>{String(index + 1).padStart(2, "0")} · {finding.severity === "high" ? "高风险" : finding.severity === "medium" ? "中风险" : "提示"}</span>
                <h4>{finding.title}</h4>
                <p>{finding.summary}</p>
                {explanation ? <small>{explanation.interpretation}</small> : null}
                <EvidenceActions ids={finding.evidence_ids} viewModel={viewModel} onSelectEvidence={onSelectEvidence} />
              </article>
            );
          })}
        </div>
      </section>

      <section className="report-module">
        <ModuleTitle icon={<Link2 size={15} aria-hidden="true" />}>因果链</ModuleTitle>
        <div className="report-causal-list">
          {analysis.causal_chains.length === 0 ? <p className="report-empty">当前证据未形成额外因果链。</p> : analysis.causal_chains.map((chain) => {
            const explanation = analysis.causal_explanations.find((item) => item.causal_chain_id === chain.id);
            return (
              <article key={chain.id} className="report-causal">
                <div><span>观察</span><p>{chain.observation}</p></div>
                <ArrowRight size={14} aria-hidden="true" />
                <div><span>机制</span><p>{chain.mechanism}</p></div>
                <ArrowRight size={14} aria-hidden="true" />
                <div><span>影响</span><p>{chain.possible_impact}</p></div>
                <strong>{Math.round(chain.confidence * 100)}% 置信</strong>
                {explanation ? <small>{explanation.explanation}</small> : null}
                <EvidenceActions ids={chain.evidence_ids} viewModel={viewModel} onSelectEvidence={onSelectEvidence} />
              </article>
            );
          })}
        </div>
      </section>

      <section className="report-module">
        <ModuleTitle icon={<ListChecks size={15} aria-hidden="true" />}>行动计划</ModuleTitle>
        <ol className="report-action-list">
          {analysis.recommendations.length === 0 ? <li className="report-empty">保持现有验证流程，持续观察同类场景。</li> : analysis.recommendations.map((recommendation) => {
            const rationale = analysis.recommendation_rationales.find((item) => item.recommendation_id === recommendation.id);
            return (
              <li key={recommendation.id} data-priority={recommendation.priority}>
                <div><strong>{recommendation.action}</strong><span>{recommendation.priority === "high" ? "优先" : recommendation.priority === "medium" ? "计划" : "观察"}</span></div>
                <p>{rationale?.rationale ?? recommendation.rationale}</p>
                <EvidenceActions ids={recommendation.evidence_ids} viewModel={viewModel} onSelectEvidence={onSelectEvidence} />
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
