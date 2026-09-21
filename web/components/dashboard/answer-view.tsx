"use client";

import { ArrowUpRight, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { CitationStack } from "@/components/agents/citations";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { evidenceCitations } from "@/lib/citations";
import type { DocCard, Investigation } from "@/lib/pipeline-types";
import { useState } from "react";
import { StreamingText } from "./streaming-text";
import { EvidencePair } from "./evidence";
import { Markdown } from "./markdown";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind } from "./labels";
import { useWorkspace } from "./workspace-provider";

function kindOf(c: DocCard) {
  return impactKind(c.impact, c.status);
}

/** Circular numbers and policy ids read as records, not prose: render them as code, keep trailing punctuation as text. */
const ID = /^((?:[A-Z]{2,}\/)[A-Z0-9/\-]+|[A-Z]{2,5}-\d{3})([.,;:!?)]*)$/;
export function richToken(tok: string) {
  const m = ID.exec(tok);
  if (!m) return tok;
  return (
    <>
      <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em] text-foreground">{m[1]}</code>
      {m[2]}
    </>
  );
}
function rich(text: string) {
  return text.split(/(\s+)/).map((tok, i) => (/^\s+$/.test(tok) ? tok : <span key={i}>{richToken(tok)}</span>));
}

const human = { YES: "Applies", NO: "Does not apply", UNCERTAIN: "Uncertain", CONFLICT: "Conflict", ALIGNED: "Aligned" } as const;

