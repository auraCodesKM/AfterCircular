import { ArrowRight, FileText, History, MessageSquare, ServerOff, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { DocumentsTable } from "@/components/dashboard/documents-table";
import { ReviewQueue } from "@/components/dashboard/review-queue";
import { ScanControl } from "@/components/dashboard/scan-control";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Stat, StatGrid } from "@/components/dashboard/stat";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AuditEvent, ProcessedDocument, ReviewRecord, ScanRecord } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await shellContext();
  const [scan, documents, reviews, audit] = await Promise.all([
    load<ScanRecord | null>(ctx, "/api/scans/latest", null),
    load<ProcessedDocument[]>(ctx, "/api/documents", []),
    load<ReviewRecord[]>(ctx, "/api/reviews", []),
    load<AuditEvent[]>(ctx, "/api/audit?limit=20", []),
  ]);
  const docs = documents.data;
  const byDoc = new Map(docs.map((d) => [d.id, d]));
  const pendingRows = reviews.data
    .filter((r) => r.status === "AWAITING_REVIEW" && byDoc.has(r.document_pk))
    .map((review) => ({ doc: byDoc.get(review.document_pk)!, review, affected: [] as string[] }));
  const pending = pendingRows.length;
  const conflicts = docs.filter((d) => d.impact === "CONFLICT").length;
  const aligned = docs.filter((d) => d.impact === "ALIGNED").length;
  const notApplicable = docs.filter((d) => d.impact === "NOT_APPLICABLE").length;
  const lastScanDocs = scan.data?.document_ids.length ?? 0;
  const lastScanAt = scan.data?.finished_at ?? scan.data?.started_at;

  // The title states the situation, not the page name — a reader should know in one line whether anything waits on them.
  const headline = pending ? `${pending} regulatory ${pending === 1 ? "change needs" : "changes need"} your decision` : conflicts ? "Conflicts handled — nothing is waiting on you" : docs.length ? "All clear — nothing needs your review" : "Run your first scan";
  const description = docs.length
    ? `${docs.length} regulatory ${docs.length === 1 ? "publication" : "publications"} processed · ${conflicts} in conflict${lastScanAt ? ` · ${lastScanDocs} new in the last scan` : ""}`
    : `AfterCircular reads the regulator, compares each circular with the policies in ${ctx.tenant.githubRepo}, and drafts what a person must decide.`;

  return (
    <div className="space-y-10">
      {ctx.backendError ? (
        <Alert variant="error">
          <ServerOff />
          <AlertTitle>Backend unavailable</AlertTitle>
          <AlertDescription>{ctx.backendError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-5">
        <Suspense>
          <ScanControl
            initial={scan.data}
            disabled={!!ctx.backendError}
            eyebrow={`${ctx.tenant.companyName} · Overview`}
            title={headline}
            description={description}
            actions={
              pending ? (
                <Button size="sm" nativeButton={false} render={<Link href="/dashboard/reviews" />}>
                  <ShieldCheck /> Review {pending === 1 ? "it" : `all ${pending}`}
                </Button>
              ) : null
            }
          >
            <StatusStrip health={ctx.health} scan={scan.data} />
          </ScanControl>
        </Suspense>
        <StatGrid>
          <Stat label="Needs review" value={pending} tone={pending ? "destructive" : "default"} hint={pending ? "awaiting your decision" : "nothing waiting"} href="/dashboard/reviews" />
          <Stat label="Conflicts" value={conflicts} tone={conflicts ? "warning" : "default"} hint={docs.length ? `of ${docs.length} processed` : "no documents yet"} href="/dashboard/documents?impact=conflict" />
          <Stat label="Aligned" value={aligned} tone={aligned ? "success" : "default"} hint="policy already complies" href="/dashboard/documents?impact=aligned" />
          <Stat label="Not applicable" value={notApplicable} hint="outside this company's scope" href="/dashboard/documents?impact=na" />
        </StatGrid>
      </div>

      {pending ? (
        <section className="space-y-3">
          <SectionHeader
            title="Needs your decision"
            count={pending}
            description="AI detected a conflict and drafted a memo. Nothing external happens until you approve."
            action={
              <Button variant="ghost" size="xs" nativeButton={false} render={<Link href="/dashboard/reviews" />}>
                All reviews <ArrowRight />
              </Button>
            }
          />
          <ReviewQueue rows={pendingRows.slice(0, 3)} emptyAction={false} />
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionHeader
          icon={<FileText />}
          title="Recent regulatory changes"
          count={docs.length}
          description="Newest first. Click a row for the analysis."
          action={
            <Button variant="ghost" size="xs" nativeButton={false} render={<Link href="/dashboard/documents" />}>
              All documents <ArrowRight />
            </Button>
          }
        />
        <DocumentsTable documents={docs.slice(0, 8)} compact />
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={<History />}
          title="Recent activity"
          description="Scans, judgments and human decisions. Routine events are hidden."
          action={
            <Button variant="ghost" size="xs" nativeButton={false} render={<Link href="/dashboard/activity" />}>
              All activity <ArrowRight />
            </Button>
          }
        />
        <ActivityFeed events={audit.data} limit={6} quiet />
      </section>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MessageSquare aria-hidden className="size-3" /> AI detects, analyzes and drafts. A person decides. Nothing external happens without approval.
      </p>
    </div>
  );
}
