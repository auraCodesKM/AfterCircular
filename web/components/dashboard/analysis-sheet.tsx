"use client";

import { ArrowUpRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { DecisionPath } from "./decision-path";
import { EvidencePair } from "./evidence";
import { HumanReview } from "./human-review";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind } from "./labels";
import { MemoView } from "./memo-view";
import { useWorkspace } from "./workspace-provider";

/** Mounted once in the layout; any table row, palette item or agent card opens it through the workspace context. */
export function AnalysisSheet() {
  const { analysis } = useWorkspace();
  const doc = analysis.doc;
  return (
    <Sheet open={!!doc} onOpenChange={(o) => !o && analysis.close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">{doc ? <Body key={doc.id} doc={doc} /> : null}</SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
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
  const ex = analysis?.extraction;
  const kind = impact ? (impact.applicability === "YES" ? (impact.alignment === "CONFLICT" ? "conflict" : impact.alignment === "ALIGNED" ? "aligned" : "uncertain") : impact.applicability === "NO" ? "na" : "uncertain") : impactKind(doc.impact, doc.status);

  return (
    <>
      <SheetHeader className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge kind={kind} />
          {impact?.severity ? <Badge variant="outline">Severity: {impact.severity}</Badge> : null}
          {doc.source_mode === "DEMO_SNAPSHOT" ? <Badge variant="secondary">Demo snapshot · fictional</Badge> : null}
        </div>
        <SheetTitle className="text-base leading-snug">{doc.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
          <span>
            {doc.source} · {doc.circular_number ?? doc.document_id}
          </span>
          <span>Published {fmtDate(doc.published_date)}</span>
          <span>Effective {fmtDate(impact?.effective_date ?? doc.effective_date)}</span>
          {doc.url && doc.url !== "#" ? (
            <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
              Source <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </SheetDescription>
        <div className="pt-1">
          <Button variant="outline" size="xs" render={<Link href={`/dashboard/documents/${doc.id}`} />}>
            Open full analysis <ArrowUpRight />
          </Button>
        </div>
      </SheetHeader>

      <div className="space-y-6 px-6 py-5 text-sm">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Analysis unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!analysis && !error && doc.analysis_id ? (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}
        {!doc.analysis_id ? <p className="text-muted-foreground">This document has not been analyzed yet ({doc.status.toLowerCase()}).{doc.error ? ` ${doc.error}` : ""}</p> : null}

        {ex?.summary ? (
          <Section title="What changed">
            <p>{ex.summary}</p>
            {ex.applies_to?.length ? <p className="text-xs text-muted-foreground">Applies to: {ex.applies_to.join(", ")}</p> : null}
          </Section>
        ) : null}

        {impact ? (
          <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-4">
            <div><dt className="text-[11px] text-muted-foreground">Applicability</dt><dd className="font-medium">{impact.applicability}</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Alignment</dt><dd className="font-medium">{impact.alignment ?? "—"}</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Affected</dt><dd className="font-mono text-xs">{impact.affected_policies.join(", ") || "—"}</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Evidence</dt><dd className="text-xs">{impact.regulatory_evidence.length} regulatory · {impact.policy_evidence.length} policy</dd></div>
          </dl>
        ) : null}

        {impact ? (
          <Section title="Why">
            <p>{impact.reason}</p>
          </Section>
        ) : null}

        {impact ? <EvidencePair regulatory={impact.regulatory_evidence} policy={impact.policy_evidence} /> : null}

        {ex?.obligations?.length ? (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">{ex.obligations.length} extracted obligations</CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="mt-2 space-y-1.5">
                {ex.obligations.map((o, i) => (
                  <li key={i} className="rounded-md border border-border p-2 text-xs">
                    <p>{o.requirement}</p>
                    <p className="mt-0.5 font-mono text-muted-foreground">
                      {o.affected_area} · deadline {o.deadline ?? "—"} · §{o.evidence.section}
                    </p>
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {impact?.recommended_action ? (
          <Section title="Recommended action">
            <p>{impact.recommended_action}</p>
          </Section>
        ) : null}

        {analysis?.memo ? <MemoView memo={analysis.memo} /> : null}

        {analysis?.escalation_reason ? (
          <Alert>
            <AlertTitle>Escalated beyond the typed judgments</AlertTitle>
            <AlertDescription>
              {analysis.escalation_reason}
              {analysis.decision_path.some((p) => p.endsWith(":escalation")) ? " → resolved by the reasoning model." : " → no reasoning model available, routed to a person."}
            </AlertDescription>
          </Alert>
        ) : null}

        {analysis ? <DecisionPath analysisId={analysis.id} /> : null}

        {analysis ? (
          <p className="text-[11px] text-muted-foreground">
            Analysis {analysis.id} · generative provider {analysis.ai_provider}
            {analysis.ai_provider === "stub" ? " (fixture, no model call)" : ""} · retrieval {analysis.metrics.retrieval?.backend ?? "—"}
          </p>
        ) : null}

        {review ? (
          <>
            <Separator />
            <HumanReview review={review} onDecided={setReview} />
          </>
        ) : null}
      </div>
    </>
  );
}
