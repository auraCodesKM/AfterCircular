import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { DecisionPath } from "./decision-path";
import { EvidencePair } from "./evidence";
import { HumanReview } from "./human-review";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind } from "./labels";
import { MemoView } from "./memo-view";

/** The full investigation workspace for one regulatory change: change → decision → evidence → analysis path → human action. */
export function AnalysisWorkspace({ doc, analysis, review }: { doc: ProcessedDocument; analysis: AnalysisRecord | null; review: ReviewRecord | null }) {
  const impact = analysis?.impact ?? null;
  const ex = analysis?.extraction;
  const kind = impact ? (impact.applicability === "YES" ? (impact.alignment === "CONFLICT" ? "conflict" : impact.alignment === "ALIGNED" ? "aligned" : "uncertain") : impact.applicability === "NO" ? "na" : "uncertain") : impactKind(doc.impact, doc.status);
  const path = analysis?.decision_path.map((p) => p.split(":")) ?? [];
  const providers = Array.from(new Set(path.map(([p]) => (p === "typesafe" ? "Jev" : p === "foundry" ? "Foundry" : p))));

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge kind={kind} />
          {impact?.severity ? <Badge variant="outline">Severity: {impact.severity}</Badge> : null}
          {doc.source_mode === "DEMO_SNAPSHOT" ? <Badge variant="secondary">Demo snapshot · fictional</Badge> : null}
        </div>
        <h2 className="mt-2 text-base font-medium leading-snug">{doc.title}</h2>
        <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground">
          <span>
            {doc.source} · {doc.circular_number ?? doc.document_id}
          </span>
          <span>Published {fmtDate(doc.published_date)}</span>
          <span>Effective {fmtDate(impact?.effective_date ?? doc.effective_date)}</span>
          {doc.url ? (
            <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
              Source <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </p>
        {ex?.summary ? <p className="mt-3 text-sm">{ex.summary}</p> : null}
      </section>

      {!analysis ? (
        <Alert>
          <AlertTitle>Not analyzed yet</AlertTitle>
          <AlertDescription>This document is {doc.status.toLowerCase()}. {doc.error ?? ""}</AlertDescription>
        </Alert>
      ) : null}

      {impact ? (
        <section className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground">Decision</h3>
            <dl className="space-y-2 rounded-md border border-border p-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Result</dt><dd className="font-medium">{impact.applicability === "YES" ? (impact.alignment ?? "Uncertain") : impact.applicability === "NO" ? "Not applicable" : "Uncertain"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Applicability</dt><dd>{impact.applicability}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Alignment</dt><dd>{impact.alignment ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Affected policy</dt><dd className="font-mono text-xs">{impact.affected_policies.join(", ") || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Analysis path</dt><dd className="text-right text-xs">{providers.join(" → ") || "—"}{review ? " → Human" : ""}</dd></div>
            </dl>
            {impact.affected_policies.length ? (
              <div className="flex flex-wrap gap-1">
                {impact.affected_policies.map((p) => (
                  <Button key={p} variant="outline" size="xs" render={<Link href={`/dashboard/policies?open=${p}`} />}>
                    Open {p}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground">Why</h3>
            <p className="text-sm">{impact.reason}</p>
            {impact.recommended_action ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Recommended: </span>
                {impact.recommended_action}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {impact ? <EvidencePair regulatory={impact.regulatory_evidence} policy={impact.policy_evidence} /> : null}

      {ex?.obligations?.length ? (
        <Collapsible>
          <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">{ex.obligations.length} extracted obligations</CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
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
          <HumanReview review={review} />
        </>
      ) : null}
    </div>
  );
}
