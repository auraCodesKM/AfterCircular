import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisWorkspace } from "@/components/dashboard/analysis-workspace";
import { InvestigationAnswer } from "@/components/dashboard/investigation-answer";
import { Button } from "@/components/ui/button";
import { load, shellContext } from "@/lib/dashboard-data";
import type { AnalysisRecord, Investigation, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { fmtTime } from "@/components/dashboard/labels";

export const metadata: Metadata = { title: "Investigation" };

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await shellContext();
  const inv = await load<Investigation | null>(ctx, `/api/investigations/${encodeURIComponent(id)}`, null);
  if (!inv.data) notFound();
  const doc = inv.data.document_pk ? await load<ProcessedDocument | null>(ctx, `/api/documents/${inv.data.document_pk}`, null) : { data: null };
  const analysis = inv.data.analysis_id ? await load<AnalysisRecord | null>(ctx, `/api/analyses/${inv.data.analysis_id}`, null) : { data: null };
  const reviews = doc.data ? await load<ReviewRecord[]>(ctx, "/api/reviews", []) : { data: [] as ReviewRecord[] };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="xs" render={<Link href="/dashboard" />}>
        <ArrowLeft /> Overview
      </Button>
      <div>
        <p className="text-xs text-muted-foreground">Investigation · {fmtTime(inv.data.created_at)} · @{inv.data.actor}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{inv.data.question}</h1>
      </div>
      {doc.data ? (
        <AnalysisWorkspace doc={doc.data} analysis={analysis.data} review={reviews.data.find((r) => r.document_pk === doc.data!.id) ?? null} />
      ) : (
        <InvestigationAnswer inv={inv.data} />
      )}
    </div>
  );
}
