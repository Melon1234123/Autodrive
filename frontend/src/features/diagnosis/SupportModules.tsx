import type { ReactNode } from "react";
import type { ReportV2 } from "./contracts";

const overviewLabels: Record<string, string> = {
  description: "场景说明",
  duration_seconds: "场景时长",
  telemetry_samples: "遥测样本",
  perception_samples: "感知样本",
  lidar_available: "激光雷达",
};

function SecondaryModule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="report-support-module" data-report-secondary="true">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

function displayOverviewValue(key: string, value: unknown) {
  if (value === null || value === undefined) return "未提供";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return key.endsWith("_seconds") ? `${value.toFixed(2)} 秒` : String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} 项`;
  return "已记录";
}

export function SupportModules({ report }: { report: ReportV2 }) {
  const { support } = report;
  return (
    <div className="report-support">
      <SecondaryModule title="数据质量">
        {support.data_quality.length === 0 ? <p>数据完整性满足本次分析要求。</p> : (
          <ul>{support.data_quality.map((finding) => (
            <li key={finding.code} data-severity={finding.severity}>
              <strong>{finding.message}</strong>
              {finding.affected_modules.length > 0 ? <span>影响模块：{finding.affected_modules.join("、")}</span> : null}
            </li>
          ))}</ul>
        )}
      </SecondaryModule>
      <SecondaryModule title="回归测试">
        {support.regression_tests.length === 0 ? <p>暂无新增回归验证项。</p> : (
          <ul>{support.regression_tests.map((test) => (
            <li key={test.name}><strong>{test.name}</strong><span>{test.criterion}</span><small>{test.rationale}</small></li>
          ))}</ul>
        )}
      </SecondaryModule>
      <SecondaryModule title="场景概览">
        <dl>{Object.entries(support.scene_overview).filter(([key]) => key in overviewLabels).map(([key, value]) => (
          <div key={key}><dt>{overviewLabels[key] ?? "场景信息"}</dt><dd>{displayOverviewValue(key, value)}</dd></div>
        ))}</dl>
      </SecondaryModule>
      <SecondaryModule title="分析限制">
        {support.limitations.length === 0 ? <p>未记录额外分析限制。</p> : <ul>{support.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>}
      </SecondaryModule>
    </div>
  );
}
