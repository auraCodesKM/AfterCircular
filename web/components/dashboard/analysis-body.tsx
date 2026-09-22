"use client";

import { ChevronRight, Cpu, FileDiff, ListChecks, Scale } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AnalysisRecord, ProcessedDocument } from "@/lib/pipeline-types";
import { DecisionDetails } from "./decision-path";
import { PipelineTrace } from "./pipeline-trace";
import { EvidencePair } from "./evidence";
import { MemoView } from "./memo-view";
import { Markdown } from "./markdown";
import { SectionHeader } from "./section-header";
import { WhyBlock } from "./why-block";

/** Why this result? — the evidence-to-decision chain in six lines, from the stored impact and decision path. */
function WhyThisResult({ impact, analysis }: { impact: NonNullable<AnalysisRecord["impact"]>; analysis: AnalysisRecord }) {
  const path = analysis.decision_path;
  const had = (stage: string) => path.some((p) => p.endsWith(`:${stage}`));
  const by = (stage: string) => (path.find((p) => p.endsWith(`:${stage}`))?.split(":")[0] === "typesafe" ? "Jev" : path.find((p) => p.endsWith(`:${stage}`))?.split(":")[0] === "foundry" ? "Microsoft Foundry" : "code");
  const outcome = analysis.gate_outcome ?? "—";
  const rows: [string, string, boolean][] = [
    ["Regulatory evidence", impact.regulatory_evidence.length ? impact.regulatory_evidence.map((e) => `§${e.section}`).join(", ") : "none cited", impact.regulatory_evidence.length > 0],
    ["Internal policy evidence", impact.policy_evidence.length ? Array.from(new Set(impact.policy_evidence.map((e) => `${e.doc_id} §${e.section}`))).join(", ") : "none cited", impact.policy_evidence.length > 0],
    ["Applicability", `${impact.applicability}${had("applicability") ? ` · ${by("applicability")}` : analysis.metrics.triage ? " · triage" : ""}`, true],
    ["Alignment", `${impact.alignment ?? "not decided"}${had("alignment") ? ` · ${by("alignment")}` : ""}${had("escalation") ? " · escalated to Microsoft Foundry" : ""}`, !!impact.alignment],
    ["Verification", had("cross_check") ? `cross-check · ${by("cross_check")}` : had("verification") ? `citation check · ${by("verification")}` : "not needed", had("verification") || had("cross_check")],
    ["Impact Gate (deterministic)", `${outcome} · confidence ${Math.round((impact.confidence ?? 0) * 100)}%`, true],
  ];
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        <span className="font-medium">Why this result?</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">evidence → applicability → alignment → verification → gate</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {rows.map(([k, v, ok], i) => (
            <li key={k} className="flex items-baseline gap-3 px-4 py-2">
              <span className="w-4 shrink-0 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <span className={`w-48 shrink-0 text-xs ${i === rows.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{k}</span>
              <span className={`min-w-0 text-[13px] ${ok ? "" : "text-muted-foreground"}`}>{v}</span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A row in the details group: one collapsible with a uniform trigger. */
export function DetailRow({ title, hint, children, defaultOpen }: { title: string; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        <span className="shrink-0 font-medium">{title}</span>
        {hint ? <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span> : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pt-1 pb-4 sm:pl-10">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Shared investigation body: what changed → impact → why → evidence → action → details (memo, obligations, decisions). */
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
    <div className="space-y-8">
      {ex?.summary ? (
        <section className="space-y-3">
          <SectionHeader as="h3" icon={<FileDiff />} title="What changed" />
          <Markdown className="text-[15px] leading-7">{ex.summary}</Markdown>
          {ex.applies_to?.length ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Applies to
              {ex.applies_to.map((a) => (
                <span key={a} className="rounded-md bg-muted px-1.5 py-0.5 text-foreground/80">
                  {a}
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ) : null}

      {impact ? (
        <>
          <section className="space-y-3">
            <SectionHeader as="h3" icon={<Cpu />} title="How this analysis was produced" description="Built from the stored run: model calls with Foundry response ids, Azure AI Search retrieval metrics, Jev decision records, audit events. Nothing here is assumed." />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Regulation</dt>
              <dd>
                {doc.source} · {impact.regulatory_source?.synthetic || doc.source_mode === "DEMO_SNAPSHOT" ? <span className="text-warning">DEMO SNAPSHOT · synthetic</span> : <span className="text-success">LIVE · sebi.gov.in</span>}
                {impact.regulatory_source?.reference ? <span className="ml-2 font-mono text-xs">{impact.regulatory_source.reference}</span> : null}
                {impact.regulatory_source?.detail_url && !impact.regulatory_source.synthetic ? (
                  <a href={impact.regulatory_source.detail_url} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4">Open SEBI source ↗</a>
                ) : null}
                {impact.regulatory_source?.pdf_url && !impact.regulatory_source.synthetic ? (
                  <a href={impact.regulatory_source.pdf_url} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4">PDF ↗</a>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">Policy source</dt>
              <dd>
                Internal policies from GitHub (fictional PoC tenant)
                {Object.values(impact.policy_sources ?? {}).find((p) => p.url) ? (
                  <a href={Object.values(impact.policy_sources ?? {}).find((p) => p.url)!.url!} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4">Open on GitHub ↗</a>
                ) : null}
              </dd>
            </dl>
            <PipelineTrace documentPk={doc.id} />
          </section>

          <WhyThisResult impact={impact} analysis={analysis} />

          <section className="space-y-3">
            <SectionHeader as="h3" icon={<Scale />} title="Impact" />
            <dl className="grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-x">
              {(
                [
                  ["Applicability", impact.applicability === "YES" ? "Applies" : impact.applicability === "NO" ? "Does not apply" : "Uncertain", ""],
                  ["Alignment", impact.alignment === "CONFLICT" ? "Conflict" : impact.alignment === "ALIGNED" ? "Aligned" : "—", impact.alignment === "CONFLICT" ? "text-destructive" : impact.alignment === "ALIGNED" ? "text-success" : ""],
                  ["Affected policy", impact.affected_policies.join(", ") || "—", "font-mono text-xs leading-5"],
                  ["Severity", impact.severity ?? "—", "capitalize"],
                ] as const
              ).map(([k, v, cls]) => (
                <div key={k} className="px-4 py-3">
                  <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{k}</dt>
                  <dd className={`mt-1 text-sm font-medium ${cls}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <WhyBlock impact={impact} />

          {impact.regulatory_evidence.length || impact.policy_evidence.length ? (
            <EvidencePair regulatory={impact.regulatory_evidence} policy={impact.policy_evidence} source={{ label: `${doc.source} circular`, url: doc.url, published: doc.published_date, regulatory: impact.regulatory_source, policies: impact.policy_sources }} />
          ) : null}

          {impact.recommended_action ? (
            <section className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                <ListChecks aria-hidden className="size-3.5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Recommended action</h3>
                <p className="mt-1 text-sm leading-6">{impact.recommended_action}</p>
              </div>
            </section>
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

      <section className="space-y-3">
        <SectionHeader as="h3" title="Details" description="The draft, the extracted obligations and every judgment that led here." />
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {analysis.memo ? (
            <DetailRow title="Draft memo" hint="AI-generated · human review required">
              <MemoView memo={analysis.memo} />
            </DetailRow>
          ) : null}
          {ex?.obligations?.length ? (
            <DetailRow title="Extracted obligations" hint={`${ex.obligations.length} found in the circular`}>
              <ol className="divide-y divide-border">
                {ex.obligations.map((o, i) => (
                  <li key={i} className="flex gap-3 py-2.5 text-sm leading-6">
                    <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      {o.requirement}
                      <span className="block text-xs text-muted-foreground">
                        §{o.evidence.section} · {o.affected_area.replace(/_/g, " ")}
                        {o.deadline ? ` · by ${o.deadline}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </DetailRow>
          ) : null}
          <DecisionDetails analysis={analysis} />
        </div>
      </section>
    </div>
  );
}
