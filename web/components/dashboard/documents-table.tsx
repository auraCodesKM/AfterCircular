"use client";

import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "cn";
import type { ProcessedDocument } from "@/lib/pipeline-types";
import { EmptyState } from "./empty-state";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind, statusLabel } from "./labels";
import { useWorkspace } from "./workspace-provider";

const head =
  "h-9 text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

const rowAccent: Partial<Record<ReturnType<typeof impactKind>, string>> = {
  conflict: "shadow-[inset_3px_0_0_0_var(--destructive)]",
  uncertain: "shadow-[inset_3px_0_0_0_var(--warning)]",
  failed: "shadow-[inset_3px_0_0_0_var(--destructive)]",
};

/** Processed circulars. Each row is one regulatory change: what it is, its impact, where it stands, and the one thing to do next. */
export function DocumentsTable({
  documents,
  compact,
}: {
  documents: ProcessedDocument[];
  compact?: boolean;
}) {
  const { analysis } = useWorkspace();
  if (!documents.length)
    return (
      <EmptyState
        icon={FileText}
        title="No regulatory documents yet"
        description="Run a scan to fetch SEBI publications and analyze them against your policies."
      />
    );

  const action = (d: ProcessedDocument) =>
    d.analysis_id ? (
      d.status === "AWAITING_REVIEW" ? (
        <Button size="xs" onClick={() => analysis.open(d)}>
          Review
        </Button>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          nativeButton={false}
          render={<Link href={`/dashboard/documents/${d.id}`} />}
        >
          Inspect
        </Button>
      )
    ) : (
      <span className="text-xs text-muted-foreground">
        {d.error ? "failed" : "—"}
      </span>
    );

  return (
    <>
      {/* Phone: one card per circular — a six-column table would scroll sideways and hide the impact. */}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card md:hidden">
        {documents.map((d) => {
          const kind = impactKind(d.impact, d.status);
          return (
            <li
              key={d.id}
              className={cn("space-y-2 px-4 py-3", rowAccent[kind])}
              onClick={() => d.analysis_id && analysis.open(d)}
            >
              <div className="flex items-start justify-between gap-3">
                <ImpactBadge kind={kind} />
                <span onClick={(e) => e.stopPropagation()}>{action(d)}</span>
              </div>
              <p className="text-sm font-medium leading-5" title={d.title}>
                {d.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {d.source} ·{" "}
                <span className="font-mono">
                  {d.circular_number ?? d.document_id}
                </span>
                {d.document_version > 1 ? ` · v${d.document_version}` : ""}
                {d.source_mode === "DEMO_SNAPSHOT" ? " · demo" : ""}
              </p>
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>Effective {fmtDate(d.effective_date)}</span>
                {!compact ? (
                  <span>Published {fmtDate(d.published_date)}</span>
                ) : null}
                <span className="text-foreground/80">
                  {statusLabel[d.status]}
                </span>
                {d.ticket_url ? (
                  <a
                    href={d.ticket_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
                  >
                    #{d.ticket_id}
                    <ExternalLink aria-hidden className="size-3" />
                  </a>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        {/* Fixed layout: the title column takes whatever the fixed-width columns leave, so long titles clamp instead of stretching the table. */}
        <Table className="min-w-[36rem] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={head}>Circular</TableHead>
              <TableHead className={cn(head, "w-36")}>Impact</TableHead>
              <TableHead
                className={cn(
                  head,
                  "hidden w-28 md:table-cell",
                  compact && "md:hidden",
                )}
              >
                Published
              </TableHead>
              <TableHead className={cn(head, "hidden w-28 md:table-cell")}>
                Effective
              </TableHead>
              <TableHead
                className={cn(head, "w-40", compact && "hidden lg:table-cell")}
              >
                Status
              </TableHead>
              <TableHead className="h-9 w-24 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((d) => {
              const kind = impactKind(d.impact, d.status);
              return (
                <TableRow
                  key={d.id}
                  className={cn(
                    "cursor-pointer transition-colors",
                    rowAccent[kind],
                  )}
                  onClick={() => d.analysis_id && analysis.open(d)}
                >
                  <TableCell className="py-3">
                    <p
                      className={cn(
                        "text-sm font-medium leading-5",
                        compact ? "truncate" : "line-clamp-2 whitespace-normal",
                      )}
                      title={d.title}
                    >
                      {d.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {d.source} ·{" "}
                      <span className="font-mono">
                        {d.circular_number ?? d.document_id}
                      </span>
                      {d.document_version > 1
                        ? ` · v${d.document_version}`
                        : ""}
                      {d.source_mode === "DEMO_SNAPSHOT" ? " · demo" : ""}
                    </p>
                  </TableCell>
                  <TableCell className="py-3">
                    <ImpactBadge kind={kind} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "hidden py-3 whitespace-nowrap text-muted-foreground md:table-cell",
                      compact && "md:hidden",
                    )}
                  >
                    {fmtDate(d.published_date)}
                  </TableCell>
                  <TableCell className="hidden py-3 whitespace-nowrap text-muted-foreground md:table-cell">
                    {fmtDate(d.effective_date)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "truncate py-3 text-muted-foreground",
                      compact && "hidden lg:table-cell",
                    )}
                  >
                    {statusLabel[d.status]}
                    {d.ticket_url ? (
                      <a
                        href={d.ticket_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-1 inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
                      >
                        #{d.ticket_id}
                        <ExternalLink aria-hidden className="size-3" />
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {action(d)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
