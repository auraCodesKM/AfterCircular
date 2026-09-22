/** Mirrors backend/app/schemas/actions.py — keep in sync. */

export type DocumentStatus =
  | "DISCOVERED" | "EXTRACTING" | "RETRIEVING" | "ANALYZING" | "ARCHIVED" | "NEEDS_INVESTIGATION"
  | "DRAFTING" | "AWAITING_REVIEW" | "APPROVED" | "REJECTED" | "COMPLETED" | "FAILED";

export type ScanStep = { key: string; label: string; status: "pending" | "running" | "done" | "skipped" | "failed"; detail: string | null; at: string | null };

export type ScanRecord = {
  id: string; tenant_id: string; status: "RUNNING" | "COMPLETED" | "FAILED"; source_mode: "LIVE" | "DEMO_SNAPSHOT" | null;
  source_status?: "LIVE_SUCCESS" | "LIVE_NO_NEW_DOCUMENTS" | "LIVE_PARTIAL" | "LIVE_FAILED" | "DEMO_SNAPSHOT" | "DEMO_SNAPSHOT_FALLBACK" | null; source_error?: string | null;
  started_at: string; finished_at: string | null; steps: ScanStep[]; new_documents: number; skipped_documents: number;
  document_ids: string[]; error: string | null; error_kind: "repository" | "source" | "ai" | "backend" | null; error_detail: string | null;
  ai_provider: string; retrieval_backend: string;
};

export type ProcessedDocument = {
  id: string; source: string; jurisdiction: string; document_id: string; circular_number: string | null; title: string;
  published_date: string | null; effective_date: string | null; url: string; content_hash: string; document_version: number;
  processed_at: string; status: DocumentStatus; impact: string | null; analysis_id: string | null; ticket_id: string | null;
  ticket_url: string | null; source_mode: "LIVE" | "DEMO_SNAPSHOT"; synthetic?: boolean; document_url?: string | null; fetched_at?: string | null; error: string | null;
};

export type Evidence = { section: string; text: string };
export type PolicyEvidence = { doc_id: string; section: string; text: string };
export type Obligation = { requirement: string; affected_area: string; deadline: string | null; evidence: Evidence };

/** Where a cited regulation really lives (official page + PDF) and where a cited policy clause lives (exact GitHub file). Attached by code, never by a model. */
export type RegulatorySource = {
  regulator: string; source_mode: "LIVE" | "DEMO_SNAPSHOT"; synthetic: boolean; title: string; reference: string | null; published_date: string | null;
  detail_url: string; pdf_url: string | null; document_id: string; content_hash: string; fetched_at: string | null;
};
export type PolicySource = { path: string | null; url: string | null; repo: string; branch: string; fictional: boolean };

