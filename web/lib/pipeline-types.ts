/** Mirrors backend/app/schemas/actions.py — keep in sync. */

export type DocumentStatus =
  | "DISCOVERED" | "EXTRACTING" | "RETRIEVING" | "ANALYZING" | "ARCHIVED" | "NEEDS_INVESTIGATION"
  | "DRAFTING" | "AWAITING_REVIEW" | "APPROVED" | "REJECTED" | "COMPLETED" | "FAILED";

export type ScanStep = { key: string; label: string; status: "pending" | "running" | "done" | "skipped" | "failed"; detail: string | null; at: string | null };

export type ScanRecord = {
  id: string; tenant_id: string; status: "RUNNING" | "COMPLETED" | "FAILED"; source_mode: "LIVE" | "DEMO_SNAPSHOT" | null;
  started_at: string; finished_at: string | null; steps: ScanStep[]; new_documents: number; skipped_documents: number;
  document_ids: string[]; error: string | null; ai_provider: string; retrieval_backend: string;
};

export type ProcessedDocument = {
  id: string; source: string; jurisdiction: string; document_id: string; circular_number: string | null; title: string;
  published_date: string | null; effective_date: string | null; url: string; content_hash: string; document_version: number;
  processed_at: string; status: DocumentStatus; impact: string | null; analysis_id: string | null; ticket_id: string | null;
  ticket_url: string | null; source_mode: "LIVE" | "DEMO_SNAPSHOT"; error: string | null;
};

export type Evidence = { section: string; text: string };
export type PolicyEvidence = { doc_id: string; section: string; text: string };
export type Obligation = { requirement: string; affected_area: string; deadline: string | null; evidence: Evidence };

export type AnalysisRecord = {
  id: string; document_pk: string; scan_id: string | null;
  extraction: { regulator?: string; circular_number?: string | null; effective_date?: string | null; applies_to?: string[]; summary?: string; obligations?: Obligation[] };
  retrieved_chunks: { chunk_id: string; doc_id: string; title: string; section: string; text: string; score: number }[];
  impact: {
    applicability: "YES" | "NO" | "UNCERTAIN"; alignment: "ALIGNED" | "CONFLICT" | null; affected_policies: string[]; reason: string;
    regulatory_evidence: Evidence[]; policy_evidence: PolicyEvidence[]; effective_date: string | null; recommended_action: string | null; confidence: number;
    severity?: "administrative" | "operational" | "prohibitive" | null;
  } | null;
  gate_outcome: string | null;
  memo: { regulatory_change: string; current_policy: string; identified_gap: string; proposed_amendment: string; effective_date: string; recommended_action: string; evidence: string[]; disclaimer: string } | null;
  ai_provider: string; models: Record<string, string>;
  metrics: Record<string, { model?: string; latency_ms?: number; input_tokens?: number | null; output_tokens?: number | null; reason?: string; full_analysis?: boolean; backend?: string; count?: number; judges?: string[]; records?: number }>;
  decision_path: string[];
  escalation_reason: string | null;
  created_at: string;
};

export type DecisionAnswer = { type: "noul" | "choice" | "score"; noul?: number | null; choice?: string | null; score?: number | null; probabilities?: Record<string, number> | null; confidence?: number | null };
export type DecisionRecord = {
  id: string; stage: "extraction_check" | "applicability" | "rerank" | "alignment" | "verification" | "escalation"; provider: "typesafe" | "foundry" | "stub" | "code";
  model: string; calibrated: boolean | null; question_ids: string[]; state_digest: string; evidence_ids: string[]; answers: Record<string, DecisionAnswer>;
  routing: Record<string, unknown>; latency_ms: number; input_tokens: number | null; output_tokens: number | null; created_at: string;
};

export type ReviewRecord = {
  id: string; document_pk: string; analysis_id: string; status: "AWAITING_REVIEW" | "APPROVED" | "REJECTED"; requested_at: string;
  decided_at: string | null; decided_by: string | null; note: string | null; ticket_id: string | null; ticket_url: string | null;
};

export type AuditEvent = {
  id: string; timestamp: string; actor: string; actor_type: "agent" | "human" | "system"; event_type: string;
  document_pk: string | null; analysis_id: string | null; scan_id: string | null; metadata: Record<string, unknown>;
};

export type Health = {
  ok: boolean; ai_provider: "foundry" | "stub"; retrieval: string; sebi_mode: string; models: Record<string, string>;
  judge?: { default: "typesafe" | "foundry" | "stub"; model: string; typesafe_configured: boolean; routes: Record<string, string> };
};

export type EvalSummaryRow = {
  model: string; task: string; runs: number; quality_score: number; json_valid_rate: number; evidence_accuracy: number | null;
  latency_ms_median: number | null; input_tokens: number | null; output_tokens: number | null; estimated_cost_total: number | null; errors: number;
};
export type JudgeSummaryRow = {
  judge: string; models: string[]; calibrated: boolean; cases: number; applicability_accuracy: number | null; alignment_accuracy: number | null;
  affected_accuracy: number | null; evidence_verbatim_rate: number | null; rerank_hit_rate: number | null; escalation_rate: number | null; brier_mean: number | null;
  requests_per_case: number | null; input_tokens_per_case: number | null; latency_ms_per_case: number | null; estimated_cost_per_case: number | null;
};
export type JudgeReport = { generated_at: string; scenarios: string[]; thresholds: Record<string, number>; summary: JudgeSummaryRow[]; note?: string };
export type EvalReport = { judges: JudgeReport | null } & (
  | { available: false; message: string }
  | { available: true; generated_at: string; provider: string; models: string[]; scenarios: string[]; retrieval: string; warning?: string; summary: EvalSummaryRow[]; recommendation: Record<string, { model: string; quality_score: number }> }
);

export type DashboardSnapshot = {
  health: Health | null;
  scan: ScanRecord | null;
  documents: ProcessedDocument[];
  reviews: ReviewRecord[];
  audit: AuditEvent[];
  evals: EvalReport | null;
  backendError: string | null;
};
