import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { AnalysisBody } from "./analysis-body";
import { HumanReview } from "./human-review";
import { ImpactBadge } from "./impact-badge";
import { analysisKind, fmtDate, type ImpactKind } from "./labels";

const verdictTone: Record<ImpactKind, string> = {
  conflict: "text-destructive",
  aligned: "text-success",
  na: "text-foreground",
  uncertain: "text-warning",
  failed: "text-destructive",
  pending: "text-muted-foreground",
};

/** Full-page investigation workspace: change → verdict → your decision → what changed → why → evidence → action → details. */
export function AnalysisWorkspace({ doc, analysis, review }: { doc: ProcessedDocument; analysis: AnalysisRecord | null; review: ReviewRecord | null }) {
  const impact = analysis?.impact ?? null;
  const kind = analysisKind(doc, impact);
  const path = analysis?.decision_path.map((p) => p.split(":")[0]) ?? [];
  // the full chain, not a compressed "Jev → Foundry → Human": reasoning support routes, Foundry reasons on escalation, the gate decides, a person acts
  const providers = [path.includes("typesafe") ? "Reasoning support · Jev" : path.includes("stub") ? "Stub judgments" : null, path.includes("foundry") ? "Microsoft Foundry" : null, analysis?.gate_outcome ? "Impact Gate · deterministic" : null].filter((x): x is string => !!x);
  const verdict = impact ? (impact.applicability === "YES" ? (impact.alignment === "CONFLICT" ? "Conflict" : impact.alignment === "ALIGNED" ? "Aligned" : "Uncertain") : impact.applicability === "NO" ? "Not applicable" : "Uncertain") : null;

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge kind={kind} />
          {doc.source_mode === "DEMO_SNAPSHOT" ? <Badge variant="secondary">Demo snapshot · synthetic</Badge> : <Badge variant="outline" title={doc.document_url ?? undefined}>Live · sebi.gov.in</Badge>}
          {review ? (
            <Badge variant="outline" className={review.status === "AWAITING_REVIEW" ? "border-destructive/30 text-destructive" : ""}>
              {review.status === "AWAITING_REVIEW" ? "Awaiting your decision" : review.status === "APPROVED" ? "Approved" : "Rejected"}
            </Badge>
          ) : null}
        </div>
        <h2 className="text-xl leading-snug font-semibold tracking-tight text-balance sm:text-2xl">{doc.title}</h2>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{doc.source}</span>
          <span className="font-mono">{doc.circular_number ?? doc.document_id}</span>
          <span>Published {fmtDate(doc.published_date)}</span>
          <span>Effective {fmtDate(impact?.effective_date ?? doc.effective_date)}</span>
          {doc.url && doc.url !== "#" ? (
            <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
              Source <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </p>
      </header>

      {verdict ? (
        <section aria-label="Decision" className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Decision</p>
            <p className={cn("mt-1 text-3xl font-semibold tracking-tight", verdictTone[kind])}>{verdict}</p>
            <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {[...providers, ...(review ? ["Human review"] : [])].map((p, i, arr) => (
                <span key={`${p}-${i}`} className="inline-flex items-center gap-1">
                  <span className={cn("rounded-md px-1.5 py-0.5", p === "Human review" ? "bg-foreground/10 font-medium text-foreground" : p.startsWith("Impact Gate") ? "border border-foreground/30 font-medium text-foreground" : "bg-muted text-foreground/80")}>{p}</span>
                  {i < arr.length - 1 ? <ArrowRight aria-hidden className="size-3" /> : null}
                </span>
              ))}
              {!providers.length && !review ? "—" : null}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:min-w-56">
            <div>
              <dt className="text-xs text-muted-foreground">Severity</dt>
              <dd className="font-medium capitalize">{impact?.severity ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Confidence</dt>
              <dd className="font-medium tabular-nums">{impact ? `${Math.round(impact.confidence * 100)}%` : "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Affected policies</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {impact?.affected_policies.length ? (
                  impact.affected_policies.map((p, i) => (
                    <Button key={`${i}-${p}`} variant="outline" size="xs" className="font-mono" nativeButton={false} render={<Link href={`/dashboard/policies?open=${p}`} />}>
                      {p} <ArrowRight />
                    </Button>
                  ))
                ) : (
                  <span className="text-sm">—</span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {review ? <HumanReview review={review} /> : null}

      <AnalysisBody doc={doc} analysis={analysis} />
    </div>
  );
}
