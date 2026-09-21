"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import type { ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { AnalysisSheet } from "./analysis-sheet";
import { EmptyState } from "./empty-state";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind, statusLabel } from "./labels";

export function DocumentsTable({ documents, reviews, compact }: { documents: ProcessedDocument[]; reviews: ReviewRecord[]; compact?: boolean }) {
  const [open, setOpen] = useState<ProcessedDocument | null>(null);
  const reviewByDoc = new Map(reviews.map((r) => [r.document_pk, r]));
  if (!documents.length) return <EmptyState icon={FileText} title="No regulatory documents yet" description="Run a scan to fetch SEBI publications and analyze them against your policies." />;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-48">Circular</TableHead>
              <TableHead className={cn("hidden md:table-cell", compact && "md:hidden")}>Published</TableHead>
              <TableHead className={cn("hidden md:table-cell", compact && "md:hidden")}>Effective</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead className={cn(compact && "hidden lg:table-cell")}>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((d) => {
              const kind = impactKind(d.impact, d.status);
              return (
                <TableRow key={d.id} className={cn("group", kind === "conflict" && "shadow-[inset_2px_0_0_0_var(--destructive)]")}>
                  <TableCell className="max-w-[16rem] lg:max-w-xs xl:max-w-md">
                    <p className="truncate font-medium" title={d.title}>
                      {d.title}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {d.source} · {d.circular_number ?? d.document_id}
                      {d.document_version > 1 ? ` · v${d.document_version}` : ""}
                      {d.source_mode === "DEMO_SNAPSHOT" ? " · demo" : ""}
                    </p>
                  </TableCell>
                  <TableCell className={cn("hidden whitespace-nowrap text-muted-foreground md:table-cell", compact && "md:hidden")}>{fmtDate(d.published_date)}</TableCell>
                  <TableCell className={cn("hidden whitespace-nowrap text-muted-foreground md:table-cell", compact && "md:hidden")}>{fmtDate(d.effective_date)}</TableCell>
                  <TableCell>
                    <ImpactBadge kind={kind} />
                  </TableCell>
                  <TableCell className={cn("whitespace-nowrap text-muted-foreground", compact && "hidden lg:table-cell")}>
                    {statusLabel[d.status]}
                    {d.ticket_url ? (
                      <a href={d.ticket_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
                        #{d.ticket_id}
                        <ExternalLink aria-hidden className="size-3" />
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {d.analysis_id ? (
                      <Button size="sm" variant={d.status === "AWAITING_REVIEW" ? "default" : "ghost"} onClick={() => setOpen(d)} aria-label={`${d.status === "AWAITING_REVIEW" ? "Review" : "View analysis of"} ${d.title}`}>
                        {d.status === "AWAITING_REVIEW" ? "Review" : "Why?"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{d.error ? "failed" : "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <AnalysisSheet doc={open} review={open ? (reviewByDoc.get(open.id) ?? null) : null} onClose={() => setOpen(null)} />
    </>
  );
}
