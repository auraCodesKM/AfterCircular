"use client";

import { ArrowUpRight, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { DocCard, Investigation } from "@/lib/pipeline-types";
import { EvidencePair } from "./evidence";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind } from "./labels";
import { useWorkspace } from "./workspace-provider";

function kindOf(c: DocCard) {
  return impactKind(c.impact, c.status);
}

/** One regulatory change as a compact structured block (not prose). */
export function DocCardView({ card, expanded, onOpenAnalysis }: { card: DocCard; expanded?: boolean; onOpenAnalysis?: (c: DocCard) => void }) {
  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-start gap-2 px-3 py-2.5">
        <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{card.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {card.source} · {card.circular_number} · {fmtDate(card.published_date)}
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
            <div><dt className="text-muted-foreground">Applicability</dt><dd className="font-medium">{card.applicability ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Alignment</dt><dd className="font-medium">{card.alignment ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Affected policy</dt><dd className="font-mono">{card.affected_policies.join(", ") || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Evidence</dt><dd>{card.regulatory_evidence.length} regulatory · {card.policy_evidence.length} policy</dd></div>
          </dl>
          {card.reason ? <p className="px-3 pb-2.5 text-xs text-muted-foreground">{card.reason}</p> : null}
        </>
      ) : null}
      <Separator />
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {card.analysis_id ? (
          <Button variant="ghost" size="xs" onClick={() => onOpenAnalysis?.(card)}>
            Show evidence
          </Button>
        ) : null}
        <Button variant="ghost" size="xs" render={<Link href={`/dashboard/documents/${card.document_pk}`} />}>
          Open full analysis <ArrowUpRight />
        </Button>
        {card.affected_policies[0] ? (
          <Button variant="ghost" size="xs" render={<Link href={`/dashboard/policies?open=${card.affected_policies[0]}`} />}>
            Open {card.affected_policies[0]}
          </Button>
        ) : null}
        {card.ticket_url ? (
          <Button variant="ghost" size="xs" render={<a href={card.ticket_url} target="_blank" rel="noreferrer" />}>
            Issue #{card.ticket_id} <ArrowUpRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Renders an Investigation answer as structured sections. Prose is limited to the one-line summary. */
export function AnswerView({ inv, compact, onAsk }: { inv: Investigation; compact?: boolean; onAsk?: (q: string) => void }) {
  const { analysis } = useWorkspace();
  const a = inv.answer;
  const openAnalysis = (c: DocCard) =>
    analysis.open({
      id: c.document_pk, source: c.source, jurisdiction: "IN", document_id: c.circular_number ?? c.document_pk, circular_number: c.circular_number, title: c.title,
      published_date: c.published_date, effective_date: c.effective_date, url: "#", content_hash: "", document_version: 1, processed_at: "", status: c.status, impact: c.impact,
      analysis_id: c.analysis_id, ticket_id: c.ticket_id, ticket_url: c.ticket_url, source_mode: c.source_mode, error: null,
    });

  return (
    <div className="space-y-4">
      <p className="text-sm">{inv.summary}</p>

      {a.document ? (
        <DocCardView card={a.document} expanded onOpenAnalysis={openAnalysis} />
      ) : null}
      {a.document && !compact ? <EvidencePair regulatory={a.document.regulatory_evidence} policy={a.document.policy_evidence} /> : null}

      {a.documents?.length ? (
        <div className="space-y-2">
          {a.documents.map((c) => (
            <DocCardView key={c.document_pk} card={c} expanded={!compact && a.documents!.length === 1} onOpenAnalysis={openAnalysis} />
          ))}
        </div>
      ) : null}

      {a.policy ? (
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
                <AccordionContent className="text-xs whitespace-pre-wrap text-muted-foreground">{s.text}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ) : null}

      {a.scan ? (
        <dl className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 text-xs sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{a.scan.status}</dd></div>
          <div><dt className="text-muted-foreground">Source</dt><dd>{a.scan.source_mode === "DEMO_SNAPSHOT" ? "Demo snapshot" : "Live"}</dd></div>
          <div><dt className="text-muted-foreground">New</dt><dd>{a.scan.new_documents}</dd></div>
          <div><dt className="text-muted-foreground">Already processed</dt><dd>{a.scan.skipped_documents}</dd></div>
        </dl>
      ) : null}

      {a.actions?.some((x) => x.kind === "scan") ? (
        <Button variant="outline" size="sm" render={<Link href="/dashboard?scan=1" />}>
          <RefreshCw /> Go to Scan now
        </Button>
      ) : null}

      {a.suggestions?.length && onAsk ? (
        <div className="flex flex-wrap gap-1.5">
          {a.suggestions.map((s) => (
            <Button key={s} variant="outline" size="xs" onClick={() => onAsk(s)}>
              {s}
            </Button>
          ))}
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Routed by {inv.judge.provider === "typesafe" ? `Jev (${inv.judge.model})` : inv.judge.provider}
        {inv.judge.intent_confidence != null ? ` · intent confidence ${inv.judge.intent_confidence.toFixed(2)}` : ""}
        {inv.judge.note ? ` · ${inv.judge.note}` : ""} · answer assembled from workspace records, not generated
        {inv.judge.provider !== "typesafe" ? <Badge variant="outline" className="ml-1 border-warning/40 text-[10px] text-warning">no model</Badge> : null}
      </p>
    </div>
  );
}
