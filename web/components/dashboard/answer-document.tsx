"use client";

import { ArrowUpRight, Check, ChevronRight, Copy, FileText, ListTree } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { composeAnswer } from "@/lib/answer-compose";
import type { DocCard, Investigation } from "@/lib/pipeline-types";
import type { Source } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { DocCardView, richToken } from "./answer-view";
import { ExecutionStrip } from "./execution-strip";
import { Markdown } from "./markdown";
import { PipelineTrace, TraceTimeline } from "./pipeline-trace";
import { SourceIcon } from "./source-card";
import { StreamingText } from "./streaming-text";
import { useWorkspace } from "./workspace-provider";

/** Long-form answer typography: headings carry hierarchy, tables and quotes stay compact, [n] markers become citation chips. */
const md: Components = {
  h2: ({ children }) => <h2 className="mt-1 mb-2 text-lg font-semibold tracking-tight text-balance first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-5 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>,
  p: ({ children }) => <p className="my-2 text-[15px] leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-[15px] leading-7">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-[15px] leading-7">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-muted-foreground not-italic">{children}</em>,
  a: ({ children, href }) =>
    href?.includes("-src-") ? (
      <a href={href} onClick={(e) => { e.preventDefault(); jumpTo(href.slice(1)); }} className="mx-0.5 inline-flex min-w-4 -translate-y-0.5 items-center justify-center rounded border border-border bg-muted px-1 py-px font-mono text-[10px] font-semibold leading-none text-muted-foreground no-underline hover:text-foreground">[{children}]</a>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">{children}</a>
    ),
  code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground/80">{children}</code>,
  blockquote: ({ children }) => <blockquote className="my-2 rounded-r-md border-l-2 border-border bg-muted/30 py-1.5 pr-3 pl-3 text-[14px] leading-6 [&_p]:my-0 [&_p]:text-[14px]">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60 text-left text-xs">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border align-top last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-1.5 font-medium text-muted-foreground">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 leading-6">{children}</td>,
  hr: () => <hr className="my-3 border-border" />,
};

const withMarkers = (s: string) => s.replace(/\[(\d{1,2})\]/g, (_, n) => `[${n}](#src-${n})`);

