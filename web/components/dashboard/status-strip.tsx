import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import type { Health, ScanRecord } from "@/lib/pipeline-types";
import { sourceStatus } from "./labels";

/** Environment readout: what feeds the pipeline, as quiet label–value pairs. Transparent about stubs; each pair explains itself on hover. */
export function StatusStrip({ health, scan, className }: { health: Health | null; scan: ScanRecord | null; className?: string }) {
  const src = sourceStatus(scan, health?.sebi_mode);
  const demo = !src.live;
  const model = health?.models?.extraction;
  const items: { label: string; value: string; help: string; warn?: boolean }[] = [
    { label: "Source", value: src.title, help: src.detail, warn: src.warn },
    { label: "AI", value: health?.ai_provider === "foundry" ? `Microsoft Foundry · ${model ?? "deployment"}` : "Stub (no model)", help: "Microsoft Foundry deployment: structured obligation extraction, impact reasoning, memo drafting and Ask narratives, via the Responses API with strict JSON schemas.", warn: health?.ai_provider !== "foundry" },
    { label: "Retrieval", value: health?.retrieval === "azure-ai-search" ? "Azure AI Search" : "Local hybrid", help: `Policy clauses retrieved by hybrid (BM25 + vector) search${health?.models?.embedding ? ` with ${health.models.embedding} embeddings` : ""}.` },
    { label: "Reasoning support", value: health?.judge?.default === "typesafe" ? "Jev" : health?.judge?.default === "stub" ? "Stub" : "Foundry emulation", help: `Typed, calibrated judgments that route and verify: triage, applicability, relevance, alignment, citation checks${health?.judge?.model ? ` (${health.judge.model})` : ""}.`, warn: health?.judge?.default === "stub" },
    { label: "Approval", value: "Human", help: "Nothing external happens until a person approves in Reviews; then AfterCircular opens a GitHub issue." },
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)} aria-label="Environment">
      {demo || health?.ai_provider !== "foundry" ? (
        <li>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex cursor-default items-center gap-1.5 font-medium text-warning" />}>
              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
              Demo
            </TooltipTrigger>
            <TooltipContent className="max-w-64">Demo environment — {demo ? "the regulatory source is the fictional snapshot" : "a fixture stands in for a model"}. Nothing marked demo is real regulatory data.</TooltipContent>
          </Tooltip>
        </li>
      ) : null}
      {items.map((it) => (
        <li key={it.label}>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex cursor-default items-center gap-1" />}>
              {it.label}
              <span className={cn("font-medium", it.warn ? "text-warning" : "text-foreground/90")}>{it.value}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{it.help}</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
