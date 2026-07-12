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

export type DataQualityFinding = {
  code: string;
  severity: "info" | "warning" | "error";
  affected_modules: string[];
  message: string;
};

export type Finding = {
  id: string;
  title: string;
  summary: string;
  severity: "info" | "medium" | "high";
  evidence_ids: string[];
};

export type RiskEpisode = {
  id: string;
  start_time: number;
  end_time: number;
  peak_time: number;
  risk: "medium" | "high";
  summary: string;
  evidence_ids: string[];
  control_conflict: boolean;
};

export type AnalysisSection = {
  summary: string;
  metrics: Record<string, unknown>;
  evidence_ids: string[];
};

export type CausalChain = {
  observation: string;
  mechanism: string;
  possible_impact: string;
  evidence_ids: string[];
  confidence: number;
};

export type Recommendation = {
  id: string;
  priority: "low" | "medium" | "high";
  action: string;
  rationale: string;
  evidence_ids: string[];
};

export type RegressionRecommendation = {
  name: string;
  criterion: string;
  rationale: string;
};

export type DiagnosisReport = {
  schema_version: "1.0";
  scene_name: string;
  data_version: string;
  generation_mode: "local-harness" | "model-enhanced";
  executive_summary: string;
  scene_overview: Record<string, unknown>;
  data_quality: DataQualityFinding[];
  scores: RiskScores;
  key_findings: Finding[];
  timeline: RiskEpisode[];
  perception_analysis: AnalysisSection;
  motion_control_analysis: AnalysisSection;
  trajectory_analysis: AnalysisSection;
  causal_chains: CausalChain[];
  recommendations: Recommendation[];
  regression_tests: RegressionRecommendation[];
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
