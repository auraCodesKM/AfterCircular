"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import type { DecisionAnswer, DecisionRecord } from "@/lib/pipeline-types";

const stageLabel: Record<DecisionRecord["stage"], string> = {
  extraction_check: "Obligations verified against the circular",
  applicability: "Applicability",
  rerank: "Policy relevance",
  alignment: "Policy alignment",
  verification: "Citation check",
  escalation: "Reasoning model",
};
const providerLabel: Record<DecisionRecord["provider"], string> = { typesafe: "Jev · System One", foundry: "Foundry", stub: "stub · fixture", code: "code" };

function fmtAnswer(a: DecisionAnswer) {
  if (a.type === "noul") return `p(yes) ${(a.noul ?? 0).toFixed(2)}`;
  if (a.type === "choice") return `${a.choice} · p ${((a.probabilities ?? {})[a.choice ?? ""] ?? 0).toFixed(2)} · conf ${(a.confidence ?? 0).toFixed(2)}`;
  return `level ${(a.score ?? 0).toFixed(2)} · conf ${(a.confidence ?? 0).toFixed(2)}`;
}

function group(records: DecisionRecord[]) {
  const out: { stage: DecisionRecord["stage"]; provider: DecisionRecord["provider"]; model: string; calibrated: boolean | null; items: DecisionRecord[] }[] = [];
  for (const r of records) {
    const last = out[out.length - 1];
    if (last && last.stage === r.stage && last.provider === r.provider) last.items.push(r);
    else out.push({ stage: r.stage, provider: r.provider, model: r.model, calibrated: r.calibrated, items: [r] });
  }
  return out;
}

function summary(stage: DecisionRecord["stage"], items: DecisionRecord[]): string {
  const r0 = items[0].routing as Record<string, unknown>;
  switch (stage) {
    case "extraction_check":
      return r0.skipped ? `skipped: ${String(r0.skipped)}` : `${String(r0.kept)} kept · ${(r0.dropped as unknown[] | undefined)?.length ?? 0} dropped · ${(r0.flagged_uncertain as unknown[] | undefined)?.length ?? 0} flagged`;
    case "applicability":
      return `${String(r0.outcome)} — ${String(r0.reason)}`;
    case "rerank": {
      const kept = items.filter((i) => i.routing.kept);
      return `${kept.length} of ${items.length} chunks relevant: ${kept.map((i) => i.evidence_ids[0]).join(", ") || "none"}`;
    }
    case "alignment": {
      const pairs = items.flatMap((i) => Object.values((i.routing.pairs as Record<string, { bucket: string }>) ?? {}));
      const n = (b: string) => pairs.filter((p) => p.bucket === b).length;
      return `${pairs.length} obligation × policy pairs · ${n("conflicts")} conflict · ${n("satisfies")} satisfied · ${n("not_addressed") + n("harmless_uncertain")} not addressed · ${n("uncertain")} uncertain`;
    }
    case "verification": {
      const v = items.map((i) => String(i.routing.verdict));
      return `${v.filter((x) => x === "verified").length} of ${v.length} regulatory claims supported by the circular text${v.includes("fabricated") ? " · fabricated excerpt dropped" : ""}`;
    }
    case "escalation":
      return `${String(r0.outcome)} — ${String(r0.reason)}`;
  }
}

export function DecisionPath({ analysisId }: { analysisId: string }) {
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DecisionRecord[]>(`analyses/${analysisId}/decisions`)
      .then((r) => !cancelled && setRecords(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  if (error) return <p className="text-xs text-muted-foreground">Decision records unavailable: {error}</p>;
  if (!records) return <Skeleton className="h-16 w-full" />;
  if (!records.length) return null;

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">Decision path</h3>
        <p className="text-[11px] text-muted-foreground">Probabilities are the model&rsquo;s own — they route the case, they do not prove it.</p>
      </div>
      <ol className="divide-y divide-border rounded-lg border border-border">
        {group(records).map((g, gi) => (
          <li key={gi}>
            <Collapsible>
              <CollapsibleTrigger className="group/row flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
                <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/row:rotate-90" />
                <span className="font-medium">{stageLabel[g.stage]}</span>
                <Badge variant={g.provider === "stub" ? "outline" : "secondary"} className={`text-[10px] ${g.provider === "stub" ? "border-warning/40 text-warning" : ""}`}>
                  {providerLabel[g.provider]}
                  {g.model !== "-" ? ` · ${g.model}` : ""}
                </Badge>
                {g.calibrated === true ? <span className="text-[10px] text-muted-foreground">calibrated</span> : g.calibrated === false ? <span className="text-[10px] text-muted-foreground">self-reported</span> : null}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {g.items.length > 1 ? `${g.items.length} req · ` : ""}
                  {g.items.reduce((s, i) => s + i.latency_ms, 0)} ms
                </span>
                <span className="basis-full pl-5 text-xs text-muted-foreground">{summary(g.stage, g.items)}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-2">
                  {g.items.map((r) => (
                    <div key={r.id} className="text-[11px]">
                      <p className="font-mono text-muted-foreground">
                        {r.evidence_ids.join(" · ") || r.stage} · state {r.state_digest.slice(0, 10) || "—"} · {r.input_tokens ?? "—"} tok
                      </p>
                      {Object.keys(r.answers).length ? (
                        <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                          {Object.entries(r.answers).map(([qid, a]) => (
                            <li key={qid} className="flex justify-between gap-2">
                              <span className="truncate font-mono text-muted-foreground">{qid}</span>
                              <span className="shrink-0 tabular-nums">{fmtAnswer(a)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {r.routing.thresholds ? <p className="mt-1 text-muted-foreground">thresholds {JSON.stringify(r.routing.thresholds)}</p> : null}
                      {r.routing.verdict ? (
                        <p className="mt-1 text-muted-foreground">
                          verdict {String(r.routing.verdict)}
                          {r.routing.auto === false ? " · human should confirm" : ""}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ol>
    </section>
  );
}
