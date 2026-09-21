import type { Metadata } from "next";
import Link from "next/link";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { DocumentsTable } from "@/components/dashboard/documents-table";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { PageHeader } from "@/components/dashboard/page-header";
import { ScanPanel } from "@/components/dashboard/scan-panel";
import { SystemStatus } from "@/components/dashboard/system-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AuditEvent, ProcessedDocument, ReviewRecord, ScanRecord } from "@/lib/pipeline-types";
import { fmtTime } from "@/components/dashboard/labels";

export const metadata: Metadata = { title: "Dashboard" };

export default async function OverviewPage() {
  const ctx = await shellContext();
  const [scan, documents, reviews, audit] = await Promise.all([
    load<ScanRecord | null>(ctx, "/api/scans/latest", null),
    load<ProcessedDocument[]>(ctx, "/api/documents", []),
    load<ReviewRecord[]>(ctx, "/api/reviews", []),
    load<AuditEvent[]>(ctx, "/api/audit?limit=8", []),
  ]);
  const pending = reviews.data.filter((r) => r.status === "AWAITING_REVIEW").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Regulatory intelligence for ${ctx.tenant.companyName}.`}
        meta={
          <>
            <span>Last scan {fmtTime(scan.data?.finished_at ?? scan.data?.started_at)}</span>
            <span>{documents.data.length} documents processed</span>
            <span>{pending} awaiting review</span>
          </>
        }
      />
      <SystemStatus health={ctx.health} scan={scan.data} backendError={ctx.backendError} />
      <MetricCards documents={documents.data} reviews={reviews.data} />
      <ScanPanel initial={scan.data} disabled={!!ctx.backendError} />
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">Regulatory changes</h2>
            <Button variant="ghost" size="sm" render={<Link href="/dashboard/documents" />}>
              View all
            </Button>
          </div>
          <DocumentsTable documents={documents.data.slice(0, 6)} reviews={reviews.data} compact />
        </section>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent activity</CardTitle>
            <Button variant="ghost" size="sm" render={<Link href="/dashboard/activity" />}>
              View all
            </Button>
          </CardHeader>
          <CardContent>
            <ActivityFeed events={audit.data} limit={8} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
