"use client";

import { ChevronRight, Database, GitPullRequest, Landmark, Radio, ShieldCheck, Sparkles, UserCheck, Waypoints, Workflow } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import type { Trace, TraceStep } from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";
import { fmtTime } from "./labels";

const NA = "not recorded";
const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : NA);
const dur = (v: unknown) => (typeof v === "number" ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`) : NA);
const usd = (v: unknown) => (typeof v === "number" ? `$${v.toFixed(4)}` : NA);

const ICON: Record<TraceStep["actor"], ReactNode> = {
  regulator: <Landmark className="size-3.5" />, connector: <Radio className="size-3.5" />, deterministic: <ShieldCheck className="size-3.5" />, jev: <Workflow className="size-3.5" />,
  foundry: <Sparkles className="size-3.5" />, embedding: <Waypoints className="size-3.5" />, azure_search: <Database className="size-3.5" />, human: <UserCheck className="size-3.5" />, github: <GitPullRequest className="size-3.5" />,
};
const GROUP_LABEL: Record<TraceStep["group"], string> = { source: "Source", reasoning: "Reasoning", decision: "Decision", action: "Action" };
const MARK: Record<TraceStep["status"], string> = { completed: "✓", skipped: "○", failed: "✗", awaiting_approval: "●", blocked: "○" };

type Jev = { stage: string; records: number; model: string; latency_ms: number; input_tokens: number; output_tokens: number; questions: number; decision?: string; reason?: string; items?: Record<string, unknown>[]; conflicts?: number };
type Chunk = { rank: number; doc_id: string; section: string; path?: string; score?: number; commit?: string | null };

function Row({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono")}>{v}</dd>
    </div>
  );
}

/** Technical drawer for one step — every value is the persisted one; missing values read "not recorded". */
function Drawer({ step }: { step: TraceStep }) {
  const t = step.telemetry as Record<string, unknown>;
  const d = step.details as Record<string, unknown>;
  if (step.actor === "foundry") {
    const cc = t.context_comparison as Record<string, unknown> | undefined;
    return (
      <div className="space-y-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <Row k="provider" v={String(t.provider ?? NA)} mono={false} /><Row k="model" v={String(t.model ?? NA)} /><Row k="API" v={String(t.api ?? NA)} mono={false} />
          <Row k="structured output" v={t.structured_mode === "json_schema" ? "JSON Schema (strict)" : String(t.structured_mode ?? NA)} mono={false} />
          <Row k="response id" v={String(t.response_id ?? NA)} /><Row k="latency" v={dur(t.latency_ms)} />
          <Row k="input tokens" v={num(t.input_tokens)} /><Row k="output tokens" v={num(t.output_tokens)} /><Row k="cached tokens" v={num(t.cached_tokens)} />
          <Row k="estimated cost" v={`${usd(t.estimated_cost_usd)}${typeof t.estimated_cost_usd === "number" ? " · list-price estimate, not an Azure invoice" : ""}`} />
          <Row k="attempts" v={num(t.attempts)} /><Row k="timestamp" v={t.at ? fmtTime(String(t.at)) : NA} mono={false} />
          <Row k="status" v={t.ok === false ? `failed · ${String(t.error ?? "")}` : "successful"} mono={false} />
          <Row k="context encoding" v={String(t.context_format ?? NA)} />
        </dl>
        {cc ? (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]" title={String(cc.note)}>
            <p className="font-medium">Context efficiency · serialization comparison · same payload</p>
            <p>compact JSON {num(cc.compact_json_tokens)} tokens → {String(cc.as_sent_format).toUpperCase()} {num(cc.as_sent_tokens)} tokens · saved {num(cc.saved_tokens)} ({String(cc.saved_pct)}%)</p>
            <p className="text-muted-foreground">Structural overhead of the structured context only, counted with the same tokenizer. Not provider billing: the model&rsquo;s billed input tokens are the figure above.</p>
          </div>
        ) : t.context_format === "toon" || t.context_format === "mixed" ? (
          <p className="text-[11px] text-muted-foreground">TOON context used · token savings comparison unavailable for this run.</p>
        ) : null}
        {Array.isArray(d.obligations) && d.obligations.length ? (
          <ol className="space-y-0.5 text-[11px]">
            {(d.obligations as { section?: string; requirement?: string }[]).map((o, i) => (
              <li key={i}><span className="font-mono text-muted-foreground">§{o.section ?? "?"}</span> {o.requirement}</li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  }
  if (step.actor === "jev") {
    const stages = Object.values(t).filter((v): v is Jev => !!v && typeof v === "object" && "records" in (v as object));
    const single = "records" in t ? [t as unknown as Jev] : stages;
    return (
      <div className="space-y-2 text-[11px]">
        {single.map((j) => (
          <div key={j.stage} className="rounded-md border border-border p-2">
            <p className="font-medium uppercase tracking-wide">{j.stage.replace(/_/g, " ")}</p>
            {j.decision ? <p>→ {j.decision}</p> : null}
            {j.reason ? <p className="text-muted-foreground">{j.reason}</p> : null}
            <p className="text-muted-foreground">{j.model} · {j.records} record{j.records === 1 ? "" : "s"} · {j.questions} typed judgment{j.questions === 1 ? "" : "s"} · {dur(j.latency_ms)} · {num(j.input_tokens)}→{num(j.output_tokens)} tokens</p>
            {Array.isArray(j.items) && j.items.length ? (
              <ul className="mt-1 space-y-0.5 font-mono">
                {j.items.slice(0, 12).map((it, i) => (
                  <li key={i}>{Object.entries(it).map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : String(v)}`).join(" · ")}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        <p className="text-muted-foreground">Model judgments route the case; they do not authorize an action.</p>
      </div>
    );
  }
  if (step.actor === "azure_search") {
    const chunks = (d.chunks as Chunk[] | undefined) ?? [];
    return (
      <div className="space-y-2 text-[11px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <Row k="service" v={String(t.backend ?? NA)} /><Row k="method" v={String(t.method ?? NA)} mono={false} /><Row k="k" v={num(t.k)} /><Row k="retrieved" v={num(t.count)} />
          <Row k="latency" v={dur(t.latency_ms)} /><Row k="tenant filter" v={String(t.tenant_filter ?? NA)} />
          <Row k="corpus commit" v={Array.isArray(t.corpus_commits) && t.corpus_commits.length ? String(t.corpus_commits[0]) : NA} /><Row k="timestamp" v={t.at ? fmtTime(String(t.at)) : NA} mono={false} />
        </dl>
        {chunks.length ? (
          <ol className="space-y-0.5">
            {chunks.map((c) => (
              <li key={`${c.doc_id}-${c.section}-${c.rank}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-6 font-mono text-muted-foreground">#{c.rank}</span>
                <Link href={`/dashboard/policies?open=${encodeURIComponent(c.doc_id)}`} className="font-mono underline-offset-4 hover:underline">{c.doc_id} §{c.section}</Link>
                <span className="text-muted-foreground">{typeof c.score === "number" ? `RRF ${c.score.toFixed(4)}` : ""}{c.path ? ` · ${c.path}` : ""}{c.commit ? ` @ ${String(c.commit).slice(0, 7)}` : ""}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  }
  const rows = Object.entries({ ...t, ...d }).filter(([, v]) => v !== null && v !== undefined && v !== "" && (typeof v !== "object" || Array.isArray(v)));
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
      {rows.map(([k, v]) => (
        <Row key={k} k={k.replace(/_/g, " ")} v={Array.isArray(v) ? v.join(" → ") || "—" : k.endsWith("_at") ? fmtTime(String(v)) : k === "url" || k === "pdf_url" ? <a href={String(v)} target="_blank" rel="noreferrer" className="underline underline-offset-2">{String(v)}</a> : String(v)} />
      ))}
    </dl>
  );
}

function Node({ step, last, compact }: { step: TraceStep; last: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const done = step.status === "completed";
  const gate = step.actor === "deterministic" && step.id === "gate";
  const tone = step.status === "failed" ? "border-destructive/60 bg-destructive/10 text-destructive" : done ? "border-success/50 bg-success/10 text-success" : step.status === "awaiting_approval" ? "border-warning/60 bg-warning/10 text-warning" : "border-border bg-card text-muted-foreground";
  const hasDrawer = done || step.status === "failed";
  const drawerLabel = step.actor === "azure_search" ? "View retrieved clauses" : step.actor === "jev" ? "View judgments" : "View telemetry";
  return (
    <li className={cn("relative flex gap-3", !last && "pb-3")}>
      <span className={cn("relative z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border", tone)} aria-hidden>{ICON[step.actor]}</span>
      <div className={cn("min-w-0 flex-1 rounded-lg border px-3 py-2", gate ? "border-foreground/30 bg-muted/40" : "border-border bg-card/60", (step.status === "skipped" || step.status === "blocked") && "border-dashed")}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[10px] text-muted-foreground">{String(step.order).padStart(2, "0")}</span>
          <span className={cn("text-sm font-medium", !done && step.status !== "awaiting_approval" && "text-muted-foreground")}>{MARK[step.status]} {step.name}</span>
          <span className="text-xs text-muted-foreground">{step.operation}</span>
          <span className="rounded-sm border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">{step.role}</span>
          {typeof step.latency_ms === "number" && done ? <span className="ml-auto font-mono text-[11px] text-muted-foreground">{dur(step.latency_ms)}</span> : null}
        </div>
        <p className={cn("mt-0.5 text-[13px]", gate && done && "font-semibold", !done && "text-muted-foreground")}>{step.summary}</p>
        {step.reason && !compact ? (
          <p className="text-[11px] text-muted-foreground"><span className="font-medium">{done ? "Why it ran:" : "Why not:"}</span> {step.reason}</p>
        ) : null}
        {hasDrawer && !compact ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} /> {drawerLabel}
          </button>
        ) : null}
        {open ? <div className="mt-2"><Drawer step={step} /></div> : null}
      </div>
    </li>
  );
}

function GroupDivider({ label }: { label: string }) {
  return (
    <li className="relative flex items-center gap-3 py-1.5" aria-hidden>
      <span className="relative z-[1] size-6 shrink-0" />
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

/** Execution summary: counts and latency by actor, all from the trace summary the backend computed from stored rows. */
export function ExecutionSummary({ trace }: { trace: Trace }) {
  const s = trace.summary;
  const l = s.latency;
  const items: [string, string][] = [
    ["Stages", `${s.stages} · ${s.completed} executed · ${s.skipped} skipped${s.failed ? ` · ${s.failed} failed` : ""}${s.awaiting_approval ? ` · ${s.awaiting_approval} awaiting approval` : ""}${s.blocked ? ` · ${s.blocked} blocked` : ""}`],
    ["Microsoft Foundry", `${s.foundry_calls} call${s.foundry_calls === 1 ? "" : "s"} · ${num(s.foundry_tokens.input)} → ${num(s.foundry_tokens.output)} tokens${s.foundry_tokens.cached ? ` · ${num(s.foundry_tokens.cached)} cached` : ""} · ${dur(l.foundry_ms)}`],
    ["Jev", `${s.jev_judgments} typed judgment${s.jev_judgments === 1 ? "" : "s"} in ${s.jev_decision_records} record${s.jev_decision_records === 1 ? "" : "s"} · ${dur(l.jev_ms)}`],
    ["Azure AI Search", s.azure_search_retrievals ? `${num(s.azure_search_results)} results · ${dur(l.azure_search_ms)} · embedding ${dur(l.embedding_ms)}` : "not run"],
    ["Impact Gate", s.deterministic_gate ? `${trace.outcome}` : "not reached"],
    ["Estimated cost", s.estimated_cost_usd !== null ? `${usd(s.estimated_cost_usd)} · ${s.pricing}` : NA],
  ];
  if (s.context_comparison) items.push(["Context efficiency", `compact JSON ${num(s.context_comparison.compact_json_tokens)} → sent ${num(s.context_comparison.as_sent_tokens)} tokens · ${num(s.context_comparison.saved_tokens)} saved (${s.context_comparison.saved_pct}%) · same-payload serialization comparison, not billing`]);
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs sm:grid-cols-[auto_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono text-[11px]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Used in this analysis" chips: lit only when a step with that actor completed. */
export function UsedServices({ trace }: { trace: Trace }) {
  const used = (a: TraceStep["actor"]) => trace.steps.some((s) => s.actor === a && s.status === "completed");
  const items: [string, boolean, string][] = [
    ["SEBI", used("regulator"), "live source retrieved"],
    ["Microsoft Foundry", used("foundry"), `${trace.summary.foundry_calls} call${trace.summary.foundry_calls === 1 ? "" : "s"} in this analysis`],
    ["Azure AI Search", used("azure_search"), "hybrid retrieval"],
    ["Jev", used("jev"), `${trace.summary.jev_judgments} typed judgments`],
    ["Impact Gate", used("deterministic") && trace.summary.deterministic_gate > 0, "deterministic"],
    ["Human", used("human"), "decision recorded"],
    ["GitHub", used("github"), "issue created after approval"],
  ];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map(([name, on, why]) => (
        <li key={name} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]", on ? "border-success/40 text-foreground" : "border-border text-muted-foreground")}>
          <span className={on ? "text-success" : ""}>{on ? "✓" : "○"}</span> {name}<span className="text-muted-foreground">· {on ? why : "not used"}</span>
        </li>
      ))}
    </ul>
  );
}

export function useTrace(documentPk: string | null) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!documentPk) return;
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

/** The persisted run as a grouped, connected timeline: Source → Reasoning → Decision → Action. */
export function TraceTimeline({ trace, compact }: { trace: Trace; compact?: boolean }) {
  const groups: TraceStep["group"][] = ["source", "reasoning", "decision", "action"];
  return (
    <ol className="relative before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-border">
      {groups.map((g) => {
        const steps = trace.steps.filter((s) => s.group === g);
        return steps.length ? (
          <li key={g} className="list-none">
            <ol>
              <GroupDivider label={GROUP_LABEL[g]} />
              {steps.map((s, i) => (
                <Node key={s.id} step={s} last={i === steps.length - 1} compact={compact} />
              ))}
            </ol>
          </li>
        ) : null;
      })}
    </ol>
  );
}

export function PipelineTrace({ documentPk, trace: given, compact }: { documentPk?: string; trace?: Trace; compact?: boolean }) {
  const { trace: fetched, error } = useTrace(given ? null : (documentPk ?? null));
  const trace = given ?? fetched;
  if (error) return <p className="text-xs text-destructive">Trace unavailable: {error}</p>;
  if (!trace) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="space-y-3">
      {!compact ? <ExecutionSummary trace={trace} /> : null}
      <UsedServices trace={trace} />
      <TraceTimeline trace={trace} compact={compact} />
      {!compact ? <p className="text-[11px] text-muted-foreground">Every node is read from stored rows — model calls with Foundry response ids, Jev decision records, retrieval metrics, audit events. A dashed node did not run and says why.</p> : null}
    </div>
  );
}
