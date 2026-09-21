"use client";

import { ClipboardCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { EmptyState } from "./empty-state";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, fmtTime, impactKind } from "./labels";
import { useWorkspace } from "./workspace-provider";

type Row = { doc: ProcessedDocument; review: ReviewRecord; affected: string[] };

/** Compact action queue. Review opens the analysis sheet; the sheet owns the approve/reject controls. */
export function ReviewQueue({ rows, decided }: { rows: Row[]; decided?: boolean }) {
  const { analysis } = useWorkspace();
  if (!rows.length) return decided ? null : <EmptyState icon={ClipboardCheck} title="You're all caught up" description="No conflicts are waiting for approval." />;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map(({ doc, review, affected }) => (
        <li key={review.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
          <ImpactBadge kind={impactKind(doc.impact, doc.status)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={doc.title}>
              {doc.title}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {affected.length ? `${affected.join(", ")} · ` : ""}effective {fmtDate(doc.effective_date)} ·{" "}
              {decided ? `${review.status === "APPROVED" ? "approved" : "rejected"} by @${review.decided_by} ${fmtTime(review.decided_at)}` : `AI analysis ready · requested ${fmtTime(review.requested_at)}`}
              {review.ticket_url ? (
                <>
                  {" · "}
                  <a href={review.ticket_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
                    issue #{review.ticket_id} <ExternalLink aria-hidden className="size-3" />
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="xs" render={<Link href={`/dashboard/documents/${doc.id}`} />}>
              Inspect
            </Button>
            <Button size="xs" variant={decided ? "outline" : "default"} onClick={() => analysis.open(doc)}>
              {decided ? "Details" : "Review"}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
