import { describe, expect, it } from "vitest";
import {
  decodeAnalysisWorkspace,
  decodeDiagnosisSnapshot,
  decodeEvidenceWorkspace,
  decodeGenerationMetadata,
  decodeReportMeta,
  decodeSupportWorkspace,
  type ReportV2,
} from "./contracts";
import { reportFixture, snapshotFixture } from "./test-fixtures";

function reportPayload(): ReportV2 {
  return structuredClone(reportFixture);
}

function expectInvalidReport(update: (report: ReportV2) => void) {
  const report = reportPayload();
  update(report);
  expect(() => decodeDiagnosisSnapshot(snapshotFixture({ report })))
    .toThrow("诊断任务读取失败：报告结构不合法");
}

describe("decodeDiagnosisSnapshot", () => {
  it("exports strict decoders for every public ReportV2 area", () => {
    expect(decodeGenerationMetadata(reportFixture.meta.generation)).toEqual(reportFixture.meta.generation);
    expect(decodeReportMeta(reportFixture.meta)).toEqual(reportFixture.meta);
    expect(decodeAnalysisWorkspace(reportFixture.analysis)).toEqual(reportFixture.analysis);
    expect(decodeEvidenceWorkspace(reportFixture.evidence)).toEqual(reportFixture.evidence);
    expect(decodeSupportWorkspace(reportFixture.support)).toEqual(reportFixture.support);
  });

  it("rejects a complete snapshot without a valid ReportV2", () => {
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ report: { meta: { schema_version: "2.0" } } })))
      .toThrow("诊断任务读取失败：报告结构不合法");
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ report: null })))
      .toThrow("诊断任务读取失败：报告结构不合法");
  });

  it("decodes an honestly labelled local timeout fallback", () => {
    const snapshot = decodeDiagnosisSnapshot(snapshotFixture());
    expect(snapshot.report?.meta.generation).toMatchObject({
      mode: "local-harness",
      fallback_reason: "timeout",
      attempted: true,
    });
  });

  it("rejects malformed primitives, arrays, progress, and generation metadata", () => {
    expect(() => decodeDiagnosisSnapshot([])).toThrow("响应不是对象");
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ percent: 101 }))).toThrow("percent");
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ report: { ...reportFixture, meta: { ...reportFixture.meta, generation: { ...reportFixture.meta.generation, mode: "made-up" } } } })))
      .toThrow("报告结构不合法");
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ stage: "complete", report: [reportFixture] }))).toThrow("报告结构不合法");
  });

  it("enforces terminal report semantics", () => {
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ stage: "complete", percent: 90 }))).toThrow("报告结构不合法");
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ stage: "failed", percent: 50, report: reportFixture, error: "失败" }))).toThrow("报告结构不合法");
    expect(() => decodeDiagnosisSnapshot(snapshotFixture({ stage: "cancelled", percent: 50, report: reportFixture, error: null }))).toThrow("报告结构不合法");
    expect(decodeDiagnosisSnapshot(snapshotFixture({ stage: "cancelled", percent: 50, report: null, error: null })).report).toBeNull();
  });

  it("rejects out-of-range and fractional risk scores", () => {
    expectInvalidReport((report) => { report.analysis.risk_profile.perception = 101; });
    expectInvalidReport((report) => { report.analysis.risk_profile.motion = -1; });
    expectInvalidReport((report) => { report.analysis.risk_profile.control = 12.5; });
    expectInvalidReport((report) => { report.analysis.risk_profile.trajectory = 100.5; });
    expectInvalidReport((report) => { report.analysis.risk_profile.data_quality = 101; });
    expectInvalidReport((report) => { report.analysis.risk_profile.overall = -1; });
    expectInvalidReport((report) => { report.analysis.risk_profile.confidence = 1.01; });
  });

  it("rejects an out-of-range causal confidence", () => {
    expectInvalidReport((report) => {
      report.analysis.causal_chains = [{
        id: "causal-0001",
        observation: "横向偏移增大。",
        mechanism: "目标跟踪不稳定。",
        possible_impact: "碰撞风险升高。",
        confidence: -0.01,
        evidence_ids: ["ev-0001"],
      }];
    });
  });

  it("rejects an executive summary shorter than 200 characters", () => {
    expectInvalidReport((report) => {
      report.analysis.executive_summary = "结论过短。";
    });
  });

  it("counts Unicode code points when enforcing the executive summary minimum", () => {
    expectInvalidReport((report) => {
      report.analysis.executive_summary = `${"a".repeat(198)}😀`;
    });
  });

  it("rejects an executive summary that contains an API key assignment", () => {
    expectInvalidReport((report) => {
      report.analysis.executive_summary = `${"执行结论仅覆盖当前事实。".repeat(20)} OPENAI_API_KEY=fake-secret-123456`;
    });
  });

  it("rejects common credential and extensionless asset forms", () => {
    [
      "x-api-key: fake-secret-123456",
      "sk-fakecredential123456",
      "assets/private/recording",
    ].forEach((unsafeValue) => {
      expectInvalidReport((report) => {
        report.analysis.executive_summary = `${"执行结论仅覆盖当前事实。".repeat(20)} ${unsafeValue}`;
      });
    });
  });

  it("matches backend credential case folding for a dotless i", () => {
    expectInvalidReport((report) => {
      report.analysis.executive_summary = `${"执行结论仅覆盖当前事实。".repeat(20)} apı_key=fake-secret-123456`;
    });
  });

  it("rejects dangling evidence references from every ReportV2 area", () => {
    expectInvalidReport((report) => { report.evidence.timeline[0].evidence_ids = ["ev-9999"]; });
    expectInvalidReport((report) => { report.analysis.priority_findings[0].evidence_ids = ["ev-9999"]; });
    expectInvalidReport((report) => {
      report.analysis.causal_chains = [{
        id: "causal-0001", observation: "观察", mechanism: "机制", possible_impact: "影响", confidence: 0.5, evidence_ids: ["ev-9999"],
      }];
    });
    expectInvalidReport((report) => {
      report.analysis.recommendations = [{
        id: "recommendation-0001", priority: "medium", action: "行动", rationale: "理由", evidence_ids: ["ev-9999"],
      }];
    });
    expectInvalidReport((report) => {
      report.analysis.finding_explanations = [{ finding_id: "finding-0001", interpretation: "解释", evidence_ids: ["ev-9999"] }];
    });
    expectInvalidReport((report) => {
      report.analysis.causal_explanations = [{ causal_chain_id: "causal-0001", explanation: "解释", evidence_ids: ["ev-9999"] }];
    });
    expectInvalidReport((report) => {
      report.analysis.recommendation_rationales = [{ recommendation_id: "recommendation-0001", rationale: "理由", evidence_ids: ["ev-9999"] }];
    });
    expectInvalidReport((report) => {
      report.analysis.analysis_notes = [{ title: "说明", body: "正文", evidence_ids: ["ev-9999"] }];
    });
  });

  it("rejects explanatory records whose target entity is absent", () => {
    expectInvalidReport((report) => {
      report.analysis.finding_explanations = [{ finding_id: "finding-9999", interpretation: "解释", evidence_ids: ["ev-0001"] }];
    });
    expectInvalidReport((report) => {
      report.analysis.causal_explanations = [{ causal_chain_id: "causal-9999", explanation: "解释", evidence_ids: ["ev-0001"] }];
    });
    expectInvalidReport((report) => {
      report.analysis.recommendation_rationales = [{ recommendation_id: "recommendation-9999", rationale: "理由", evidence_ids: ["ev-0001"] }];
    });
  });

  it("rejects raw scene identifiers and filesystem paths from display content", () => {
    expectInvalidReport((report) => { report.analysis.priority_findings[0].summary = "来源 scene-0099"; });
    expectInvalidReport((report) => { report.evidence.index[0].detail = "/private/raw/camera/frame.jpg"; });
  });

  it("rejects duplicate report entities and explanatory targets", () => {
    expectInvalidReport((report) => { report.evidence.index.push({ ...report.evidence.index[0] }); });
    expectInvalidReport((report) => {
      report.analysis.finding_explanations = [
        { finding_id: "finding-0001", interpretation: "解释一", evidence_ids: ["ev-0001"] },
        { finding_id: "finding-0001", interpretation: "解释二", evidence_ids: ["ev-0001"] },
      ];
    });
  });

  it("rejects report identifiers that do not match the backend contract", () => {
    expectInvalidReport((report) => { report.evidence.index[0].id = "evidence-1"; });
    expectInvalidReport((report) => { report.analysis.priority_findings[0].id = "finding-1"; });
    expectInvalidReport((report) => { report.evidence.timeline[0].id = "episode-0001"; });
  });
});
