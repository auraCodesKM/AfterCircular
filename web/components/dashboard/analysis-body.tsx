"use client";

import { ChevronRight, FileDiff, ListChecks, Scale } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Marker, MarkerContent, MarkerIcon } from "@/components/xiod/marker";
import type { AnalysisRecord, ProcessedDocument } from "@/lib/pipeline-types";
import { DecisionDetails } from "./decision-path";
import { EvidencePair } from "./evidence";
import { MemoView } from "./memo-view";
import { Markdown } from "./markdown";
import { WhyBlock } from "./why-block";

/** Shared investigation body: what changed → impact → why → evidence → action → memo → decision details. */
export function AnalysisBody({ doc, analysis }: { doc: ProcessedDocument; analysis: AnalysisRecord | null }) {
  const impact = analysis?.impact ?? null;
  const ex = analysis?.extraction;
  if (!analysis) {
    return (
      <Alert>
        <AlertTitle>Not analyzed yet</AlertTitle>
        <AlertDescription>
          This document is {doc.status.toLowerCase()}.{doc.error ? ` ${doc.error}` : ""}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-6">
      {ex?.summary ? (
        <section className="space-y-1.5">
          <Marker variant="border" render={<h3 />}>
            <MarkerIcon><FileDiff /></MarkerIcon>
            <MarkerContent className="font-medium text-foreground">What changed</MarkerContent>
          </Marker>
          <Markdown>{ex.summary}</Markdown>
          {ex.applies_to?.length ? <p className="text-xs text-muted-foreground">Applies to {ex.applies_to.join(", ")}</p> : null}
        </section>
      ) : null}

      {impact ? (
        <>
          <section className="space-y-2">
            <Marker variant="border" render={<h3 />}>
              <MarkerIcon><Scale /></MarkerIcon>
              <MarkerContent className="font-medium text-foreground">Impact</MarkerContent>
            </Marker>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Applicability</dt>
                <dd className="font-medium">{impact.applicability}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Alignment</dt>
                <dd className="font-medium">{impact.alignment ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Affected policy</dt>
                <dd className="font-mono text-xs leading-5">{impact.affected_policies.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Severity</dt>
                <dd className="font-medium capitalize">{impact.severity ?? "—"}</dd>
              </div>
            </dl>
          </section>
          <Separator />
          <WhyBlock impact={impact} />
          {impact.regulatory_evidence.length || impact.policy_evidence.length ? (
            <>
              <Separator />
              <EvidencePair regulatory={impact.regulatory_evidence} policy={impact.policy_evidence} source={{ label: `${doc.source} circular`, url: doc.url, published: doc.published_date }} />
            </>
          ) : null}
          {impact.recommended_action ? (
            <>
              <section className="space-y-1.5">
                <Marker variant="border" render={<h3 />}>
                  <MarkerIcon><ListChecks /></MarkerIcon>
                  <MarkerContent className="font-medium text-foreground">Recommended action</MarkerContent>
                </Marker>
                <p className="text-sm leading-6">{impact.recommended_action}</p>
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {analysis.escalation_reason ? (
        <Alert>
          <AlertTitle>Escalated beyond the typed judgments</AlertTitle>
          <AlertDescription>
            {analysis.escalation_reason}
            {analysis.decision_path.some((p) => p.endsWith(":escalation")) ? " — resolved by the reasoning model." : " — no reasoning model available, so a person decides."}
          </AlertDescription>
        </Alert>
      ) : null}

      {analysis.memo ? (
        <>
          <Separator />
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 py-1 text-left text-sm hover:text-foreground">
              <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
              <span className="font-medium">Draft memo</span>
              <span className="text-xs text-muted-foreground">AI-generated · human review required</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 pl-6">
                <MemoView memo={analysis.memo} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}

      {ex?.obligations?.length ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 py-1 text-left text-sm hover:text-foreground">
            <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            <span className="font-medium">Extracted obligations</span>
            <span className="text-xs text-muted-foreground">{ex.obligations.length}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 divide-y divide-border pl-6">
              {ex.obligations.map((o, i) => (
                <li key={i} className="py-2 text-sm leading-6">
                  {o.requirement}
                  <span className="block text-xs text-muted-foreground">
                    §{o.evidence.section} · {o.affected_area.replace(/_/g, " ")}
                    {o.deadline ? ` · by ${o.deadline}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <Separator />
      <DecisionDetails analysis={analysis} />
    </div>
  );
}
