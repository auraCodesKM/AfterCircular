"use client";

import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import type { ProcessedDocument } from "@/lib/pipeline-types";
import { EmptyState } from "./empty-state";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind, statusLabel } from "./labels";
import { useWorkspace } from "./workspace-provider";

export function DocumentsTable({ documents, compact }: { documents: ProcessedDocument[]; compact?: boolean }) {
  const { analysis } = useWorkspace();
  if (!documents.length) return <EmptyState icon={FileText} title="No regulatory documents yet" description="Run a scan to fetch SEBI publications and analyze them against your policies." />;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-48">Circular</TableHead>
            <TableHead className={cn("hidden md:table-cell", compact && "md:hidden")}>Published</TableHead>
            <TableHead className="hidden md:table-cell">Effective</TableHead>
            <TableHead>Impact</TableHead>
            <TableHead className={cn(compact && "hidden lg:table-cell")}>Status</TableHead>
            <TableHead className="w-24 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((d) => {
            const kind = impactKind(d.impact, d.status);
            return (
              <TableRow key={d.id} className={cn("cursor-pointer", kind === "conflict" && "shadow-[inset_2px_0_0_0_var(--destructive)]")} onClick={() => d.analysis_id && analysis.open(d)}>
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
                <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{fmtDate(d.effective_date)}</TableCell>
                <TableCell>
                  <ImpactBadge kind={kind} />
                </TableCell>
                <TableCell className={cn("whitespace-nowrap text-muted-foreground", compact && "hidden lg:table-cell")}>
                  {statusLabel[d.status]}
                  {d.ticket_url ? (
                    <a href={d.ticket_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1 inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
                      #{d.ticket_id}
                      <ExternalLink aria-hidden className="size-3" />
                    </a>
                  ) : null}
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {d.analysis_id ? (
                    d.status === "AWAITING_REVIEW" ? (
                      <Button size="xs" onClick={() => analysis.open(d)}>
                        Review
                      </Button>
                    ) : (
                      <Button size="xs" variant="ghost" render={<Link href={`/dashboard/documents/${d.id}`} />}>
                        Inspect
                      </Button>
                    )
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
  );
}
