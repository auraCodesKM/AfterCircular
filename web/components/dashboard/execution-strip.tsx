"use client";

import { Check, Cpu, Database, FileSearch, Globe, ShieldBan, Sparkles, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import type { Investigation } from "@/lib/pipeline-types";

const ms = (v?: number | null) => (v === undefined || v === null ? "not recorded" : `${v} ms`);
const tok = (i?: number | null, o?: number | null) => (i === undefined || i === null ? "tokens not recorded" : `${i.toLocaleString()}→${(o ?? 0).toLocaleString()} tokens`);

type Step = { icon: ReactNode; service: string; op: string; meta?: string };

/** What actually ran for this answer, step by step, from the recorded routing/judgment/narrative telemetry. Steps that did not happen are not shown. */
export function ExecutionStrip({ inv }: { inv: Investigation }) {
  const r = inv.answer.reasoning;
  const route = r?.jev_route;
  const jevOk = inv.judge.provider === "typesafe";
  const steps: Step[] = [];
  steps.push({
    icon: <Workflow className="size-3.5" />,
    service: jevOk ? "Jev · reasoning support" : "Keyword routing (no model)",
    op: `Intent: ${inv.intent}`,
    meta: jevOk && route ? `${route.model ?? "jev"} · ${ms(route.latency_ms)} · ${tok(route.input_tokens, route.output_tokens)}${route.note ? ` · ${route.note}` : ""}` : route?.error ? `Jev unavailable: ${route.error}` : undefined,
  });
  if (!r) return <Strip steps={steps} />;
  if (r.kind === "refused") {
    steps.push({ icon: <ShieldBan className="size-3.5" />, service: "Review gate", op: "Refused — actions need human approval", meta: "Ask reads and reasons only; approving and opening issues happen in Reviews under your GitHub login." });
    return <Strip steps={steps} />;
  }
  if (r.kind === "web_search") {
    const n = r.narrative;
    steps.push({ icon: <Globe className="size-3.5" />, service: "Microsoft Foundry Web Search", op: `Domains: ${(n?.allowed_domains ?? []).join(", ") || "—"} · discovery only`, meta: n && !n.error ? `${n.model ?? ""} · ${ms(n.latency_ms)} · ${tok(n.input_tokens, n.output_tokens)}${n.response_id ? ` · ${n.response_id}` : ""}` : n?.error });
    return <Strip steps={steps} />;
  }
  const focus = r.focus;
  const selected = r.cited?.length ? r.cited : focus ? [focus.record] : [];
  steps.push({
    icon: <FileSearch className="size-3.5" />,
    service: "Records selected",
    op: selected.length ? selected.join(", ") : "none",
    meta: focus ? `Focus: ${focus.document_id} — ${focus.title}${focus.analysis_id ? ` · ${focus.analysis_id}` : ""}` : `${r.sources} workspace record${r.sources === 1 ? "" : "s"}`,
  });
  if (r.kind === "jev_reasoning") {
    const j = r.jev_judgments;
    steps.push({
      icon: <Database className="size-3.5" />,
      service: "Evidence assembled",
      op: r.evidence ? `${r.evidence.regulatory} regulatory excerpt${r.evidence.regulatory === 1 ? "" : "s"} · ${r.evidence.policy} policy section${r.evidence.policy === 1 ? "" : "s"}${r.evidence.obligations ? ` · ${r.evidence.obligations} obligations` : ""}` : "from the stored analyses",
      meta: j && !j.error ? `Jev typed judgments: ${j.questions ?? "?"} (${j.model ?? "jev"}, ${ms(j.latency_ms)}, ${tok(j.input_tokens, j.output_tokens)})` : j?.error ? `judgments unavailable: ${j.error}` : undefined,
    });
    const n = r.narrative;
    steps.push({
      icon: n && !n.error ? <Sparkles className="size-3.5" /> : <Cpu className="size-3.5" />,
      service: n && !n.error ? `Microsoft Foundry · ${n.model ?? ""}` : "Composed from judgments",
      op: n && !n.error ? "Answer generated · every claim validated against record ids" : `no narrative model${n?.error ? `: ${n.error}` : ""}`,
      meta: n && !n.error ? `${n.structured_mode ?? "?"} · ${ms(n.latency_ms)} · ${tok(n.input_tokens, n.output_tokens)}${n.estimated_cost_usd !== undefined && n.estimated_cost_usd !== null ? ` · est. $${n.estimated_cost_usd.toFixed(4)}` : ""}${n.response_id ? ` · ${n.response_id}` : ""}${r.dropped_uncited?.length ? ` · ${r.dropped_uncited.length} uncited claim(s) dropped` : ""}` : undefined,
    });
  } else {
    steps.push({ icon: <Check className="size-3.5" />, service: "Answer assembled from records", op: r.kind === "clarify" ? "Needs clarification" : "Deterministic · no generated text, no model call" });
  }
  return <Strip steps={steps} />;
}

function Strip({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative space-y-2 text-[11px] text-muted-foreground before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-px before:bg-border">
      {steps.map((s, i) => (
        <li key={i} className="relative flex gap-2.5">
          <span className="relative z-[1] mt-px flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground/70">{s.icon}</span>
          <div className="min-w-0">
            <p><span className="font-medium text-foreground/80">{s.service}</span> · {s.op}</p>
            {s.meta ? <p className="truncate" title={s.meta}>{s.meta}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
