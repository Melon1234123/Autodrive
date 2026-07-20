import type { EvidenceRef, ReportV2 } from "./contracts";

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

export type ReportViewModel = {
  evidenceById: Map<string, EvidenceRef>;
  selectedEvidence: EvidenceRef | null;
  seekTime: number | null;
  selectEvidence: (id: string) => EvidenceRef | null;
  evidenceLabel: (evidence: EvidenceRef) => string;
};

export function createReportViewModel(report: ReportV2, selectedEvidenceId?: string | null): ReportViewModel {
  const evidenceById = new Map(report.evidence.index.map((evidence) => [evidence.id, evidence]));
  const selectedEvidence = selectedEvidenceId === null
    ? null
    : evidenceById.get(selectedEvidenceId ?? report.evidence.default_evidence_id ?? "")
      ?? report.evidence.index[0]
      ?? null;
  return {
    evidenceById,
    selectedEvidence,
    seekTime: selectedEvidence?.start_time ?? null,
    selectEvidence: (id) => evidenceById.get(id) ?? null,
    evidenceLabel: (evidence) => `${sourceLabels[evidence.source]} · ${provenanceLabels[evidence.provenance]}`,
  };
}
