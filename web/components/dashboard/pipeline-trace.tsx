"use client";

import { ChevronRight, Cpu, Database, GitPullRequest, Landmark, Radio, ShieldCheck, Sparkles, UserCheck, Workflow } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { fmtTime } from "./labels";

export type TraceStep = { n: number; service: string; name: string; ran: boolean; detail: Record<string, unknown>; note: string | null };
export type Trace = { document_id: string; analysis_id: string | null; foundry_calls: number; jev_records: number; steps: TraceStep[]; audit_events: { at: string; event: string; actor: string; actor_type: string }[] };

const NA = "Not recorded";
const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : NA);
const secs = (v: unknown) => (typeof v === "number" ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`) : NA);
const str = (v: unknown) => (typeof v === "string" && v ? v : NA);
type Chunk = { doc_id: string; section: string; path?: string; score?: number; commit?: string | null };
type JevStage = { records: number; model: string; latency_ms: number; input_tokens: number; output_tokens: number; outcomes?: unknown[] };

/** Icon + accent per service, so Foundry, Search, Jev, code, human and GitHub are never confused for one another. */
function serviceIcon(service: string) {
  const s = service.toLowerCase();
  if (s.startsWith("sebi")) return <Landmark className="size-3.5" />;
  if (s.startsWith("connector")) return <Radio className="size-3.5" />;
  if (s.includes("foundry") && s.includes("embedding")) return <Sparkles className="size-3.5" />;
  if (s.includes("foundry")) return <Sparkles className="size-3.5" />;
  if (s.includes("search")) return <Database className="size-3.5" />;
  if (s.startsWith("jev")) return <Workflow className="size-3.5" />;
  if (s.includes("gate") || s.includes("prefilter")) return <ShieldCheck className="size-3.5" />;
  if (s.startsWith("human")) return <UserCheck className="size-3.5" />;
  if (s.startsWith("github")) return <GitPullRequest className="size-3.5" />;
  return <Cpu className="size-3.5" />;
}

function badge(service: string): string {
  const s = service.toLowerCase();
  if (s.includes("foundry")) return "Microsoft Foundry";
  if (s.includes("search")) return "Azure AI Search";
  if (s.startsWith("jev")) return "Reasoning support";
  if (s.includes("gate") || s.includes("prefilter")) return "Deterministic";
  if (s.startsWith("human")) return "Human decision";
  if (s.startsWith("github")) return "Side effect";
  if (s.startsWith("sebi")) return "Live source";
  return "Code";
}

/** The one-line facts for each step, from its stored detail only. */
function summary(step: TraceStep): { headline: string; facts: string[] } {
  const d = step.detail;
  const s = step.service.toLowerCase();
  if (s.startsWith("sebi")) return { headline: str(d.reference), facts: [`published ${str(d.published)}`, `${d.source_mode === "LIVE" ? "LIVE · sebi.gov.in" : "DEMO SNAPSHOT · synthetic"}`] };
  if (s.startsWith("connector")) return { headline: `content hash ${typeof d.content_hash === "string" ? d.content_hash.slice(0, 12) + "…" : NA}`, facts: [`fetched ${d.fetched_at ? fmtTime(String(d.fetched_at)) : NA}`] };
  if (s.includes("foundry") && !s.includes("embedding")) {
    return {
      headline: `${str(d.model)} · ${d.api === "responses" ? "Responses API" : str(d.api)} · ${str(d.structured_mode)}`,
      facts: [secs(d.latency_ms), `${num(d.input_tokens)} input → ${num(d.output_tokens)} output tokens`, typeof d.cached_tokens === "number" && d.cached_tokens > 0 ? `${num(d.cached_tokens)} cached` : "", typeof d.estimated_cost_usd === "number" ? `est. $${d.estimated_cost_usd.toFixed(4)}` : "", d.ok === false ? "failed" : "successful", d.context_format === "toon" ? "TOON context" : ""].filter(Boolean),
    };
  }
  if (s.includes("embedding")) return { headline: `${str(d.model)} · query embedding · 1536 dimensions`, facts: [secs(d.embed_ms)] };
  if (s.includes("search")) return { headline: str(d.method), facts: [`k = ${num(d.k)}`, `${num(d.count)} chunks retrieved`, secs(d.search_ms), Array.isArray(d.commits) && d.commits.length ? `corpus @ ${String(d.commits[0]).slice(0, 7)}` : ""].filter(Boolean) };
  if (s.startsWith("jev")) {
    const stages = Object.entries(d).filter(([, v]) => v && typeof v === "object" && "records" in (v as object)) as [string, JevStage][];
    const total = stages.reduce((a, [, v]) => a + (v.records || 0), 0);
    if (stages.length) return { headline: stages.map(([k]) => k.replace(/_/g, " ")).join(" · "), facts: [`${total} typed judgment${total === 1 ? "" : "s"}`, stages[0][1].model, secs(stages.reduce((a, [, v]) => a + (v.latency_ms || 0), 0))] };
    return { headline: `${str(d.outcome)}${typeof d.confidence === "number" ? ` · P=${d.confidence.toFixed(2)}` : ""}`, facts: [d.stage ? `stage: ${String(d.stage)}` : ""].filter(Boolean) };
  }
  if (s.includes("prefilter")) return { headline: `${str(d.outcome)} · addressee match in code`, facts: [] };
  if (s.includes("gate")) return { headline: String(d.outcome ?? NA), facts: [`applicability ${str(d.applicability)}`, `alignment ${d.alignment ? String(d.alignment) : "—"}`, typeof d.confidence === "number" ? `confidence ${Math.round(d.confidence * 100)}%` : "", Array.isArray(d.affected_policies) && d.affected_policies.length ? `affects ${(d.affected_policies as string[]).join(", ")}` : ""].filter(Boolean) };
  if (s.startsWith("human")) return { headline: String(d.status ?? "Approval required"), facts: [d.decided_by ? `by @${String(d.decided_by)} · ${d.decided_at ? fmtTime(String(d.decided_at)) : ""} · actor = ${str(d.actor_type)}` : "No external action has been taken"].filter(Boolean) };
  if (s.startsWith("github")) return { headline: d.issue ? `Issue #${String(d.issue)} created` : "Waiting for human approval", facts: [d.created_at ? fmtTime(String(d.created_at)) : "", d.url ? "" : "No external action"].filter(Boolean) };
  return { headline: "", facts: [] };
}

