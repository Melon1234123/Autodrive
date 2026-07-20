import { describe, expect, it } from "vitest";
import { createReportViewModel } from "./report-view-model";
import { reportFixture } from "./test-fixtures";

describe("createReportViewModel", () => {
  it("maps each evidence id once and exposes a safe default selection", () => {
    const viewModel = createReportViewModel(reportFixture);
    expect(viewModel.evidenceById).toBeInstanceOf(Map);
    expect(viewModel.selectedEvidence?.id).toBe("ev-0001");
    expect(viewModel.seekTime).toBe(1);
    expect(viewModel.evidenceLabel(viewModel.selectedEvidence!)).toContain("相机");
  });

  it("does not select unknown evidence ids or change report facts", () => {
    const viewModel = createReportViewModel(reportFixture, "not-found");
    expect(viewModel.selectedEvidence?.id).toBe("ev-0001");
    expect(viewModel.selectEvidence("not-found")).toBeNull();
    expect(reportFixture.evidence.default_evidence_id).toBe("ev-0001");
  });
});
