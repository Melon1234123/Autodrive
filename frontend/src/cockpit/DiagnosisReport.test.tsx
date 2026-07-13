// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiagnosisReportView } from "./DiagnosisReport";
import type { DiagnosisReport } from "./types";

const reportFixture = {
  schema_version: "1.0",
  scene_name: "城市路口侧向超车",
  data_version: "test-v1",
  generation_mode: "local-harness",
  executive_summary: "检出一个需要复盘的持续风险事件。",
  scene_overview: {
    description: "车辆接近路口时发生侧向交互。",
    duration_seconds: 24.5,
    lidar_available: true,
  },
  data_quality: [{
    code: "sparse-lidar",
    severity: "warning",
    affected_modules: ["激光雷达", "轨迹"],
    message: "部分时间段点云稀疏。",
  }],
  scores: {
    perception: 68,
    motion: 72,
    control: 80,
    trajectory: 61,
    data_quality: 87,
    overall: 74,
    confidence: 0.86,
  },
  key_findings: [{
    id: "finding-0001",
    title: "制动响应偏晚",
    summary: "风险目标出现后制动建立存在延迟。",
    severity: "high",
    evidence_ids: ["ev-0001"],
  }],
  timeline: [{
    id: "ep-0001",
    start_time: 11.6,
    end_time: 13.2,
    peak_time: 12.48,
    risk: "high",
    summary: "横向目标与自车轨迹接近。",
    evidence_ids: ["ev-0001"],
    control_conflict: true,
  }],
  historical_risk_events: [{
    id: "ep-0001",
    start_time: 11.6,
    end_time: 13.2,
    peak_time: 12.48,
    risk: "high",
    summary: "已完成场景中的横向交互风险。",
    evidence_ids: ["ev-0001"],
    control_conflict: true,
  }],
  perception_analysis: {
    summary: "目标跟踪连续性下降。",
    metrics: { tracking_continuity: 0.78 },
    evidence_ids: ["ev-0001"],
  },
  motion_control_analysis: {
    summary: "制动与油门出现短时重叠。",
    metrics: { control_conflict_seconds: 0.42 },
    evidence_ids: ["ev-0001"],
  },
  trajectory_analysis: {
    summary: "计划轨迹出现横向偏移。",
    metrics: { demo_path_lateral_deviation: 0.36 },
    evidence_ids: ["ev-0001"],
  },
  causal_chains: [{
    observation: "横向目标接近计划轨迹。",
    mechanism: "跟踪连续性下降导致响应滞后。",
    possible_impact: "安全裕度收窄。",
    evidence_ids: ["ev-0001"],
    confidence: 0.84,
  }],
  recommendations: [{
    id: "recommendation-0001",
    priority: "high",
    action: "提高横向切入目标的跟踪刷新频率。",
    rationale: "缩短风险确认到控制响应的时间。",
    evidence_ids: ["ev-0001"],
  }],
  regression_tests: [{
    name: "横向切入制动响应",
    criterion: "风险确认后 0.3 秒内建立制动。",
    rationale: "验证优化后的响应时延。",
  }],
  evidence_index: [{
    id: "ev-0001",
    source: "telemetry",
    provenance: "real-derived",
    start_time: 12.48,
    end_time: 12.82,
    detail: "制动与油门重叠窗口。",
  }],
  limitations: ["点云稀疏时段的空间结论置信度有限。"],
} satisfies DiagnosisReport;

afterEach(cleanup);

it("renders every standard report section in Chinese", () => {
  render(<DiagnosisReportView report={reportFixture} onSeekEvidence={vi.fn()} />);

  [
    "执行摘要",
    "场景概览",
    "数据质量",
    "风险评分",
    "关键发现",
    "历史风险事件",
    "风险时间线",
    "感知分析",
    "运动与控制分析",
    "轨迹分析",
    "因果链",
    "优化建议",
    "回归测试",
    "证据索引",
    "分析限制",
  ].forEach((name) => expect(screen.getByRole("heading", { name })).toBeInTheDocument());
  expect(screen.getByText("制动响应偏晚")).toBeInTheDocument();
  expect(screen.getByText("部分时间段点云稀疏。")).toBeInTheDocument();
  expect(screen.getByText("提高横向切入目标的跟踪刷新频率。")).toBeInTheDocument();
});

it("seeks from a historical risk event without exposing episode ids", () => {
  const onSeek = vi.fn();
  const { container } = render(
    <DiagnosisReportView report={reportFixture} onSeekEvidence={onSeek} />,
  );
  const section = screen.getByRole("region", { name: "历史风险事件" });

  fireEvent.click(within(section).getByRole("button", { name: /峰值 12\.48 秒/ }));

  expect(onSeek).toHaveBeenCalledWith(12.48);
  expect(section).toHaveTextContent("已完成场景中的横向交互风险。");
  expect(container).not.toHaveTextContent("ep-0001");
});

it("seeks evidence time without exposing internal identifiers", () => {
  const onSeek = vi.fn();
  const { container } = render(<DiagnosisReportView report={reportFixture} onSeekEvidence={onSeek} />);
  const evidenceSection = screen.getByRole("region", { name: "证据索引" });

  fireEvent.click(within(evidenceSection).getByRole("button", { name: /12\.48 秒/ }));

  expect(onSeek).toHaveBeenCalledWith(12.48);
  expect(container).not.toHaveTextContent("finding-0001");
  expect(container).not.toHaveTextContent("ev-0001");
  expect(container).not.toHaveTextContent("recommendation-0001");
  expect(container).not.toHaveTextContent("internal-scene");
});

it("renders unavailable degraded score axes as 不可评估", () => {
  render(<DiagnosisReportView report={{
    ...reportFixture,
    scores: {
      perception: null,
      motion: 18,
      control: 7,
      trajectory: null,
      data_quality: 70,
      overall: null,
      confidence: 0.35,
    },
  }} onSeekEvidence={vi.fn()} />);

  const scores = screen.getByRole("region", { name: "风险评分" });
  expect(within(scores).getAllByText("不可评估")).toHaveLength(3);
  expect(within(scores).getByText("18")).toBeInTheDocument();
  expect(within(scores).getByText("35%")).toBeInTheDocument();
});
