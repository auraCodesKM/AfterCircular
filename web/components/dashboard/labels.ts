import type { DocumentStatus } from "@/lib/pipeline-types";

export const statusLabel: Record<DocumentStatus, string> = {
  DISCOVERED: "Discovered", EXTRACTING: "Extracting", RETRIEVING: "Retrieving", ANALYZING: "Analyzing", ARCHIVED: "Archived",
  NEEDS_INVESTIGATION: "Needs investigation", DRAFTING: "Drafting memo", AWAITING_REVIEW: "Awaiting review", APPROVED: "Approved",
  REJECTED: "Rejected", COMPLETED: "Ticket created", FAILED: "Failed",
};

export const eventLabel: Record<string, string> = {
  SCAN_STARTED: "Scan started", SCAN_COMPLETED: "Scan completed", SCAN_FAILED: "Scan failed", DOCUMENT_DETECTED: "Document detected",
  DOCUMENT_SKIPPED: "Already processed — skipped", DOCUMENT_VERSION_DETECTED: "New version detected", OBLIGATIONS_EXTRACTED: "Obligations extracted",
  POLICIES_INDEXED: "Policies indexed", POLICIES_RETRIEVED: "Policies retrieved", IMPACT_ANALYZED: "Impact analyzed", ARCHIVED: "Archived",
  CONFLICT_DETECTED: "Conflict identified", NEEDS_INVESTIGATION: "Routed to human — uncertain", MEMO_GENERATED: "Memo drafted",
  REVIEW_REQUESTED: "Awaiting approval", APPROVED: "Approved", REJECTED: "Rejected", TICKET_CREATED: "GitHub issue created", PIPELINE_FAILED: "Pipeline failed",
};

export function impactTone(impact: string | null, status: DocumentStatus): "conflict" | "aligned" | "neutral" | "warn" | "fail" {
  if (status === "FAILED") return "fail";
  if (impact === "CONFLICT") return "conflict";
  if (impact === "ALIGNED") return "aligned";
  if (impact === "UNCERTAIN" || status === "NEEDS_INVESTIGATION") return "warn";
  return "neutral";
}

export const toneClass: Record<ReturnType<typeof impactTone>, string> = {
  conflict: "bg-accent text-white border-transparent",
  aligned: "bg-ink text-paper border-transparent",
  neutral: "bg-paper-2 text-ink-2 border-line",
  warn: "bg-amber/25 text-ink border-amber/50",
  fail: "bg-accent/15 text-accent border-accent/30",
};

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
