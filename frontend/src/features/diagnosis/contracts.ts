export type DiagnosisStage =
  | "queued" | "validation" | "alignment" | "features" | "events"
  | "evidence" | "narrative" | "report" | "complete" | "failed" | "cancelled";

export type GenerationMetadata = {
  mode: "model-grounded" | "local-harness";
  model: string | null;
  attempted: boolean;
  fallback_reason: "timeout" | "unavailable" | "invalid_response" | "disabled" | null;
};

export type RiskScores = {
  perception: number | null;
  motion: number | null;
  control: number | null;
  trajectory: number | null;
  data_quality: number;
  overall: number | null;
  confidence: number;
};

export type EvidenceRef = {
  id: string;
  source: "camera" | "perception" | "lidar" | "ego_pose" | "telemetry" | "trajectory";
  provenance: "real" | "real-derived" | "estimated" | "demo-visualization";
  start_time: number;
  end_time: number;
  detail: string;
};

type EvidenceLinked = { evidence_ids: string[] };
export type Finding = EvidenceLinked & { id: string; title: string; summary: string; severity: "info" | "medium" | "high" };
export type RiskEpisode = EvidenceLinked & { id: string; start_time: number; end_time: number; peak_time: number; risk: "medium" | "high"; summary: string; control_conflict: boolean };
export type CausalChain = EvidenceLinked & { id: string; observation: string; mechanism: string; possible_impact: string; confidence: number };
export type Recommendation = EvidenceLinked & { id: string; priority: "low" | "medium" | "high"; action: string; rationale: string };
export type FindingExplanation = EvidenceLinked & { finding_id: string; interpretation: string };
export type CausalExplanation = EvidenceLinked & { causal_chain_id: string; explanation: string };
export type RecommendationRationale = EvidenceLinked & { recommendation_id: string; rationale: string };
export type AnalysisNote = EvidenceLinked & { title: string; body: string };
export type DataQualityFinding = { code: string; severity: "info" | "warning" | "error"; affected_modules: string[]; message: string };
export type RegressionRecommendation = { name: string; criterion: string; rationale: string };

export type ReportMeta = {
  schema_version: "2.0";
  scene_name: string;
  data_version: string;
  protected_facts_fingerprint: string;
  generation: GenerationMetadata;
};

export type AnalysisWorkspace = {
  executive_summary: string;
  risk_profile: RiskScores;
  priority_findings: Finding[];
  finding_explanations: FindingExplanation[];
  causal_chains: CausalChain[];
  causal_explanations: CausalExplanation[];
  recommendations: Recommendation[];
  recommendation_rationales: RecommendationRationale[];
  analysis_notes: AnalysisNote[];
};

export type EvidenceWorkspace = {
  timeline: RiskEpisode[];
  index: EvidenceRef[];
  default_evidence_id: string | null;
};

export type SupportWorkspace = {
  scene_overview: Record<string, unknown>;
  data_quality: DataQualityFinding[];
  regression_tests: RegressionRecommendation[];
  limitations: string[];
};

export type ReportV2 = {
  meta: ReportMeta;
  analysis: AnalysisWorkspace;
  evidence: EvidenceWorkspace;
  support: SupportWorkspace;
};

export type DiagnosisJobSnapshot = {
  jobId: string;
  sceneKey: string;
  dataVersion: string;
  stage: DiagnosisStage;
  percent: number;
  report: ReportV2 | null;
  error: string | null;
};