function Node({ step, last }: { step: TraceStep; last: boolean }) {
  const [open, setOpen] = useState(false);
  const { headline, facts } = summary(step);
  const s = step.service.toLowerCase();
  const gate = s.includes("gate");
  const d = step.detail;
  const chunks = Array.isArray(d.chunks) ? (d.chunks as Chunk[]) : [];
  const failed = d.ok === false;
  const expandable = step.ran && (chunks.length > 0 || s.includes("foundry") || s.startsWith("jev") || s.includes("gate"));
  return (
    <li className={cn("relative flex gap-3", !last && "pb-4")}>
      <span
        className={cn(
          "relative z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
          failed ? "border-destructive/60 bg-destructive/10 text-destructive" : step.ran ? "border-success/50 bg-success/10 text-success" : "border-border bg-card text-muted-foreground",
        )}
        aria-hidden
      >
        {serviceIcon(step.service)}
      </span>
      <div className={cn("min-w-0 flex-1 rounded-lg border px-3 py-2", gate ? "border-foreground/30 bg-muted/40" : "border-border bg-card/60", !step.ran && "border-dashed")}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn("text-sm font-medium", !step.ran && "text-muted-foreground")}>{failed ? "✗" : step.ran ? "✓" : "○"} {step.service}</span>
          <span className="text-xs text-muted-foreground">{step.name}</span>
          <span className="rounded-sm border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">{badge(step.service)}</span>
        </div>
        {step.ran ? (
          <>
            {headline ? <p className={cn("mt-0.5 text-[13px]", gate && "font-semibold")}>{headline}</p> : null}
            {facts.length ? <p className="text-[11px] text-muted-foreground">{facts.join(" · ")}</p> : null}
          </>
        ) : (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{s.startsWith("human") || s.startsWith("github") ? (step.note ?? "Waiting") : `Not run${step.note ? ` — ${step.note}` : ""}`}</p>
        )}
        {step.ran && step.note ? <p className="text-[11px] text-muted-foreground">{step.note}</p> : null}
        {expandable ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} /> {chunks.length ? "View retrieved clauses" : s.startsWith("jev") ? "View judgments" : "View telemetry"}
          </button>
        ) : null}
        {open && chunks.length ? (
          <ol className="mt-2 space-y-1 text-[12px]">
            {chunks.map((c, i) => (
              <li key={`${c.doc_id}-${c.section}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-4 font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
                <Link href={`/dashboard/policies?open=${encodeURIComponent(c.doc_id)}`} className="font-mono text-xs underline-offset-4 hover:underline">{c.doc_id} §{c.section}</Link>
                <span className="text-[11px] text-muted-foreground">{typeof c.score === "number" ? `RRF ${c.score.toFixed(4)}` : ""}{c.path ? ` · ${c.path}` : ""}{c.commit ? ` @ ${c.commit.slice(0, 7)}` : ""}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {open && !chunks.length ? <Telemetry d={d} jev={s.startsWith("jev")} /> : null}
      </div>
    </li>
  );
}

function Telemetry({ d, jev }: { d: Record<string, unknown>; jev: boolean }) {
  if (jev) {
    const stages = Object.entries(d).filter(([, v]) => v && typeof v === "object" && "records" in (v as object)) as [string, JevStage][];
    if (stages.length) {
      return (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          {stages.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
              <dd className="font-mono">{v.records} record{v.records === 1 ? "" : "s"} · {v.model} · {secs(v.latency_ms)} · {num(v.input_tokens)}→{num(v.output_tokens)} tokens{Array.isArray(v.outcomes) && v.outcomes.length ? ` · ${v.outcomes.slice(0, 8).map(String).join(", ")}` : ""}</dd>
            </div>
          ))}
        </dl>
      );
    }
  }
  const rows = Object.entries(d).filter(([k, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object" && !["ok"].includes(k));
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
          <dd className="truncate font-mono" title={String(v)}>{k === "estimated_cost_usd" ? `$${Number(v).toFixed(6)}` : String(v)}</dd>
        </div>
      ))}
      {Array.isArray(d.decision_path) ? (
        <div className="contents">
          <dt className="text-muted-foreground">decision path</dt>
          <dd className="font-mono">{(d.decision_path as string[]).join(" → ") || "—"}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <li className="relative flex items-center gap-3 py-2" aria-hidden>
      <span className="relative z-[1] size-6 shrink-0" />
      <span className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

/** "Used in this analysis" chips: only services with a step that actually ran. */
export function UsedServices({ trace }: { trace: Trace }) {
  const ran = (pred: (s: TraceStep) => boolean) => trace.steps.some((s) => s.ran && pred(s));
  const items: [string, boolean, string][] = [
    ["SEBI", ran((s) => s.service.toLowerCase().startsWith("sebi")), "live source retrieved"],
    ["Microsoft Foundry", ran((s) => s.service.toLowerCase().includes("foundry") && !s.service.toLowerCase().includes("embedding")), `${trace.foundry_calls} call${trace.foundry_calls === 1 ? "" : "s"} in this analysis`],
    ["Azure AI Search", ran((s) => s.service.toLowerCase().includes("search")), "hybrid retrieval"],
    ["Jev", ran((s) => s.service.toLowerCase().startsWith("jev")), `${trace.jev_records} typed judgment${trace.jev_records === 1 ? "" : "s"}`],
    ["Human", ran((s) => s.service.toLowerCase().startsWith("human")), "decision recorded"],
    ["GitHub", ran((s) => s.service.toLowerCase().startsWith("github")), "issue created after approval"],
  ];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map(([name, used, why]) => (
        <li key={name} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]", used ? "border-success/40 text-foreground" : "border-border text-muted-foreground")}>
          <span className={used ? "text-success" : ""}>{used ? "✓" : "○"}</span> {name}
          <span className="text-muted-foreground">· {used ? why : "not used"}</span>
        </li>
      ))}
    </ul>
  );
}

export function useTrace(documentPk: string) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<Trace>(`documents/${documentPk}/trace`)
      .then((t) => !cancelled && setTrace(t))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [documentPk]);
  return { trace, error };
}

/** The persisted run as a connected timeline. AI analysis above the divider; the human decision and its side effect below it. */
export function PipelineTrace({ documentPk, header }: { documentPk: string; header?: ReactNode }) {
  const { trace, error } = useTrace(documentPk);
  if (error) return <p className="text-xs text-destructive">Trace unavailable: {error}</p>;
  if (!trace) return <Skeleton className="h-24 w-full" />;
  const ai = trace.steps.filter((s) => !s.service.toLowerCase().startsWith("human") && !s.service.toLowerCase().startsWith("github"));
  const human = trace.steps.filter((s) => s.service.toLowerCase().startsWith("human") || s.service.toLowerCase().startsWith("github"));
  return (
    <div className="space-y-3">
      {header}
      <UsedServices trace={trace} />
      <ol className="relative before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-border">
        <Divider label="AI analysis" />
        {ai.map((s, i) => (
          <Node key={s.n} step={s} last={i === ai.length - 1} />
        ))}
        <Divider label="Human decision" />
        {human.map((s, i) => (
          <Node key={s.n} step={s} last={i === human.length - 1} />
        ))}
      </ol>
      <p className="text-[11px] text-muted-foreground">Every node is read from stored rows (model calls with Foundry response ids, Jev decision records, retrieval metrics, audit events). A dashed node did not run and says why.</p>
    </div>
  );
}
