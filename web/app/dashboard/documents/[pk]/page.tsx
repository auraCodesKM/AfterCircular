import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisWorkspace } from "@/components/dashboard/analysis-workspace";
import { Button } from "@/components/ui/button";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Analysis" };

export default async function DocumentPage({ params }: { params: Promise<{ pk: string }> }) {
  const { pk } = await params;
  const ctx = await shellContext();
  const doc = await load<ProcessedDocument | null>(ctx, `/api/documents/${encodeURIComponent(pk)}`, null);
  if (!doc.data) notFound();
  const [analysis, reviews] = await Promise.all([
    doc.data.analysis_id ? load<AnalysisRecord | null>(ctx, `/api/analyses/${doc.data.analysis_id}`, null) : Promise.resolve({ data: null, error: null }),
    load<ReviewRecord[]>(ctx, "/api/reviews", []),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" nativeButton={false} render={<Link href="/dashboard/documents" />}>
          <ArrowLeft /> Documents
        </Button>
        <span aria-hidden>/</span>
        <h1 className="font-medium text-foreground">Analysis</h1>
      </div>
      <AnalysisWorkspace doc={doc.data} analysis={analysis.data} review={reviews.data.find((r) => r.document_pk === pk) ?? null} />
    </div>
  );
}
