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

/**
 * Timestamps are rendered in UTC with a fixed locale, on purpose: an audit trail reads the same for everyone, and the
 * server (container, UTC) and the browser (any timezone) must produce identical HTML — a locale/timezone-dependent
 * string is a hydration mismatch in a production build.
 */
const UTC = { timeZone: "UTC" } as const;

export function fmtTime(iso: string | null | undefined, withDate = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const t = d.toLocaleTimeString("en-GB", { ...UTC, hour: "2-digit", minute: "2-digit" });
  return withDate ? `${d.toLocaleDateString("en-GB", { ...UTC, month: "short", day: "numeric" })}, ${t} UTC` : `${t} UTC`;
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { ...UTC, month: "short", day: "numeric", year: "numeric" });
}

/** Truthful source readout. Demo is never described as SEBI; a live failure names its reason and says no fallback happened. */
export function sourceStatus(scan: { source_mode?: string | null; source_status?: string | null; source_error?: string | null; new_documents?: number } | null | undefined, healthMode?: string) {
  const st = scan?.source_status ?? null;
  if (st === "LIVE_SUCCESS" || st === "LIVE_PARTIAL") return { title: "Connected to SEBI", detail: `Fetched ${scan?.new_documents ?? 0} new live publication${scan?.new_documents === 1 ? "" : "s"}${st === "LIVE_PARTIAL" ? " (some could not be retrieved)" : ""}`, live: true, warn: st === "LIVE_PARTIAL" };
  if (st === "LIVE_NO_NEW_DOCUMENTS") return { title: "Connected to SEBI", detail: "No new publications since last scan", live: true, warn: false };
  if (st === "LIVE_FAILED") return { title: "SEBI connection failed", detail: `${scan?.source_error ?? "unknown reason"} · No snapshot fallback in live mode`, live: false, warn: true };
  if (st === "DEMO_SNAPSHOT_FALLBACK") return { title: "Demo snapshot (fallback)", detail: `Live SEBI fetch failed: ${scan?.source_error ?? "unknown"} — using synthetic publications`, live: false, warn: true };
  if (st === "DEMO_SNAPSHOT" || scan?.source_mode === "DEMO_SNAPSHOT" || (!scan && (healthMode === "demo_snapshot" || healthMode === "snapshot")))
    return { title: "Demo snapshot", detail: "Using synthetic regulatory publications — not SEBI data", live: false, warn: true };
  if (scan?.source_mode === "LIVE") return { title: "Connected to SEBI", detail: "Live publications from sebi.gov.in", live: true, warn: false };
  // configured ≠ connected: live mode without a completed scan is "not scanned yet", never "connected"
  return { title: healthMode === "live" ? "SEBI live mode · not scanned yet" : "Source not scanned yet", detail: healthMode === "live" ? "Official listing at sebi.gov.in is fetched on each scan; nothing has been fetched yet" : "Run a scan to fetch publications", live: false, warn: false };
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
