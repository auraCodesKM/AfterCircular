"use client";

import { ArrowUpRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { AnalysisBody } from "./analysis-body";
import { HumanReview } from "./human-review";
import { ImpactBadge } from "./impact-badge";
import { analysisKind, fmtDate } from "./labels";
import { Orb } from "./orb";
import { useWorkspace } from "./workspace-provider";

export function AnalysisSheet() {
  const { analysis } = useWorkspace();
  const doc = analysis.doc;
  return (
    <Sheet open={!!doc} onOpenChange={(o) => !o && analysis.close()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">{doc ? <Body key={doc.id} doc={doc} /> : null}</SheetContent>
    </Sheet>
  );
}

function Body({ doc }: { doc: ProcessedDocument }) {
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (doc.analysis_id)
      api<AnalysisRecord>(`analyses/${doc.analysis_id}`)
        .then((a) => !cancelled && setAnalysis(a))
        .catch((e: Error) => !cancelled && setError(e.message));
    api<ReviewRecord[]>("reviews")
      .then((rs) => !cancelled && setReview(rs.find((r) => r.document_pk === doc.id) ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc.analysis_id, doc.id]);

  const impact = analysis?.impact ?? null;
  const loading = !analysis && !error && !!doc.analysis_id;

  return (
    <>
      <SheetHeader className="sticky top-0 z-10 gap-2 border-b border-border bg-background px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge kind={analysisKind(doc, impact)} />
          {doc.source_mode === "DEMO_SNAPSHOT" ? <Badge variant="secondary">Demo snapshot</Badge> : null}
        </div>
        <SheetTitle className="line-clamp-3 text-base leading-snug sm:line-clamp-2">{doc.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span>{doc.source}</span>
          <span>Published {fmtDate(doc.published_date)}</span>
          <span>Effective {fmtDate(impact?.effective_date ?? doc.effective_date)}</span>
          {doc.url && doc.url !== "#" ? (
            <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
              Source <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </SheetDescription>
        <div>
          <Button variant="outline" size="xs" nativeButton={false} render={<Link href={`/dashboard/documents/${doc.id}`} />}>
            Open full analysis <ArrowUpRight />
          </Button>
        </div>
      </SheetHeader>

      <div className="flex-1 px-6 py-5">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Analysis unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div className="space-y-4" aria-busy>
            <div className="flex items-center gap-3">
              <Orb state="solving" px={64} />
              <p className="text-sm text-muted-foreground">Loading the analysis…</p>
            </div>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="mt-6 h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <AnalysisBody doc={doc} analysis={analysis} />
        )}
      </div>

      {review ? (
        <div className="sticky bottom-0 z-10 border-t border-border bg-background px-6 py-4">
          <HumanReview review={review} onDecided={setReview} compact />
        </div>
      ) : null}
    </>
  );
}
