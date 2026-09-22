"use client";

import { ArrowUpRight, FileText } from "lucide-react";
import Link from "next/link";
import { CitationStack } from "@/components/agents/citations";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toCitationItems } from "@/lib/citations";
import type { DocCard, Investigation } from "@/lib/pipeline-types";
import { cardSources } from "@/lib/sources";
import { AnswerDocument } from "./answer-document";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind } from "./labels";

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
              <CitationStack citations={toCitationItems(cardSources(card))} />
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

/** The answer surface: answer first, evidence second, technical trace third (see answer-document.tsx). */
export function AnswerView(props: { inv: Investigation; compact?: boolean; onAsk?: (q: string) => void; stream?: boolean; onDone?: () => void }) {
  return <AnswerDocument {...props} />;
}