function statusLabel(s: Source) {
  if (s.kind === "regulator") return s.status === "LIVE" ? "Official SEBI source · LIVE" : "Demo snapshot · synthetic";
  if (s.kind === "policy") return s.url ? "Internal policy · GitHub" : "Internal policy · workspace";
  if (s.kind === "retrieval") return `Retrieved · Azure AI Search${s.rank ? ` · rank ${s.rank}` : ""}`;
  return "sebi.gov.in · discovery";
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Compact numbered source rows; excerpts on demand. The circular's title/reference appears once per group, not per row. */
function Sources({ sources, open, idPrefix }: { sources: Source[]; open: boolean; idPrefix: string }) {
  const [show, setShow] = useState<Record<string, boolean>>({});
  if (!sources.length) return null;
  const regTitle = sources.find((s) => s.kind === "regulator");
  const polRepo = sources.find((s) => s.kind === "policy" && s.repository);
  return (
    <section id={`${idPrefix}-sources`} className="mt-5 scroll-mt-4">
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sources</h3>
      <ol className="divide-y divide-border rounded-md border border-border">
        {sources.map((s, i) => {
          const n = i + 1;
          const on = open || !!show[s.id];
          const first = sources.findIndex((x) => x.kind === s.kind) === i;
          return (
            <li key={s.id} id={`${idPrefix}-src-${n}`} className="scroll-mt-4 px-3 py-2 text-[13px]">
              {first && s.kind === "regulator" && regTitle ? (
                <p className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className={cn("rounded-sm border px-1 text-[10px]", regTitle.status === "LIVE" ? "border-success/40 text-success" : "border-warning/40 text-warning")}>{regTitle.status === "LIVE" ? "LIVE" : "DEMO SNAPSHOT"}</span>
                  <span>{regTitle.label} · {regTitle.title}{regTitle.reference ? ` · ${regTitle.reference}` : ""}</span>
                </p>
              ) : null}
              {first && s.kind === "policy" ? (
                <p className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className="rounded-sm border border-border px-1 text-[10px]">INTERNAL</span>
                  <span>Fictional PoC policy{polRepo?.repository ? ` · ${polRepo.repository}` : ""}</span>
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">[{n}]</span>
                <SourceIcon kind={s.kind} favicon={s.favicon_url} />
                <span className="font-medium">
                  {s.kind === "regulator" ? `${s.label} §${s.section ?? "?"}` : s.kind === "policy" || s.kind === "retrieval" ? `${s.document_id} §${s.section ?? "?"}` : s.title}
                </span>
                <span className="text-[11px] text-muted-foreground">{statusLabel(s)}</span>
                <span className="ml-auto flex items-center gap-3 text-[11px]">
                  {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">{s.kind === "policy" ? "GitHub" : s.kind === "regulator" ? "SEBI page" : "Open"} <ArrowUpRight className="size-3" /></a> : null}
                  {s.pdf_url ? <a href={s.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"><FileText className="size-3" /> PDF</a> : null}
                  {s.workspace_href ? <Link href={s.workspace_href} className="underline-offset-4 hover:underline">Workspace</Link> : null}
                  {s.excerpt ? <button type="button" onClick={() => setShow((m) => ({ ...m, [s.id]: !on }))} className="text-muted-foreground hover:text-foreground">{on ? "Hide" : "Show evidence"}</button> : null}
                </span>
              </div>
              {on && s.excerpt ? <p className="mt-1.5 border-l-2 border-border pl-3 text-[13px] leading-6 text-muted-foreground">“{s.excerpt}”</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Provenance({ inv, sources, mode }: { inv: Investigation; sources: Source[]; mode: string }) {
  const r = inv.answer.reasoning;
  const n = r?.narrative;
  const line = mode === "narrative" && n && !n.error ? `Written by Microsoft Foundry · ${n.model ?? ""} · every claim checked against the cited records` : mode === "narrative" ? "Sentences composed from Jev judgments and stored records · no narrative model" : mode === "web" ? "Microsoft Foundry Web Search · sebi.gov.in only · discovery" : mode === "refused" ? "Refused by the review gate · no model call" : "Answer assembled from records · no model call";
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">{line}</p>
      <ExecutionStrip inv={inv} />
      {inv.answer.trace ? <PipelineTrace trace={inv.answer.trace} compact /> : null}
      {sources.length ? <p className="text-[11px] text-muted-foreground">{sources.length} source{sources.length === 1 ? "" : "s"} · {sources.filter((s) => s.kind === "regulator").length} regulatory · {sources.filter((s) => s.kind === "policy").length} internal</p> : null}
    </div>
  );
}

/** Answer first, evidence second, technical trace third. Everything rendered here is already in the stored investigation. */
export function AnswerDocument({ inv, compact, onAsk, stream = true, onDone }: { inv: Investigation; compact?: boolean; onAsk?: (q: string) => void; stream?: boolean; onDone?: () => void }) {
  const { analysis } = useWorkspace();
  const c = useMemo(() => composeAnswer(inv), [inv]);
  const [done, setDone] = useState(!stream);
  const [copied, setCopied] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const a = inv.answer;
  const streaming = stream && !done;
  const idPrefix = `ans-${inv.id}`;
  const cards = a.documents ?? (a.document ? [a.document] : []);
  const openAnalysis = (d: DocCard) =>
    analysis.open({
      id: d.document_pk, source: d.source, jurisdiction: "IN", document_id: d.circular_number ?? d.document_pk, circular_number: d.circular_number, title: d.title,
      published_date: d.published_date, effective_date: d.effective_date, url: "#", content_hash: "", document_version: 1, processed_at: "", status: d.status, impact: d.impact,
      analysis_id: d.analysis_id, ticket_id: d.ticket_id, ticket_url: d.ticket_url, source_mode: d.source_mode, error: null,
    });
  const copy = async () => {
    await navigator.clipboard?.writeText(c.markdown.replace(/\]\(#src-\d+\)/g, "]"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // the markdown links [n] → #<prefix>-src-n so several answers on one page do not collide
  const body = withMarkers(c.markdown).replace(/\(#src-(\d+)\)/g, `(#${idPrefix}-src-$1)`);
  const listCards = c.mode === "records" && cards.length ? cards : [];

  return (
    <article className="max-w-3xl space-y-1">
      {streaming ? (
        <p className="text-[15px] leading-7">
          <StreamingText text={inv.summary} renderToken={richToken} onDone={() => { setDone(true); onDone?.(); }} />
        </p>
      ) : (
        <>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{body}</ReactMarkdown>
          {c.mode === "trace" && (inv.intent === "pipeline" || inv.question.toLowerCase().includes("walk me through")) && a.trace ? <div className="mt-3"><TraceTimeline trace={a.trace} compact /></div> : null}

          {listCards.length ? (
            <div className="mt-3 space-y-2">
              {listCards.map((d, i) => (
                <DocCardView key={`${i}-${d.document_pk}`} card={d} expanded={!compact && listCards.length === 1} onOpenAnalysis={openAnalysis} />
              ))}
            </div>
          ) : null}
          {a.policy ? (
            <div className="mt-3 rounded-md border border-border">
              <p className="px-3 py-2 text-[11px] text-muted-foreground">v{a.policy.version ?? "—"} · {a.policy.owner ?? "owner —"} · {a.policy.sections.length} sections</p>
              <Accordion className="px-1">
                {a.policy.sections.slice(0, compact ? 4 : 40).map((s, i) => (
                  <AccordionItem key={`${i}-${s.section}`} value={`${i}-${s.section}`}>
                    <AccordionTrigger className="py-2 text-xs">§{s.section}</AccordionTrigger>
                    <AccordionContent><Markdown className="text-[13px]">{s.text}</Markdown></AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ) : null}
          {a.actions?.some((x) => x.kind === "reviews") ? (
            <Button variant="outline" size="sm" className="mt-2" nativeButton={false} render={<Link href="/dashboard/reviews" />}>Open reviews <ArrowUpRight /></Button>
          ) : null}
          {a.actions?.some((x) => x.kind === "scan") ? (
            <Button variant="outline" size="sm" className="mt-2" nativeButton={false} render={<Link href="/dashboard?scan=1" />}>Go to Scan now</Button>
          ) : null}

          <Sources sources={c.sources} open={evidenceOpen} idPrefix={idPrefix} />

          <div className="mt-4 flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void copy()}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}</Button>
            {c.sources.some((s) => s.excerpt) ? <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setEvidenceOpen((o) => !o)}><FileText /> {evidenceOpen ? "Hide evidence" : "View evidence"}</Button> : null}
            {cards[0]?.analysis_id ? <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => openAnalysis(cards[0])}><ListTree /> View analysis</Button> : null}
            <Button variant="ghost" size="xs" className="text-muted-foreground" nativeButton={false} render={<Link href={`/dashboard/investigations/${inv.id}`} />}>Open investigation <ArrowUpRight /></Button>
          </div>

          {onAsk && c.followUps.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {c.followUps.map((q, i) => (
                <Button key={`${i}-${q}`} variant="outline" size="xs" className="rounded-full" onClick={() => onAsk(q)}>{q}</Button>
              ))}
            </div>
          ) : null}

          <div className="mt-4 border-t border-border pt-2">
            <button type="button" onClick={() => setTraceOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className={cn("size-3.5 transition-transform", traceOpen && "rotate-90")} /> How this answer was produced
            </button>
            {traceOpen ? <div className="mt-3"><Provenance inv={inv} sources={c.sources} mode={c.mode} /></div> : null}
          </div>
        </>
      )}
    </article>
  );
}

export function AnswerActions({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