export type AnalysisRecord = {
  id: string; document_pk: string; scan_id: string | null;
  extraction: { regulator?: string; circular_number?: string | null; effective_date?: string | null; applies_to?: string[]; summary?: string; obligations?: Obligation[] };
  retrieved_chunks: { chunk_id: string; doc_id: string; title: string; path: string; version?: string | null; section: string; text: string; score: number; commit_sha?: string | null; chunk_hash?: string | null }[];
  impact: {
    applicability: "YES" | "NO" | "UNCERTAIN"; alignment: "ALIGNED" | "CONFLICT" | null; affected_policies: string[]; reason: string;
    regulatory_evidence: Evidence[]; policy_evidence: PolicyEvidence[]; effective_date: string | null; recommended_action: string | null; confidence: number;
    severity?: "administrative" | "operational" | "prohibitive" | null;
    regulatory_source?: RegulatorySource | null; policy_sources?: Record<string, PolicySource>;
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
  id: string; stage: "triage" | "extraction_check" | "applicability" | "rerank" | "alignment" | "verification" | "escalation" | "cross_check"; provider: "typesafe" | "foundry" | "stub" | "code";
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
export type UsageModel = {
  model: string; provider: string; requests: number; input_tokens: number; output_tokens: number; cached_tokens: number;
  estimated_cost_usd: number | null; avg_latency_ms: number; errors: number; retried: number; unknown_pricing_calls: number; toon_calls: number;
  pricing_status: "estimate" | "unknown";
};
export type Usage = {
  period: "today" | "all"; since: string | null; deployments: Record<string, string>; active_model: string | null; pricing: Record<string, "estimate" | "unknown">;
  models: UsageModel[]; requests: number; input_tokens: number; output_tokens: number; cached_tokens: number; estimated_cost_usd: number | null;
  avg_latency_ms: number | null; errors: number; retried: number; unknown_pricing_calls: number; toon_calls: number;
  scan: { id: string; status: string; llm_calls: number; estimated_cost_usd: number; requests?: number } | null;
  budget: { scan_limit_usd: number; daily_limit_usd: number; max_llm_calls_per_scan: number; spent_today_usd: number; daily_remaining_usd: number | null; scan_remaining_usd: number | null; note: string };
};

export type EvalReport = { judges: JudgeReport | null } & (
  | { available: false; message: string }
  | { available: true; generated_at: string; provider: string; models: string[]; scenarios: string[]; retrieval: string; warning?: string; summary: EvalSummaryRow[]; recommendation: Record<string, { model: string; quality_score: number }> }
);

export type PolicyDoc = {
  doc_id: string; title: string; path: string; version: string | null; sections: string[]; embedded: boolean;
  category?: string | null; status?: string | null; effective_date?: string | null; owner?: string | null; approver?: string | null;
  review_cycle?: string | null; topics?: string[]; applies_to?: string[]; regulator_references?: string[];
  affected_by?: { document_pk: string; title: string; circular_number: string; impact: string }[];
};
export type PolicyDetail = Omit<PolicyDoc, "sections" | "embedded" | "affected_by"> & { sections: { chunk_id: string; section: string; text: string }[] };
export type PolicyIndex = { index: { repo: string; commit_sha: string; indexed_at: string; chunk_count: number } | null; documents: PolicyDoc[] };

/** A card the agent returns for one processed circular. */
export type DocCard = {
  id?: string; document_id?: string; url?: string; gate?: string | null; confidence?: number | null; review?: { status: string; decided_by?: string | null; decided_at?: string | null; ticket_id?: string | null; ticket_url?: string | null } | null;
  document_pk: string; title: string; circular_number: string | null; source: string; published_date: string | null; effective_date: string | null;
  impact: string | null; status: DocumentStatus; source_mode: "LIVE" | "DEMO_SNAPSHOT"; synthetic?: boolean; document_url?: string | null; fetched_at?: string | null; analysis_id: string | null;
  applicability: "YES" | "NO" | "UNCERTAIN" | null; alignment: "ALIGNED" | "CONFLICT" | null; affected_policies: string[]; reason: string | null;
  severity: string | null; regulatory_evidence: Evidence[]; policy_evidence: PolicyEvidence[]; recommended_action: string | null;
  decision_path: string[]; escalation_reason: string | null; ticket_url: string | null; ticket_id: string | null;
  regulatory_source?: RegulatorySource | null; policy_sources?: Record<string, PolicySource>;
};

export type AskEvidence = { id: string; record: string; section?: string | null; text?: string; doc_id?: string; requirement?: string; area?: string };
export type AskPoint = { record_id: string; claim: string; evidence_ids: string[]; evidence: AskEvidence[] };
export type AskReasoning = {
  kind: "workspace_data" | "jev_reasoning" | "refused" | "clarify" | "web_search"; workspace?: string; sources: number; cited: string[];
  jev_route?: { provider: string; model: string; calibrated?: boolean; latency_ms?: number; input_tokens?: number | null; output_tokens?: number | null; questions?: number; note?: string; error?: string };
  jev_judgments?: { provider?: string; model?: string; calibrated?: boolean; questions?: number; latency_ms?: number; input_tokens?: number | null; output_tokens?: number | null; error?: string };
  narrative?: { provider?: string; model?: string; latency_ms?: number; input_tokens?: number | null; output_tokens?: number | null; cached_tokens?: number | null; estimated_cost_usd?: number | null; structured_mode?: string | null; context_format?: string | null; response_id?: string | null; tool?: string; allowed_domains?: string[]; error?: string } | null;
  composed?: boolean; dropped_uncited?: string[]; evidence?: { regulatory: number; policy: number; obligations: number };
  focus?: { record: string; document_id: string; title: string; analysis_id: string | null; policy_ids: string[] } | null;
};
export type Investigation = {
  id: string; question: string; intent: string; summary: string; document_pk: string | null; analysis_id: string | null; policy_id: string | null; conversation_id?: string | null;
  answer: {
    intent: string; documents?: DocCard[]; document?: DocCard; review?: ReviewRecord | null; policy?: PolicyDetail & { sections: { section: string; text: string }[] };
    policies?: PolicyDoc[]; scan?: ScanRecord | null; actions?: { label: string; kind: string }[]; suggestions?: string[];
    points?: AskPoint[]; insufficient_evidence?: boolean; caveat?: string | null; reasoning?: AskReasoning;
    web_sources?: { url: string; title: string }[]; web_dropped_off_domain?: number; trace?: Trace;
  };
  judge: { provider: string; model: string; calibrated: boolean; intent_confidence?: number; document_confidence?: number; policy_confidence?: number; note?: string; latency_ms?: number };
  actor: string; created_at: string;
};

export type DashboardSnapshot = {
  health: Health | null;
  scan: ScanRecord | null;
  documents: ProcessedDocument[];
  reviews: ReviewRecord[];
  audit: AuditEvent[];
  evals: EvalReport | null;
  backendError: string | null;
};

export type SystemStatus = {
  at: string;
  foundry: { configured: boolean; connected: boolean; endpoint_host: string | null; resource: string; project: string; api: string; auth: string; deployments: { extraction: string; impact: string; memo: string };
    requests_total: number; errors_total: number; requests_today: number; estimated_cost_today_usd: number; last_request_at: string | null; last_response_id: string | null; last_task: string | null; last_structured_mode: string | null };
  embeddings: { model: string; dimensions: number; connected: boolean; analyses_with_vector_query: number };
  search: { configured: boolean; connected?: boolean; error?: string; service: string | null; index: string | null; retrieval: string; semantic_ranker: boolean; tenant_filter: string; indexed_commit: string | null; indexed_at: string | null; chunks_recorded: number | null; analyses_retrieved: number; documents_in_index: number | null };
  jev: { configured: boolean; connected: boolean; model: string | null; role: string; decisions_total: number; decisions_today: number; last_at: string | null };
  sebi: { mode: string; live: boolean; last_live_scan_at: string | null; last_live_status: string | null; live_documents: number; last_fetch_at: string | null; curated_entry_ids: string[]; latest_scan_status: string | null };
  github: { repo: string; issues_created: number; awaiting_review: number };
};

export type TraceStep = {
  id: string; order: number; actor: "regulator" | "connector" | "deterministic" | "jev" | "foundry" | "embedding" | "azure_search" | "human" | "github";
  name: string; role: string; group: "source" | "reasoning" | "decision" | "action"; operation: string;
  status: "completed" | "skipped" | "failed" | "awaiting_approval" | "blocked"; summary: string; reason: string | null; latency_ms: number | null; at: string | null;
  telemetry: Record<string, unknown>; details: Record<string, unknown>;
};
export type Trace = {
  document_pk: string; document_id: string; title: string; tenant_id: string; analysis_id: string | null; outcome: string | null;
  summary: {
    stages: number; completed: number; skipped: number; failed: number; awaiting_approval: number; blocked: number; foundry_calls: number; jev_judgments: number; jev_decision_records: number;
    azure_search_retrievals: number; azure_search_results: number | null; deterministic_gate: number; human_pending: number;
    latency: { foundry_ms: number | null; jev_ms: number | null; azure_search_ms: number | null; embedding_ms: number | null };
    foundry_tokens: { input: number; output: number; cached: number }; estimated_cost_usd: number | null; pricing: string;
    context_comparison: { measured_calls: number; compact_json_tokens: number; as_sent_tokens: number; saved_tokens: number; saved_pct: number | null; note: string } | null;
  };
  steps: TraceStep[]; foundry_calls: number; jev_records: number; audit_events: { at: string; event: string; actor: string; actor_type: string }[];
};
