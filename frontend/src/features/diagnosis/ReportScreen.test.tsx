/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReportV2 } from "./contracts";
import { reportFixture } from "./test-fixtures";
import { ReportScreen } from "./ReportScreen";

afterEach(cleanup);

function reportScreenProps(report: ReportV2 = reportFixture) {
  return {
    report,
    videoSlotRef: createRef<HTMLDivElement>(),
    onSeekEvidence: vi.fn(),
    onReturnToDiagnosis: vi.fn(),
    onRerunDiagnosis: vi.fn(),
  };
}

function reportWithMultipleEvidence(): ReportV2 {
  return {
    ...reportFixture,
    evidence: {
      ...reportFixture.evidence,
      timeline: [
        ...reportFixture.evidence.timeline,
        {
          id: "ep-0002",
          start_time: 1.25,
          end_time: 1.75,
          peak_time: 1.5,
          risk: "high",
          summary: "第二段风险事件。",
          evidence_ids: ["ev-0002"],
          control_conflict: false,
        },
        {
          id: "ep-0003",
          start_time: 1.3,
          end_time: 1.7,
          peak_time: 1.5,
          risk: "medium",
          summary: "无独立证据的风险事件。",
          evidence_ids: [],
          control_conflict: false,
        },
      ],
      index: [
        ...reportFixture.evidence.index,
        {
          id: "ev-0002",
          source: "lidar",
          provenance: "real-derived",
          start_time: 4,
          end_time: 5,
          detail: "第二条激光雷达证据。",
        },
      ],
    },
  };
}

it("renders analysis and evidence as the only primary report regions", () => {
  render(<ReportScreen {...reportScreenProps()} />);
  expect(screen.getByRole("region", { name: "诊断报告" })).toHaveAttribute("data-cockpit-screen", "report");
  expect(screen.getByRole("region", { name: "分析" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "证据" })).toBeInTheDocument();
  expect(screen.getByText("数据质量")).toBeInTheDocument();
  expect(screen.getByText("数据质量").closest("details")).toHaveAttribute("data-report-secondary", "true");
  expect(screen.getByTestId("report-video-slot")).not.toHaveAttribute("data-lenis-prevent-vertical");
});

it("uses internal IDs only for lookup, never as visible report text", () => {
  render(<ReportScreen {...reportScreenProps()} />);
  expect(screen.queryByText(/(?:ev|finding|causal)-\d{4}/)).not.toBeInTheDocument();
});

it("labels a local fallback with a safe human-readable reason", () => {
  render(<ReportScreen {...reportScreenProps()} />);
  expect(screen.getByText("模型响应超时，已切换为本地可验证分析")).toBeVisible();
  expect(screen.queryByText(/provider|deepseek|openai/i)).not.toBeInTheDocument();
});

it("seeks selected evidence and returns to screen 03 at that timestamp", () => {
  const props = reportScreenProps();
  render(<ReportScreen {...props} />);

  fireEvent.click(screen.getByRole("button", { name: "回放 1.00 秒证据" }));
  expect(props.onSeekEvidence).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByRole("button", { name: "返回 03" }));
  expect(props.onReturnToDiagnosis).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByRole("button", { name: "重新诊断" }));
  expect(props.onRerunDiagnosis).toHaveBeenCalledOnce();
});

it("selects an evidence source before seeking and returns to that evidence", () => {
  const props = reportScreenProps(reportWithMultipleEvidence());
  render(<ReportScreen {...props} />);

  fireEvent.click(screen.getByRole("button", { name: /第二条激光雷达证据/ }));

  expect(within(document.querySelector(".report-evidence-current")!).getByText("第二条激光雷达证据。")).toBeVisible();
  expect(props.onSeekEvidence).toHaveBeenCalledWith(4);
  fireEvent.click(screen.getByRole("button", { name: "返回 03" }));
  expect(props.onReturnToDiagnosis).toHaveBeenCalledWith(4);
});

it("selects the evidence explicitly linked by a timeline event even when another source overlaps its peak", () => {
  const props = reportScreenProps(reportWithMultipleEvidence());
  render(<ReportScreen {...props} />);

  fireEvent.click(screen.getByRole("button", { name: /第二段风险事件/ }));

  expect(within(document.querySelector(".report-evidence-current")!).getByText("第二条激光雷达证据。")).toBeVisible();
  expect(props.onSeekEvidence).toHaveBeenCalledWith(4);
  fireEvent.click(screen.getByRole("button", { name: "返回 03" }));
  expect(props.onReturnToDiagnosis).toHaveBeenCalledWith(4);
});

it("uses an unmatched timeline peak for return without retaining stale evidence", () => {
  const props = reportScreenProps(reportWithMultipleEvidence());
  render(<ReportScreen {...props} />);

  fireEvent.click(screen.getByRole("button", { name: /第二条激光雷达证据/ }));
  fireEvent.click(screen.getByRole("button", { name: /无独立证据的风险事件/ }));

  expect(within(document.querySelector(".report-evidence-current")!).getByText("报告未提供可回放证据。")).toBeVisible();
  expect(props.onSeekEvidence).toHaveBeenLastCalledWith(1.5);
  fireEvent.click(screen.getByRole("button", { name: "返回 03" }));
  expect(props.onReturnToDiagnosis).toHaveBeenCalledWith(1.5);
});