function fail(message: string): never { throw new Error(`诊断任务读取失败：${message}`); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function record(value: unknown, name: string): Record<string, unknown> { if (!isRecord(value)) fail(`${name}不是对象`); return value; }
function array(value: unknown, name: string): unknown[] { if (!Array.isArray(value)) fail(`${name}不是数组`); return value; }
function string(value: unknown, name: string): string { if (typeof value !== "string" || value.length === 0) fail(`${name}不是有效字符串`); return value; }
function number(value: unknown, name: string): number { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name}不是有效数字`); return value; }
function boolean(value: unknown, name: string): boolean { if (typeof value !== "boolean") fail(`${name}不是布尔值`); return value; }
function strings(value: unknown, name: string): string[] { return array(value, name).map((item, index) => string(item, `${name}[${index}]`)); }
function nonNegative(value: unknown, name: string): number { const parsed = number(value, name); if (parsed < 0) fail(`${name}无效`); return parsed; }
function percentage(value: unknown, name: string): number { const parsed = number(value, name); if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) fail(`${name}无效`); return parsed; }
function nullablePercentage(value: unknown, name: string): number | null { return value === null ? null : percentage(value, name); }
function confidence(value: unknown, name: string): number { const parsed = number(value, name); if (parsed < 0 || parsed > 1) fail(`${name}无效`); return parsed; }
const RAW_SCENE_ID = /scene-\d{4,}/i;
const FILESYSTEM_PATH = /(?:(?<![\w:/\\])(?:\\\\|[A-Za-z]:[\\/]|\/)(?:[^\\/\s,;，。]+[\\/])*[^\\/\s,;，。]+)|(?:(?<![\w./\\])(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]{1,16})|(?:(?<![\w./\\])(?=[A-Za-z][\w.-]*[\\/])(?:[\w.-]+[\\/]){2,}[\w.-]+)/i;
const SENSITIVE_CREDENTIAL = /\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|apikey|authorization)\s*(?:=|:)\s*(?:bearer\s+)?[^\s,;，。]+|\bsk-[a-z0-9_-]{12,}\b/;
const EVIDENCE_ID = /^ev-\d{4}$/;
const EPISODE_ID = /^ep-\d{4}$/;
const FINDING_ID = /^finding-\d{4}$/;
const CAUSAL_ID = /^causal-\d{4}$/;
const RECOMMENDATION_ID = /^recommendation-\d{4}$/;
const MIN_EXECUTIVE_SUMMARY_LENGTH = 200;

function identifier(value: unknown, name: string, pattern: RegExp): string {
  const parsed = string(value, name);
  if (!pattern.test(parsed)) fail(`${name}无效`);
  return parsed;
}
function evidenceIds(value: Record<string, unknown>): string[] {
  return array(value.evidence_ids, "evidence_ids")
    .map((item, index) => identifier(item, `evidence_ids[${index}]`, EVIDENCE_ID));
}
function credentialCaseFold(value: string): string {
  return value.replace(/[A-Z\u0130\u0131\u017F\u212A]/g, (character) => {
    if (character === "\u0130" || character === "\u0131") return "i";
    if (character === "\u017F") return "s";
    if (character === "\u212A") return "k";
    return character.toLowerCase();
  });
}
function containsUnsafeDisplayValue(value: unknown): boolean {
  if (typeof value === "string") return RAW_SCENE_ID.test(value) || FILESYSTEM_PATH.test(value) || SENSITIVE_CREDENTIAL.test(credentialCaseFold(value));
  if (Array.isArray(value)) return value.some(containsUnsafeDisplayValue);
  if (isRecord(value)) return Object.entries(value)
    .some(([key, item]) => containsUnsafeDisplayValue(key) || containsUnsafeDisplayValue(item));
  return false;
}

function readStage(value: unknown): DiagnosisStage {
  if (value === "queued" || value === "validation" || value === "alignment" || value === "features" || value === "events" || value === "evidence" || value === "narrative" || value === "report" || value === "complete" || value === "failed" || value === "cancelled") return value;
  return fail("stage无效");
}
function readGenerationMode(value: unknown): GenerationMetadata["mode"] { if (value === "model-grounded" || value === "local-harness") return value; return fail("generation.mode无效"); }
function readFallbackReason(value: unknown): NonNullable<GenerationMetadata["fallback_reason"]> { if (value === "timeout" || value === "unavailable" || value === "invalid_response" || value === "disabled") return value; return fail("generation.fallback_reason无效"); }
function readSource(value: unknown): EvidenceRef["source"] { if (value === "camera" || value === "perception" || value === "lidar" || value === "ego_pose" || value === "telemetry" || value === "trajectory") return value; return fail("evidence.source无效"); }
function readProvenance(value: unknown): EvidenceRef["provenance"] { if (value === "real" || value === "real-derived" || value === "estimated" || value === "demo-visualization") return value; return fail("evidence.provenance无效"); }
function readFindingSeverity(value: unknown): Finding["severity"] { if (value === "info" || value === "medium" || value === "high") return value; return fail("finding.severity无效"); }
function readEpisodeRisk(value: unknown): RiskEpisode["risk"] { if (value === "medium" || value === "high") return value; return fail("timeline.risk无效"); }
function readPriority(value: unknown): Recommendation["priority"] { if (value === "low" || value === "medium" || value === "high") return value; return fail("recommendation.priority无效"); }
function readDataQualitySeverity(value: unknown): DataQualityFinding["severity"] { if (value === "info" || value === "warning" || value === "error") return value; return fail("data_quality.severity无效"); }

export function decodeGenerationMetadata(value: unknown): GenerationMetadata {
  const parsed = record(value, "generation");
  const mode = readGenerationMode(parsed.mode);
  const model = parsed.model === null ? null : string(parsed.model, "generation.model");
  const attempted = boolean(parsed.attempted, "generation.attempted");
  const fallback = parsed.fallback_reason === null ? null : readFallbackReason(parsed.fallback_reason);
  if ((mode === "model-grounded" && (!model || !attempted || fallback !== null)) || (mode === "local-harness" && (fallback === null || attempted !== (fallback !== "disabled")))) fail("generation字段不诚实");
  return { mode, model, attempted, fallback_reason: fallback };
}

function decodeRiskScores(value: unknown): RiskScores {
  const parsed = record(value, "risk_profile");
  return { perception: nullablePercentage(parsed.perception, "risk_profile.perception"), motion: nullablePercentage(parsed.motion, "risk_profile.motion"), control: nullablePercentage(parsed.control, "risk_profile.control"), trajectory: nullablePercentage(parsed.trajectory, "risk_profile.trajectory"), data_quality: percentage(parsed.data_quality, "risk_profile.data_quality"), overall: nullablePercentage(parsed.overall, "risk_profile.overall"), confidence: confidence(parsed.confidence, "risk_profile.confidence") };
}

function decodeEvidence(value: unknown): EvidenceRef {
  const parsed = record(value, "evidence");
  const start = nonNegative(parsed.start_time, "evidence.start_time");
  const end = nonNegative(parsed.end_time, "evidence.end_time");
  if (end < start) fail("evidence时间范围无效");
  return { id: identifier(parsed.id, "evidence.id", EVIDENCE_ID), source: readSource(parsed.source), provenance: readProvenance(parsed.provenance), start_time: start, end_time: end, detail: string(parsed.detail, "evidence.detail") };
}

function decodeFinding(value: unknown): Finding { const p = record(value, "finding"); return { id: identifier(p.id, "finding.id", FINDING_ID), title: string(p.title, "finding.title"), summary: string(p.summary, "finding.summary"), severity: readFindingSeverity(p.severity), evidence_ids: evidenceIds(p) }; }
function decodeEpisode(value: unknown): RiskEpisode { const p = record(value, "timeline"); const start = nonNegative(p.start_time, "timeline.start_time"); const end = nonNegative(p.end_time, "timeline.end_time"); const peak = nonNegative(p.peak_time, "timeline.peak_time"); if (end < start || peak < start || peak > end) fail("timeline时间范围无效"); return { id: identifier(p.id, "timeline.id", EPISODE_ID), start_time: start, end_time: end, peak_time: peak, risk: readEpisodeRisk(p.risk), summary: string(p.summary, "timeline.summary"), evidence_ids: evidenceIds(p), control_conflict: boolean(p.control_conflict, "timeline.control_conflict") }; }
function decodeCausal(value: unknown): CausalChain { const p = record(value, "causal_chain"); return { id: identifier(p.id, "causal_chain.id", CAUSAL_ID), observation: string(p.observation, "causal_chain.observation"), mechanism: string(p.mechanism, "causal_chain.mechanism"), possible_impact: string(p.possible_impact, "causal_chain.possible_impact"), evidence_ids: evidenceIds(p), confidence: confidence(p.confidence, "causal_chain.confidence") }; }
function decodeRecommendation(value: unknown): Recommendation { const p = record(value, "recommendation"); return { id: identifier(p.id, "recommendation.id", RECOMMENDATION_ID), priority: readPriority(p.priority), action: string(p.action, "recommendation.action"), rationale: string(p.rationale, "recommendation.rationale"), evidence_ids: evidenceIds(p) }; }
function decodeFindingExplanation(value: unknown): FindingExplanation { const p = record(value, "finding_explanation"); return { finding_id: identifier(p.finding_id, "finding_explanation.finding_id", FINDING_ID), interpretation: string(p.interpretation, "finding_explanation.interpretation"), evidence_ids: evidenceIds(p) }; }
function decodeCausalExplanation(value: unknown): CausalExplanation { const p = record(value, "causal_explanation"); return { causal_chain_id: identifier(p.causal_chain_id, "causal_explanation.causal_chain_id", CAUSAL_ID), explanation: string(p.explanation, "causal_explanation.explanation"), evidence_ids: evidenceIds(p) }; }
function decodeRecommendationRationale(value: unknown): RecommendationRationale { const p = record(value, "recommendation_rationale"); return { recommendation_id: identifier(p.recommendation_id, "recommendation_rationale.recommendation_id", RECOMMENDATION_ID), rationale: string(p.rationale, "recommendation_rationale.rationale"), evidence_ids: evidenceIds(p) }; }
function decodeAnalysisNote(value: unknown): AnalysisNote { const p = record(value, "analysis_note"); return { title: string(p.title, "analysis_note.title"), body: string(p.body, "analysis_note.body"), evidence_ids: evidenceIds(p) }; }
function decodeDataQuality(value: unknown): DataQualityFinding { const p = record(value, "data_quality"); return { code: string(p.code, "data_quality.code"), severity: readDataQualitySeverity(p.severity), affected_modules: strings(p.affected_modules, "data_quality.affected_modules"), message: string(p.message, "data_quality.message") }; }
function decodeRegression(value: unknown): RegressionRecommendation { const p = record(value, "regression_test"); return { name: string(p.name, "regression_test.name"), criterion: string(p.criterion, "regression_test.criterion"), rationale: string(p.rationale, "regression_test.rationale") }; }
function decodedArray<T>(value: unknown, name: string, decoder: (item: unknown) => T): T[] { return array(value, name).map(decoder); }

export function decodeReportMeta(value: unknown): ReportMeta {
  const meta = record(value, "meta");
  const fingerprint = string(meta.protected_facts_fingerprint, "protected_facts_fingerprint");
  if (meta.schema_version !== "2.0" || !/^[0-9a-f]{64}$/.test(fingerprint)) fail("报告结构不合法");
  return {
    schema_version: "2.0",
    scene_name: string(meta.scene_name, "meta.scene_name"),
    data_version: string(meta.data_version, "meta.data_version"),
    protected_facts_fingerprint: fingerprint,
    generation: decodeGenerationMetadata(meta.generation),
  };
}

export function decodeAnalysisWorkspace(value: unknown): AnalysisWorkspace {
  const analysis = record(value, "analysis");
  const executiveSummary = string(analysis.executive_summary, "analysis.executive_summary");
  if (Array.from(executiveSummary).length < MIN_EXECUTIVE_SUMMARY_LENGTH) fail("analysis.executive_summary长度不足");
  return {
    executive_summary: executiveSummary,
    risk_profile: decodeRiskScores(analysis.risk_profile),
    priority_findings: decodedArray(analysis.priority_findings, "analysis.priority_findings", decodeFinding),
    finding_explanations: decodedArray(analysis.finding_explanations, "analysis.finding_explanations", decodeFindingExplanation),
    causal_chains: decodedArray(analysis.causal_chains, "analysis.causal_chains", decodeCausal),
    causal_explanations: decodedArray(analysis.causal_explanations, "analysis.causal_explanations", decodeCausalExplanation),
    recommendations: decodedArray(analysis.recommendations, "analysis.recommendations", decodeRecommendation),
    recommendation_rationales: decodedArray(analysis.recommendation_rationales, "analysis.recommendation_rationales", decodeRecommendationRationale),
    analysis_notes: decodedArray(analysis.analysis_notes, "analysis.analysis_notes", decodeAnalysisNote),
  };
}

export function decodeEvidenceWorkspace(value: unknown): EvidenceWorkspace {
  const evidence = record(value, "evidence");
  const index = decodedArray(evidence.index, "evidence.index", decodeEvidence);
  const defaultId = evidence.default_evidence_id === null ? null : string(evidence.default_evidence_id, "evidence.default_evidence_id");
  if (defaultId !== null && !index.some((item) => item.id === defaultId)) fail("报告结构不合法");
  return {
    timeline: decodedArray(evidence.timeline, "evidence.timeline", decodeEpisode),
    index,
    default_evidence_id: defaultId,
  };
}

export function decodeSupportWorkspace(value: unknown): SupportWorkspace {
  const support = record(value, "support");
  const overview = record(support.scene_overview, "support.scene_overview");
  return {
    scene_overview: { ...overview },
    data_quality: decodedArray(support.data_quality, "support.data_quality", decodeDataQuality),
    regression_tests: decodedArray(support.regression_tests, "support.regression_tests", decodeRegression),
    limitations: strings(support.limitations, "support.limitations"),
  };
}

function ensureKnownReferences(references: string[], known: Set<string>) {
  if (references.some((reference) => !known.has(reference))) fail("报告结构不合法");
}

function ensureUniqueIdentifiers(identifiers: string[]) {
  if (identifiers.length !== new Set(identifiers).size) fail("报告结构不合法");
}

function validateReportReferences(analysis: AnalysisWorkspace, evidence: EvidenceWorkspace) {
  const evidenceIndexIds = evidence.index.map((item) => item.id);
  const findingIds = analysis.priority_findings.map((item) => item.id);
  const causalIds = analysis.causal_chains.map((item) => item.id);
  const recommendationIds = analysis.recommendations.map((item) => item.id);
  ensureUniqueIdentifiers(evidenceIndexIds);
  ensureUniqueIdentifiers(findingIds);
  ensureUniqueIdentifiers(causalIds);
  ensureUniqueIdentifiers(recommendationIds);
  const evidenceIds = new Set(evidenceIndexIds);
  const evidenceLinked: Array<{ evidence_ids: string[] }> = [
    ...evidence.timeline,
    ...analysis.priority_findings,
    ...analysis.causal_chains,
    ...analysis.recommendations,
    ...analysis.finding_explanations,
    ...analysis.causal_explanations,
    ...analysis.recommendation_rationales,
    ...analysis.analysis_notes,
  ];
  evidenceLinked.forEach((item) => ensureKnownReferences(item.evidence_ids, evidenceIds));

  ensureKnownReferences(
    analysis.finding_explanations.map((item) => item.finding_id),
    new Set(findingIds),
  );
  ensureKnownReferences(
    analysis.causal_explanations.map((item) => item.causal_chain_id),
    new Set(causalIds),
  );
  ensureKnownReferences(
    analysis.recommendation_rationales.map((item) => item.recommendation_id),
    new Set(recommendationIds),
  );
  ensureUniqueIdentifiers(analysis.finding_explanations.map((item) => item.finding_id));
  ensureUniqueIdentifiers(analysis.causal_explanations.map((item) => item.causal_chain_id));
  ensureUniqueIdentifiers(analysis.recommendation_rationales.map((item) => item.recommendation_id));
}

export function decodeReportV2(value: unknown): ReportV2 {
  try {
    const parsed = record(value, "报告");
    const analysis = decodeAnalysisWorkspace(parsed.analysis);
    const evidence = decodeEvidenceWorkspace(parsed.evidence);
    validateReportReferences(analysis, evidence);
    const report = {
      meta: decodeReportMeta(parsed.meta),
      analysis,
      evidence,
      support: decodeSupportWorkspace(parsed.support),
    };
    if (containsUnsafeDisplayValue(report)) fail("报告结构不合法");
    return report;
  } catch {
    throw new Error("诊断任务读取失败：报告结构不合法");
  }
}

export function decodeDiagnosisSnapshot(payload: unknown): DiagnosisJobSnapshot {
  const value = record(payload, "响应");
  const stage = readStage(value.stage);
  const percent = number(value.percent, "percent");
  if (percent < 0 || percent > 100) fail("percent无效");
  const report = value.report === null ? null : decodeReportV2(value.report);
  const error = value.error === null ? null : string(value.error, "error");
  if ((stage === "complete" && (report === null || percent !== 100)) || ((stage === "failed" || stage === "cancelled") && report !== null)) fail("报告结构不合法");
  return { jobId: string(value.jobId, "jobId"), sceneKey: string(value.sceneKey, "sceneKey"), dataVersion: string(value.dataVersion, "dataVersion"), stage, percent, report, error };
}
