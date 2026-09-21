import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { AnalysisBody } from "./analysis-body";
import { HumanReview } from "./human-review";
import { ImpactBadge } from "./impact-badge";
import { analysisKind, fmtDate } from "./labels";

/** Full-page investigation workspace: change → decision → evidence → action → details → human review. */
export function AnalysisWorkspace({ doc, analysis, review }: { doc: ProcessedDocument; analysis: AnalysisRecord | null; review: ReviewRecord | null }) {
  const impact = analysis?.impact ?? null;
  const path = analysis?.decision_path.map((p) => p.split(":")[0]) ?? [];
  const providers = Array.from(new Set(path.map((p) => (p === "typesafe" ? "Jev" : p === "foundry" ? "Foundry" : p))));
  const verdict = impact ? (impact.applicability === "YES" ? (impact.alignment ?? "Uncertain") : impact.applicability === "NO" ? "Not applicable" : "Uncertain") : null;

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge kind={analysisKind(doc, impact)} />
          {doc.source_mode === "DEMO_SNAPSHOT" ? <Badge variant="secondary">Demo snapshot</Badge> : null}
        </div>
        <h2 className="line-clamp-3 text-lg leading-snug font-medium sm:line-clamp-2">{doc.title}</h2>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{doc.source}</span>
          <span className="font-mono">{doc.circular_number ?? doc.document_id}</span>
          <span>Published {fmtDate(doc.published_date)}</span>
          <span>Effective {fmtDate(impact?.effective_date ?? doc.effective_date)}</span>
          {doc.url ? (
            <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
              Source <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </p>
      </header>

      {verdict ? (
        <>
          <Separator />
          <section className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Decision</p>
              <p className="text-2xl font-semibold tracking-tight">{verdict}</p>
              <p className="text-xs text-muted-foreground">
                {providers.join(" → ") || "—"}
                {review ? " → Human" : ""}
              </p>
            </div>
            {impact?.affected_policies.length ? (
              <div className="flex flex-wrap gap-1">
                {impact.affected_policies.map((p) => (
                  <Button key={p} variant="outline" size="xs" nativeButton={false} render={<Link href={`/dashboard/policies?open=${p}`} />}>
                    Open {p}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <Separator />
      <AnalysisBody doc={doc} analysis={analysis} />

      {review ? (
        <>
          <Separator />
          <HumanReview review={review} />
        </>
      ) : null}
    </div>
  );
}
