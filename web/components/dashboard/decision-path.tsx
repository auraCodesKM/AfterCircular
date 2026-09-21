"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import type { AnalysisRecord, DecisionAnswer, DecisionRecord } from "@/lib/pipeline-types";
import { Orb } from "./orb";

const stageLabel: Record<DecisionRecord["stage"], string> = {
  triage: "Relevance triage (before extraction)",
  extraction_check: "Obligations checked against the circular",
  applicability: "Applicability",
  rerank: "Relevant policy text selected",
  alignment: "Policy alignment",
  verification: "Citations verified",
  escalation: "Reasoning model",
  cross_check: "Reasoning model cross-checked",
};
const providerName: Record<string, string> = { typesafe: "Jev · System One", foundry: "Microsoft Foundry", stub: "Stub (fixture, no model)", code: "Code" };

function fmtAnswer(a: DecisionAnswer) {
  if (a.type === "noul") return `P(yes) ${(a.noul ?? 0).toFixed(2)}`;
  if (a.type === "choice") return `${a.choice} · P ${((a.probabilities ?? {})[a.choice ?? ""] ?? 0).toFixed(2)} · confidence ${(a.confidence ?? 0).toFixed(2)}`;
  return `level ${(a.score ?? 0).toFixed(2)} · confidence ${(a.confidence ?? 0).toFixed(2)}`;
}

type Group = { stage: DecisionRecord["stage"]; provider: DecisionRecord["provider"]; model: string; calibrated: boolean | null; items: DecisionRecord[] };

function group(records: DecisionRecord[]): Group[] {
  const out: Group[] = [];
  for (const r of records) {
    const last = out[out.length - 1];
    if (last && last.stage === r.stage && last.provider === r.provider) last.items.push(r);
    else out.push({ stage: r.stage, provider: r.provider, model: r.model, calibrated: r.calibrated, items: [r] });
  }
  return out;
}

/** One plain sentence per stage — what happened, not how. */
function plain(g: Group): string {
  const r0 = g.items[0].routing as Record<string, unknown>;
  switch (g.stage) {
    case "triage":
      return r0.outcome === "archive"
        ? `Header addressed to other entity types — archived without an extraction call (confidence ${Number(r0.confidence ?? 0).toFixed(2)}).`
        : `Header judged ${String(r0.choice ?? "unclear")}${r0.confidence !== undefined ? ` (confidence ${Number(r0.confidence).toFixed(2)})` : ""} — extraction ran.`;
    case "cross_check":
      return r0.verdict === "agree" ? "The typed alignment judgment confirmed the reasoning model's conclusion." : `Cross-check ${String(r0.verdict)} — routed to a person.`;
    case "extraction_check": {
      if (r0.skipped) return "Skipped — the check was unavailable.";
      const dropped = (r0.dropped as unknown[] | undefined)?.length ?? 0;
      return `${String(r0.kept)} obligation${Number(r0.kept) === 1 ? "" : "s"} confirmed in the circular text${dropped ? `, ${dropped} unsupported and dropped` : ""}.`;
    }
    case "applicability":
      return r0.outcome === "YES" ? "The circular applies to this company." : r0.outcome === "NO" ? "The circular does not apply to this company." : "Applicability could not be settled by the typed judgment.";
    case "rerank": {
      const kept = g.items.filter((i) => i.routing.kept);
      const docs = Array.from(new Set(kept.map((i) => String(i.evidence_ids[0]).split("#")[0])));
      return `${kept.length} of ${g.items.length} candidate sections judged relevant${docs.length ? ` (${docs.join(", ")})` : ""}.`;
    }
    case "alignment": {
      const pairs = g.items.flatMap((i) => Object.values((i.routing.pairs as Record<string, { bucket: string }>) ?? {}));
      const n = (b: string) => pairs.filter((p) => p.bucket === b).length;
      const parts = [n("conflicts") ? `${n("conflicts")} conflicting` : "", n("satisfies") ? `${n("satisfies")} satisfied` : "", n("uncertain") ? `${n("uncertain")} uncertain` : ""].filter(Boolean);
      return `${pairs.length} obligation–clause pairs compared: ${parts.join(", ") || "none addressed"}.`;
    }
    case "verification": {
      const v = g.items.map((i) => String(i.routing.verdict));
      const ok = v.filter((x) => x === "verified").length;
      return `${ok} of ${v.length} regulatory claims confirmed against the circular text${v.includes("fabricated") ? "; one excerpt was not in the source and was dropped" : ""}.`;
    }
    case "escalation":
      return `Escalated: ${String(r0.reason)} → ${String(r0.outcome)}.`;
  }
}

