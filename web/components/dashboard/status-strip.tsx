import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import type { Health, ScanRecord } from "@/lib/pipeline-types";

/** Environment readout: what feeds the pipeline, as quiet label–value pairs. Transparent about stubs; each pair explains itself on hover. */
export function StatusStrip({ health, scan, className }: { health: Health | null; scan: ScanRecord | null; className?: string }) {
  const demo = scan?.source_mode === "DEMO_SNAPSHOT" || (scan == null && health?.sebi_mode === "snapshot");
  const items: { label: string; value: string; help: string; warn?: boolean }[] = [
    { label: "Source", value: demo ? "Demo snapshot" : "SEBI live", help: demo ? "Fictional circulars from data/snapshot, labelled everywhere they appear." : "sebi.gov.in circular listing.", warn: demo },
    { label: "Judgments", value: health?.judge?.default === "typesafe" ? "Jev" : health?.judge?.default === "stub" ? "Stub" : "Foundry", help: `Applicability, relevance, alignment and citation checks — typed, calibrated decisions${health?.judge?.model ? ` (${health.judge.model})` : ""}.`, warn: health?.judge?.default === "stub" },
    { label: "Generative", value: health?.ai_provider === "foundry" ? "Foundry" : "Stub", help: "Obligation extraction, memo drafting, reasoning escalation.", warn: health?.ai_provider !== "foundry" },
    { label: "Retrieval", value: health?.retrieval === "azure-ai-search" ? "Azure AI Search" : "Local hybrid", help: "Candidate policy chunks before the relevance judgment." },
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
            <TooltipContent className="max-w-64">Demo environment — fixtures stand in for the live source or a model. Nothing here is real regulatory data.</TooltipContent>
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
