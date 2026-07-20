import type { ReportV2 } from "./contracts";

export const reportFixture = {
  meta: {
    schema_version: "2.0",
    scene_name: "城市路口侧向超车",
    data_version: "test-v2",
    protected_facts_fingerprint: "a".repeat(64),
    generation: {
      mode: "local-harness",
      model: null,
      attempted: true,
      fallback_reason: "timeout",
    },
  },
  analysis: {
    executive_summary: [
      "本地分析已完成，当前结论由风险评分、事件时间线、优先发现、因果链和证据索引共同支持。",
      "执行时应先复核高优先级事件对应的传感器、轨迹与控制记录，确认时间对齐、事件窗口和证据来源没有偏差，再依据行动建议安排针对性的回归验证。",
      "报告仅覆盖已经采集、完成对齐并进入证据索引的场景数据，不对未进入证据范围的模态、道路条件、交通参与者状态或后续运行表现作外推。",
      "如现场复核结果与当前证据链不一致，应重新诊断、补充缺失数据并更新回归闭环；本结论用于问题定位与执行排序，不替代道路安全认证或最终准入判断。",
    ].join(""),
    risk_profile: {
      perception: 20,
      motion: 10,
      control: 5,
      trajectory: 10,
      data_quality: 100,
      overall: 13,
      confidence: 1,
    },
    priority_findings: [{ id: "finding-0001", title: "跟踪波动", summary: "目标跟踪存在短暂波动。", severity: "medium", evidence_ids: ["ev-0001"] }],
    finding_explanations: [],
    causal_chains: [],
    causal_explanations: [],
    recommendations: [],
    recommendation_rationales: [],
    analysis_notes: [],
  },
  evidence: {
    timeline: [{ id: "ep-0001", start_time: 1, end_time: 2, peak_time: 1.5, risk: "medium", summary: "短暂风险。", evidence_ids: ["ev-0001"], control_conflict: false }],
    index: [{ id: "ev-0001", source: "camera", provenance: "real", start_time: 1, end_time: 2, detail: "前视相机证据。" }],
    default_evidence_id: "ev-0001",
  },
  support: {
    scene_overview: { duration_seconds: 10 },
    data_quality: [],
    regression_tests: [],
    limitations: [],
  },
} satisfies ReportV2;

export function snapshotFixture(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    sceneKey: "default",
    dataVersion: "test-v2",
    stage: "complete",
    percent: 100,
    report: reportFixture,
    error: null,
    ...overrides,
  };
}
