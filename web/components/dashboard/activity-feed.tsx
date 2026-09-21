import { Activity as ActivityIcon, AlertTriangle, Bot, CheckCircle2, FileText, GitPullRequest, Search, ShieldCheck, User, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./empty-state";
import { eventLabel, fmtTime } from "./labels";
import type { AuditEvent } from "@/lib/pipeline-types";

const icon: Record<string, LucideIcon> = {
  SCAN_STARTED: Search, SCAN_COMPLETED: Search, SCAN_FAILED: XCircle, DOCUMENT_DETECTED: FileText, DOCUMENT_VERSION_DETECTED: FileText,
  DOCUMENT_SKIPPED: FileText, OBLIGATIONS_EXTRACTED: Bot, POLICIES_INDEXED: Bot, POLICIES_RETRIEVED: Bot, IMPACT_ANALYZED: Bot,
  CONFLICT_DETECTED: AlertTriangle, NEEDS_INVESTIGATION: AlertTriangle, MEMO_GENERATED: Bot, REVIEW_REQUESTED: ShieldCheck,
  APPROVED: User, REJECTED: User, TICKET_CREATED: GitPullRequest, ARCHIVED: CheckCircle2, PIPELINE_FAILED: XCircle,
};

export function eventDetail(e: AuditEvent): string {
  const m = e.metadata as Record<string, unknown>;
  switch (e.event_type) {
    case "SCAN_COMPLETED":
      return `${Number(m.new ?? 0) + Number(m.skipped ?? 0)} publications checked · ${m.new ?? 0} new`;
    case "SCAN_FAILED":
      return String(m.error ?? "").split(":")[0].slice(0, 90);
    case "IMPACT_ANALYZED":
      return `${String(m.applicability)}${m.alignment ? ` · ${String(m.alignment)}` : ""} · via ${(m.path as string[] | undefined)?.map((p) => p.split(":")[0]).filter((v, i, a) => a.indexOf(v) === i).join(" + ") ?? "—"}`;
    case "TICKET_CREATED":
      return `GitHub issue #${String(m.ticket_id)}`;
    case "DOCUMENT_DETECTED":
    case "DOCUMENT_VERSION_DETECTED":
      return `${String(m.circular ?? "")}${m.version && Number(m.version) > 1 ? ` · v${String(m.version)}` : ""}`;
    case "OBLIGATIONS_EXTRACTED":
      return `${String(m.count)} obligations · ${String(m.model)}`;
    case "POLICIES_INDEXED":
      return `${String(m.chunks)} chunks · ${String(m.commit ?? "").slice(0, 7)} · ${String(m.backend)}`;
    case "POLICIES_RETRIEVED":
      return `${(m.chunks as string[] | undefined)?.length ?? 0} candidates · ${String(m.backend)}`;
    case "CONFLICT_DETECTED":
      return String(m.reason ?? "").replace(/^Conflict with /, "");
    default: {
      const keys = ["reason", "note", "error"].filter((k) => m[k]);
      return keys.map((k) => String(m[k]).split(" — ")[0].slice(0, 90)).join(" · ");
    }
  }
}

const tone: Record<string, string> = {
  CONFLICT_DETECTED: "border-warning/50 bg-warning/10 text-warning",
  NEEDS_INVESTIGATION: "border-warning/50 bg-warning/10 text-warning",
  REVIEW_REQUESTED: "border-warning/50 bg-warning/10 text-warning",
  SCAN_FAILED: "border-destructive/50 bg-destructive/10 text-destructive",
  PIPELINE_FAILED: "border-destructive/50 bg-destructive/10 text-destructive",
  APPROVED: "border-success/50 bg-success/10 text-success",
  TICKET_CREATED: "border-success/50 bg-success/10 text-success",
};

/** Compact timeline: a rail with one node per event, the event first, its detail second, the time out of the way on the right. */
export function ActivityFeed({ events, limit, quiet }: { events: AuditEvent[]; limit?: number; quiet?: boolean }) {
  const visible = quiet ? events.filter((e) => e.event_type !== "DOCUMENT_SKIPPED" && e.event_type !== "POLICIES_RETRIEVED") : events;
  const rows = limit ? visible.slice(0, limit) : visible;
  if (!rows.length) return <EmptyState icon={ActivityIcon} title="No activity yet" description="Run a scan to start the audit trail." />;
  return (
    <ol className="relative space-y-0 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-border">
      {rows.map((e) => {
        const Icon = icon[e.event_type] ?? ActivityIcon;
        const human = e.actor_type === "human";
        const ring = tone[e.event_type] ?? (human ? "border-foreground/30 bg-foreground/5 text-foreground" : "border-border bg-card text-muted-foreground");
        return (
          <li key={e.id} className="relative flex items-start gap-3 py-2">
            <span className={`relative z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border ${ring}`}>
              <Icon aria-hidden className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-6">
                <span className="font-medium">{eventLabel[e.event_type] ?? e.event_type}</span>
                {human ? <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">@{e.actor}</span> : null}
              </p>
              {eventDetail(e) ? <p className="truncate text-xs text-muted-foreground">{eventDetail(e)}</p> : null}
            </div>
            <time dateTime={e.timestamp} title={e.timestamp} className="shrink-0 pt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              {fmtTime(e.timestamp, false)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
