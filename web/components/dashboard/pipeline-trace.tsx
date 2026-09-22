"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";

type Step = { n: number; service: string; name: string; ran: boolean; detail: Record<string, unknown>; note: string | null };
type Trace = { foundry_calls: number; jev_records: number; steps: Step[] };

const fmt = (k: string, v: unknown): string | null => {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
  if (k === "chunks" && Array.isArray(v)) return `${v.length} chunks: ` + (v as { doc_id: string; section: string }[]).slice(0, 6).map((c) => `${c.doc_id} §${c.section}`).join(", ");
  if (typeof v === "object") return null;
  if (k === "estimated_cost_usd") return `est. $${Number(v).toFixed(4)}`;
  if (k.endsWith("_ms")) return `${k.replace(/_ms$/, "")} ${v} ms`;
  if (k === "latency_ms") return `${v} ms`;
  return `${k.replace(/_/g, " ")}: ${typeof v === "string" && v.length > 70 ? v.slice(0, 70) + "…" : String(v)}`;
};

/** The persisted run, step by step: which service ran, with the stored telemetry — steps that did not run say so. */
export function PipelineTrace({ documentPk }: { documentPk: string }) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || trace) return;
    let cancelled = false;
    api<Trace>(`documents/${documentPk}/trace`)
      .then((t) => !cancelled && setTrace(t))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open, trace, documentPk]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        <span className="shrink-0 font-medium">Pipeline trace</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">SEBI → Jev → Microsoft Foundry → Azure AI Search → gate → human → GitHub, from persisted telemetry</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 px-4 pt-1 pb-4 sm:pl-10">
          {error ? <p className="text-xs text-destructive">Trace unavailable: {error}</p> : null}
          {!trace && !error ? <Skeleton className="h-4 w-1/2" /> : null}
          {trace ? (
            <>
              <p className="text-xs text-muted-foreground">
                {trace.foundry_calls} Microsoft Foundry call{trace.foundry_calls === 1 ? "" : "s"} · {trace.jev_records} Jev decision record{trace.jev_records === 1 ? "" : "s"}. Each step below is read from the stored rows; a step that did not run is marked as such.
              </p>
              <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[9px] before:w-px before:bg-border">
                {trace.steps.map((s) => {
                  const lines = Object.entries(s.detail).map(([k, v]) => fmt(k, v)).filter(Boolean) as string[];
                  return (
                    <li key={s.n} className="relative flex gap-3 text-sm">
                      <span className={`relative z-[1] mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] tabular-nums ${s.ran ? "border-success/50 bg-success/10 text-success" : "border-border bg-card text-muted-foreground"}`}>{s.n}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className={s.ran ? "font-medium" : "font-medium text-muted-foreground"}>{s.service}</span>
                          <span className="text-xs text-muted-foreground">{s.name}</span>
                          {!s.ran ? <span className="text-xs text-muted-foreground">· did not run</span> : null}
                        </div>
                        {s.note ? <p className="text-xs text-muted-foreground">{s.note}</p> : null}
                        {lines.length ? <p className="text-xs text-muted-foreground break-words">{lines.join(" · ")}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
