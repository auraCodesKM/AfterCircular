import type { DocumentStatus } from "@/lib/pipeline-types";

export const statusLabel: Record<DocumentStatus, string> = {
  DISCOVERED: "Discovered", EXTRACTING: "Extracting", RETRIEVING: "Retrieving", ANALYZING: "Analyzing", ARCHIVED: "Archived",
  NEEDS_INVESTIGATION: "Needs investigation", DRAFTING: "Drafting memo", AWAITING_REVIEW: "Needs review", APPROVED: "Approved",
  REJECTED: "Rejected", COMPLETED: "Ticket created", FAILED: "Failed",
};

export const eventLabel: Record<string, string> = {
  SCAN_STARTED: "Scan started", SCAN_COMPLETED: "Scan completed", SCAN_FAILED: "Scan failed", DOCUMENT_DETECTED: "Document detected",
  DOCUMENT_SKIPPED: "Already processed — skipped", DOCUMENT_VERSION_DETECTED: "New version detected", OBLIGATIONS_EXTRACTED: "Obligations extracted",
  POLICIES_INDEXED: "Policies indexed", POLICIES_RETRIEVED: "Policies retrieved", IMPACT_ANALYZED: "Impact analysis completed", ARCHIVED: "Archived",
  CONFLICT_DETECTED: "Conflict identified", NEEDS_INVESTIGATION: "Routed to human — uncertain", MEMO_GENERATED: "Memo drafted",
  REVIEW_REQUESTED: "Human approval requested", APPROVED: "Human approval granted", REJECTED: "Rejected by reviewer", TICKET_CREATED: "GitHub issue created", PIPELINE_FAILED: "Pipeline failed", BUDGET_EXCEEDED: "Stopped at the spend budget",
};

export type ImpactKind = "conflict" | "aligned" | "na" | "uncertain" | "failed" | "pending";

export function impactKind(impact: string | null, status: DocumentStatus): ImpactKind {
  if (status === "FAILED") return "failed";
  if (impact === "CONFLICT") return "conflict";
  if (impact === "ALIGNED") return "aligned";
  if (impact === "NOT_APPLICABLE") return "na";
  if (impact === "UNCERTAIN" || status === "NEEDS_INVESTIGATION") return "uncertain";
  return "pending";
}

/** Kind for a document that has an analysis: prefer the analysis result over the document's cached impact. */
export function analysisKind(doc: { impact: string | null; status: DocumentStatus }, impact: { applicability: string; alignment: string | null } | null): ImpactKind {
  if (!impact) return impactKind(doc.impact, doc.status);
  if (impact.applicability === "YES") return impact.alignment === "CONFLICT" ? "conflict" : impact.alignment === "ALIGNED" ? "aligned" : "uncertain";
  return impact.applicability === "NO" ? "na" : "uncertain";
}

export const impactLabel: Record<ImpactKind, string> = { conflict: "Conflict", aligned: "Aligned", na: "Not applicable", uncertain: "Uncertain", failed: "Failed", pending: "Pending" };

export function fmtTime(iso: string | null | undefined, withDate = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  return withDate ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "12s", "5m", "3h", "2d" — relative to now; falls back to the date past a week. */
export function relTime(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return fmtDate(iso);
}