/** One regulatory change as a compact structured block (not prose). */
export function DocCardView({ card, expanded, onOpenAnalysis }: { card: DocCard; expanded?: boolean; onOpenAnalysis?: (c: DocCard) => void }) {
  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-start gap-2 px-3 py-2.5">
        <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-5 font-medium">{card.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {card.source} · <span className="font-mono">{card.circular_number}</span> · {fmtDate(card.published_date)}
            {card.effective_date ? ` · effective ${fmtDate(card.effective_date)}` : ""}
            {card.source_mode === "DEMO_SNAPSHOT" ? " · demo" : ""}
          </p>
        </div>
        <ImpactBadge kind={kindOf(card)} />
      </div>
      {expanded ? (
        <>
          <Separator />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 text-xs sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Applicability</dt><dd className="font-medium">{card.applicability ? human[card.applicability] : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Alignment</dt><dd className={`font-medium ${card.alignment === "CONFLICT" ? "text-destructive" : card.alignment === "ALIGNED" ? "text-success" : ""}`}>{card.alignment ? human[card.alignment] : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Affected policy</dt><dd className="font-mono">{card.affected_policies.join(", ") || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Evidence</dt><dd>{card.regulatory_evidence.length} regulatory · {card.policy_evidence.length} policy</dd></div>
          </dl>
          {card.reason ? <p className="line-clamp-2 px-3 pb-2.5 text-xs leading-5 text-muted-foreground">{card.reason.split(/(?<=\.)\s|:\s/)[0]}</p> : null}
          {card.regulatory_evidence.length || card.policy_evidence.length ? (
            <div className="px-3 pb-2.5">
              <CitationStack citations={evidenceCitations(card.regulatory_evidence, card.policy_evidence, { label: `${card.source} circular` })} />
            </div>
          ) : null}
        </>
      ) : null}
      <Separator />
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {card.analysis_id ? (
          <Button variant="ghost" size="xs" onClick={() => onOpenAnalysis?.(card)}>
            Show evidence
          </Button>
        ) : null}
        <Button variant="ghost" size="xs" nativeButton={false} render={<Link href={`/dashboard/documents/${card.document_pk}`} />}>
          Open full analysis <ArrowUpRight />
        </Button>
        {card.affected_policies[0] ? (
          <Button variant="ghost" size="xs" nativeButton={false} render={<Link href={`/dashboard/policies?open=${card.affected_policies[0]}`} />}>
            Open {card.affected_policies[0]}
          </Button>
        ) : null}
        {card.ticket_url ? (
          <Button variant="ghost" size="xs" nativeButton={false} render={<a href={card.ticket_url} target="_blank" rel="noreferrer" />}>
            Issue #{card.ticket_id} <ArrowUpRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Renders an Investigation answer as structured sections. Prose is limited to the one-line summary. */
export function AnswerView({ inv, compact, onAsk, stream = true, onDone }: { inv: Investigation; compact?: boolean; onAsk?: (q: string) => void; stream?: boolean; /** Fires once the summary has finished streaming (immediately when `stream` is false). */ onDone?: () => void }) {
  const { analysis } = useWorkspace();
  const a = inv.answer;
  const [done, setDone] = useState(!stream);
  const streaming = stream && !done;
  const primary = a.document ?? (a.documents?.length === 1 ? a.documents[0] : null);
  const sources = primary ? evidenceCitations(primary.regulatory_evidence, primary.policy_evidence, { label: `${primary.source} circular` }) : [];
  const openAnalysis = (c: DocCard) =>
    analysis.open({
      id: c.document_pk, source: c.source, jurisdiction: "IN", document_id: c.circular_number ?? c.document_pk, circular_number: c.circular_number, title: c.title,
      published_date: c.published_date, effective_date: c.effective_date, url: "#", content_hash: "", document_version: 1, processed_at: "", status: c.status, impact: c.impact,
      analysis_id: c.analysis_id, ticket_id: c.ticket_id, ticket_url: c.ticket_url, source_mode: c.source_mode, error: null,
    });

  return (
    <div className="space-y-4">
      <StreamingResponse status={streaming ? "streaming" : "complete"} copyText={inv.summary} sources={compact && sources.length ? sources : undefined} showActions={!streaming && inv.intent !== "other"}>
        <p className="text-[15px] leading-7 text-foreground">
          {stream ? (
            <StreamingText
              text={inv.summary}
              renderToken={richToken}
              onDone={() => {
                setDone(true);
                onDone?.();
              }}
            />
          ) : (
            rich(inv.summary)
          )}
        </p>
      </StreamingResponse>

      {!streaming && a.points?.length ? (
        <ol className="space-y-2">
          {a.points.map((p, i) => {
            const card = a.documents?.find((d) => d.id === p.record_id);
            return (
              <li key={`${p.record_id}-${i}`} className="rounded-md border border-border px-3 py-2.5">
                <p className="text-sm leading-6">
                  <span className="mr-2 font-mono text-[11px] text-muted-foreground">{i + 1}.</span>
                  {card ? (
                    <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => openAnalysis(card)}>
                      {card.circular_number ?? card.title}
                    </button>
                  ) : (
                    <span className="font-mono text-xs">{p.record_id}</span>
                  )}
                  {card ? <span className="ml-2 text-xs text-muted-foreground">{card.source_mode === "DEMO_SNAPSHOT" ? "demo snapshot · synthetic" : "live · sebi.gov.in"}</span> : null}
                </p>
                <p className="mt-1 text-sm leading-6 text-foreground/90">{p.claim}</p>
                {p.evidence.length ? (
                  <ul className="mt-2 space-y-1">
                    {p.evidence.map((e) => (
                      <li key={e.id} className="flex gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0 font-mono text-[10px]">{e.id.includes(".R") ? `circular §${e.section ?? "?"}` : e.id.includes(".P") ? `${e.doc_id ?? "policy"} §${e.section ?? "?"}` : `obligation ${e.section ? `§${e.section}` : ""}`}</span>
                        <span className="italic">“{e.text ?? e.requirement}”</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {!streaming && a.caveat ? <p className="text-xs text-muted-foreground">{a.caveat}</p> : null}

      {streaming ? null : a.document ? (
        <DocCardView card={a.document} expanded onOpenAnalysis={openAnalysis} />
      ) : null}
      {!streaming && a.document && !compact ? (
        <EvidencePair regulatory={a.document.regulatory_evidence} policy={a.document.policy_evidence} source={{ label: `${a.document.source} circular`, published: a.document.published_date }} />
      ) : null}

      {!streaming && a.documents?.length ? (
        <div className="space-y-2">
          {a.documents.map((c) => (
            <DocCardView key={c.document_pk} card={c} expanded={!compact && a.documents!.length === 1} onOpenAnalysis={openAnalysis} />
          ))}
        </div>
      ) : null}

      {!streaming && a.policy ? (
        <div className="rounded-md border border-border">
          <div className="px-3 py-2.5">
            <p className="text-sm font-medium">
              <span className="font-mono text-xs text-muted-foreground">{a.policy.doc_id}</span> {a.policy.title}
            </p>
            <p className="text-[11px] text-muted-foreground">
              v{a.policy.version ?? "—"} · {a.policy.owner ?? "owner —"} · effective {fmtDate(a.policy.effective_date)} · {a.policy.sections.length} sections
            </p>
          </div>
          <Separator />
          <Accordion className="px-1">
            {a.policy.sections.slice(0, compact ? 4 : 40).map((s) => (
              <AccordionItem key={s.section} value={s.section}>
                <AccordionTrigger className="py-2 text-xs">§{s.section}</AccordionTrigger>
                <AccordionContent>
                  <Markdown className="text-[13px]">{s.text}</Markdown>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ) : null}

      {!streaming && a.scan ? (
        <dl className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 text-xs sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{a.scan.status}</dd></div>
          <div><dt className="text-muted-foreground">Source</dt><dd>{a.scan.source_mode === "DEMO_SNAPSHOT" ? "Demo snapshot" : "Live"}</dd></div>
          <div><dt className="text-muted-foreground">New</dt><dd>{a.scan.new_documents}</dd></div>
          <div><dt className="text-muted-foreground">Already processed</dt><dd>{a.scan.skipped_documents}</dd></div>
        </dl>
      ) : null}

      {!streaming && a.actions?.some((x) => x.kind === "scan") ? (
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/dashboard?scan=1" />}>
          <RefreshCw /> Go to Scan now
        </Button>
      ) : null}

      {!streaming && a.suggestions?.length && onAsk ? (
        <div className="flex flex-wrap gap-1.5">
          {a.suggestions.map((s) => (
            <Button key={s} variant="outline" size="xs" onClick={() => onAsk(s)}>
              {s}
            </Button>
          ))}
        </div>
      ) : null}

      {!streaming ? <Provenance inv={inv} /> : null}
    </div>
  );
}


/** Says exactly what produced the answer — every value comes from the recorded call telemetry, never a placeholder. */
function Provenance({ inv }: { inv: Investigation }) {
  const r = inv.answer.reasoning;
  const jevOk = inv.judge.provider === "typesafe";
  const ms = (v?: number | null) => (v === undefined || v === null ? "not recorded" : `${v} ms`);
  const tok = (i?: number | null, o?: number | null) => (i === undefined || i === null ? "tokens not recorded" : `${i}→${o ?? 0} tokens`);
  if (!r) {
    return <p className="text-[11px] text-muted-foreground">{jevOk ? "Routed by Jev · System One" : "Routed by keywords (no model)"} · assembled from workspace records</p>;
  }
  const route = r.jev_route;
  const routeLine = jevOk && route ? `Routed by Jev (${route.model ?? "jev"}, ${ms(route.latency_ms)}, ${tok(route.input_tokens, route.output_tokens)})` : `Routed by keywords (Jev unavailable${route?.error ? `: ${route.error}` : ""})`;
  if (r.kind === "jev_reasoning") {
    const j = r.jev_judgments;
    const n = r.narrative;
    return (
      <div className="space-y-0.5 text-[11px] text-muted-foreground">
        <p>
          <span className="font-medium text-foreground/80">Reasoned by Jev</span>
          {j && !j.error ? ` · ${j.questions ?? "?"} typed judgments (${j.model ?? "jev"}, calibrated, ${ms(j.latency_ms)}, ${tok(j.input_tokens, j.output_tokens)})` : j?.error ? ` · judgments unavailable: ${j.error}` : ""}
        </p>
        <p>
          {n && !n.error
            ? `Written by ${n.provider === "foundry" ? "Foundry" : n.provider} ${n.model ?? ""} (${n.structured_mode ?? "?"}, ${ms(n.latency_ms)}, ${tok(n.input_tokens, n.output_tokens)}${n.estimated_cost_usd !== undefined && n.estimated_cost_usd !== null ? `, est. $${n.estimated_cost_usd.toFixed(4)}` : ""}) — every claim validated against the records`
            : r.composed
              ? `Sentences composed from the judgments and records (no narrative model${n?.error ? `: ${n.error}` : ""})`
              : ""}
          {r.dropped_uncited?.length ? ` · ${r.dropped_uncited.length} uncited claim(s) dropped` : ""}
        </p>
        <p>
          Sources: {r.sources} workspace record{r.sources === 1 ? "" : "s"}
          {r.evidence ? ` · Evidence: ${r.evidence.regulatory} regulatory excerpt${r.evidence.regulatory === 1 ? "" : "s"}, ${r.evidence.policy} policy section${r.evidence.policy === 1 ? "" : "s"}${r.evidence.obligations ? `, ${r.evidence.obligations} obligations` : ""}` : ""}
          {r.workspace ? ` · Workspace: ${r.workspace}` : ""} · {routeLine}
        </p>
      </div>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{r.kind === "refused" ? "Refused — actions need human approval" : r.kind === "clarify" ? "Needs clarification" : "Workspace data"}</span>
      {r.kind === "workspace_data" ? ` · Sources: ${r.sources} record${r.sources === 1 ? "" : "s"} · no reasoning model, no generated text` : ""}
      {r.workspace ? ` · Workspace: ${r.workspace}` : ""} · {routeLine}
      {!jevOk ? <Badge variant="outline" className="ml-1 border-warning/40 text-[10px] text-warning">no model</Badge> : null}
    </p>
  );
}