/** Progressive disclosure: one line by default, stages on expand, raw telemetry one level deeper. */
export function DecisionDetails({ analysis }: { analysis: AnalysisRecord }) {
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || records) return;
    let cancelled = false;
    api<DecisionRecord[]>(`analyses/${analysis.id}/decisions`)
      .then((r) => !cancelled && setRecords(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open, records, analysis.id]);

  const providers = Array.from(new Set(analysis.decision_path.map((p) => p.split(":")[0])));
  const powered = providers.map((p) => (p === "typesafe" ? "Jev · System One" : p === "foundry" ? "Foundry" : p === "stub" ? "stub" : p)).join(" + ");
  const groups = records ? group(records) : [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        <span className="shrink-0 font-medium">Decision details</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          Powered by {powered || "—"} · {analysis.decision_path.length} stages
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 px-4 pt-1 pb-4 sm:pl-10">
          <p className="text-xs text-muted-foreground">Typed judgments with calibrated probabilities route each case; a person decides. Probabilities are the model&rsquo;s own and never authorize an action.</p>
          {error ? <p className="text-xs text-destructive">Decision records unavailable: {error}</p> : null}
          {!records && !error ? (
            <div className="flex items-center gap-3">
              <Orb state="composing" px={28} />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : null}
          {records ? (
            <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[9px] before:w-px before:bg-border">
              {groups.map((g, gi) => (
                <li key={gi} className="relative flex gap-3 text-sm">
                  <span className="relative z-[1] mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-[10px] text-muted-foreground tabular-nums">{gi + 1}</span>
                  <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{stageLabel[g.stage]}</span>
                    <span className="text-xs text-muted-foreground">{providerName[g.provider] ?? g.provider}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{plain(g)}</p>
                  <Accordion className="mt-1">
                    <AccordionItem value="tech" className="border-0">
                      <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline [&>svg]:size-3.5">Technical details</AccordionTrigger>
                      <AccordionContent>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                          <dt>model</dt>
                          <dd>{g.model}</dd>
                          <dt>calibrated</dt>
                          <dd>{g.calibrated === true ? "yes (System One)" : g.calibrated === false ? "no (self-reported)" : "n/a"}</dd>
                          <dt>requests</dt>
                          <dd>
                            {g.items.length} · {g.items.reduce((s, i) => s + i.latency_ms, 0)} ms · {g.items.reduce((s, i) => s + (i.input_tokens ?? 0), 0)} tokens
                          </dd>
                          {g.items[0].routing.thresholds ? (
                            <>
                              <dt>thresholds</dt>
                              <dd>{JSON.stringify(g.items[0].routing.thresholds)}</dd>
                            </>
                          ) : null}
                        </dl>
                        {g.items.map((r) => (
                          <div key={r.id} className="mt-2 border-t border-border pt-2 font-mono text-[11px] text-muted-foreground">
                            <p>
                              {r.evidence_ids.join(" · ") || r.stage} · state {r.state_digest.slice(0, 10) || "—"}
                              {r.routing.verdict ? ` · verdict ${String(r.routing.verdict)}${r.routing.auto === false ? " (human should confirm)" : ""}` : ""}
                            </p>
                            {Object.keys(r.answers).length ? (
                              <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                                {Object.entries(r.answers).map(([qid, a]) => (
                                  <li key={qid} className="flex justify-between gap-2">
                                    <span className="truncate">{qid}</span>
                                    <span className="shrink-0 tabular-nums">{fmtAnswer(a)}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          <Separator />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <dt>analysis</dt>
            <dd>{analysis.id}</dd>
            <dt>generative</dt>
            <dd>
              {analysis.ai_provider}
              {analysis.ai_provider === "stub" ? " (fixture, no model call)" : ""}
              {Object.keys(analysis.models).length ? ` · ${Object.entries(analysis.models).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}
            </dd>
            <dt>retrieval</dt>
            <dd>
              {analysis.metrics.retrieval?.backend ?? "—"} · {analysis.metrics.retrieval?.count ?? 0} candidates
            </dd>
            {analysis.escalation_reason ? (
              <>
                <dt>escalation</dt>
                <dd>{analysis.escalation_reason}</dd>
              </>
            ) : null}
          </dl>
          {analysis.ai_provider === "stub" ? (
            <Badge variant="outline" className="border-warning/40 text-warning">
              Extraction and memo come from fixtures — no generative model configured
            </Badge>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
