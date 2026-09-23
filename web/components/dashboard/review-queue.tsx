"use client";

import { CalendarClock, ClipboardCheck, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { EmptyState } from "./empty-state";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, fmtTime, impactKind } from "./labels";
import { useWorkspace } from "./workspace-provider";

type Row = { doc: ProcessedDocument; review: ReviewRecord; affected: string[] };

/** Action queue. Review opens the analysis sheet; the sheet owns the approve/reject controls. */
export function ReviewQueue({ rows, decided, emptyAction = true }: { rows: Row[]; decided?: boolean; emptyAction?: boolean }) {
  const { analysis } = useWorkspace();
  if (!rows.length)
    return decided ? null : (
      <EmptyState
        icon={ClipboardCheck}
        title="No reviews need your attention"
        description="New regulatory conflicts will appear here when AfterCircular detects them."
        action={
          emptyAction ? (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/dashboard?scan=1" />}>
              Scan now
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <ul className={cn("divide-y divide-border overflow-hidden rounded-xl border bg-card", decided ? "border-border" : "border-destructive/25")}>
      {rows.map(({ doc, review, affected }) => (
        <li key={review.id} className={cn("flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center", !decided && "shadow-[inset_3px_0_0_0_var(--destructive)]")}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ImpactBadge kind={impactKind(doc.impact, doc.status)} />
              {affected.map((p, i) => (
                <span key={`${i}-${p}`} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
                  {p}
                </span>
              ))}
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm leading-5 font-medium" title={doc.title}>
              {doc.title}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarClock aria-hidden className="size-3" />
                Effective {fmtDate(doc.effective_date)}
              </span>
              <span className="inline-flex items-center gap-1">
                {decided ? <ShieldCheck aria-hidden className="size-3" /> : <FileText aria-hidden className="size-3" />}
                {decided
                  ? `${review.status === "APPROVED" ? "Approved" : "Rejected"} by @${review.decided_by} · ${fmtTime(review.decided_at)}`
                  : `Memo drafted · requested ${fmtTime(review.requested_at)}`}
              </span>
              {review.ticket_url ? (
                <a href={review.ticket_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
                  Issue #{review.ticket_id} <ExternalLink aria-hidden className="size-3" />
                </a>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5 sm:pl-2">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/dashboard/documents/${doc.id}`} />}>
              Inspect
            </Button>
            <Button size="sm" variant={decided ? "outline" : "default"} onClick={() => analysis.open(doc)}>
              {decided ? "Details" : "Review"}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
