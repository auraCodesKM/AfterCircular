import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { AskBar } from "@/components/dashboard/ask-bar";
import { DocumentsTable } from "@/components/dashboard/documents-table";
import { ScanControl } from "@/components/dashboard/scan-control";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AuditEvent, ProcessedDocument, ReviewRecord, ScanRecord } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await shellContext();
  const [scan, documents, reviews, audit] = await Promise.all([
    load<ScanRecord | null>(ctx, "/api/scans/latest", null),
    load<ProcessedDocument[]>(ctx, "/api/documents", []),
    load<ReviewRecord[]>(ctx, "/api/reviews", []),
    load<AuditEvent[]>(ctx, "/api/audit?limit=6", []),
  ]);
  const docs = documents.data;
  const pending = reviews.data.filter((r) => r.status === "AWAITING_REVIEW").length;
  const conflicts = docs.filter((d) => d.impact === "CONFLICT").length;
  const lastScanDocs = scan.data?.document_ids.length ?? 0;
  const summary = [
    ["Needs review", pending, pending ? "text-destructive" : ""],
    ["Conflicts", conflicts, conflicts ? "text-destructive" : ""],
    ["Aligned", docs.filter((d) => d.impact === "ALIGNED").length, ""],
    ["Not applicable", docs.filter((d) => d.impact === "NOT_APPLICABLE").length, ""],
    ["Last scan", lastScanDocs ? `${lastScanDocs} new` : "0 new", ""],
  ] as const;

  return (
    <div className="space-y-6">
      {ctx.backendError ? (
        <Alert variant="destructive">
          <AlertTitle>Backend unavailable</AlertTitle>
          <AlertDescription>{ctx.backendError}</AlertDescription>
        </Alert>
      ) : null}
      <Suspense>
        <ScanControl initial={scan.data} disabled={!!ctx.backendError} title="Overview" description={`Regulatory intelligence for ${ctx.tenant.companyName}`}>
          <StatusStrip health={ctx.health} scan={scan.data} />
        </ScanControl>
      </Suspense>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {summary.map(([k, v, cls]) => (
          <div key={k} className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={`font-medium tabular-nums ${cls}`}>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent regulatory changes</h2>
          <Button variant="ghost" size="xs" render={<Link href="/dashboard/documents" />}>
            All documents
          </Button>
        </div>
        <DocumentsTable documents={docs.slice(0, 8)} compact />
      </section>

      <AskBar />

      <Separator />
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <Button variant="ghost" size="xs" render={<Link href="/dashboard/activity" />}>
            All activity
          </Button>
        </div>
        <ActivityFeed events={audit.data} limit={6} />
      </section>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MessageSquare aria-hidden className="size-3" /> AI detects, analyzes and drafts. A person decides. Nothing external happens without approval.
      </p>
    </div>
  );
}
