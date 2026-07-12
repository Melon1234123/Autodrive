export type CockpitScreen = "entry" | "live" | "diagnosis";

export type VideoGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
};

export type SceneManifestEntry = {
  id: string;
  label: string;
  description?: string;
  videoFile: string;
  telemetryFile: string;
  perceptionFile: string;
  metadataFile?: string;
  lidarIndexFile?: string;
  riskEventsFile?: string;
};

export type EvidenceRef = {
  id: string;
  source: "camera" | "perception" | "lidar" | "ego_pose" | "telemetry" | "trajectory";
  provenance: "real" | "real-derived" | "estimated" | "demo-visualization";
  start_time: number;
  end_time: number;
  detail: string;
};

export type RiskScores = {
  perception: number;
  motion: number;
  control: number;
  trajectory: number;
  data_quality: number;
  overall: number;
  confidence: number;
};

export type DiagnosisReport = {
  schema_version: "1.0";
  scene_name: string;
  data_version: string;
  generation_mode: "local-harness" | "model-enhanced";
  executive_summary: string;
  scene_overview: Record<string, unknown>;
  data_quality: Array<Record<string, unknown>>;
  scores: RiskScores;
  key_findings: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  perception_analysis: Record<string, unknown>;
  motion_control_analysis: Record<string, unknown>;
  trajectory_analysis: Record<string, unknown>;
  causal_chains: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  regression_tests: Array<Record<string, unknown>>;
  evidence_index: EvidenceRef[];
  limitations: string[];
};

export type DiagnosisStage =
  | "queued"
  | "validation"
  | "timeline"
  | "features"
  | "events"
  | "causality"
  | "report"
  | "enhancement"
  | "complete"
  | "failed";

export type DiagnosisJobSnapshot = {
  jobId: string;
  sceneKey: string;
  dataVersion: string;
  stage: DiagnosisStage;
  percent: number;
  report: DiagnosisReport | null;
  error: string | null;
};
