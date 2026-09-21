import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Health, ScanRecord } from "@/lib/pipeline-types";

/** Compact, honest statement of what is real and what is stubbed. Never hides a stub. */
export function SystemStatus({ health, scan, backendError }: { health: Health | null; scan: ScanRecord | null; backendError: string | null }) {
  if (backendError) {
    return (
      <Alert variant="destructive">
        <Info />
        <AlertTitle>Backend unavailable</AlertTitle>
        <AlertDescription>{backendError}</AlertDescription>
      </Alert>
    );
  }
  const source = scan?.source_mode === "LIVE" ? "Live · sebi.gov.in" : scan?.source_mode === "DEMO_SNAPSHOT" ? "Demo snapshot" : health?.sebi_mode === "snapshot" ? "Demo snapshot" : "Live · sebi.gov.in";
  const ai = health?.ai_provider === "foundry" ? "Microsoft Foundry" : "Stub — no generative model calls";
  const judge = health?.judge?.default === "typesafe" ? `Jev · ${health.judge.model}` : health?.judge?.default === "foundry" ? "Foundry (uncalibrated)" : "Stub — no judgment calls";
  const retrieval = health?.retrieval === "azure-ai-search" ? "Azure AI Search" : "Local hybrid (BM25 + vector)";
  const demo = source.startsWith("Demo") || health?.ai_provider === "stub" || health?.judge?.default === "stub";
  const items: [string, string, string][] = [
    ["Source", source, "Where circulars come from. The demo snapshot is fictional and labelled everywhere it appears."],
    ["Generative AI", ai, "Obligation extraction, memo drafting and the reasoning rung of the cascade."],
    ["Judgments", judge, "Typed decisions: applicability, relevance, alignment, citation check. Calibrated probabilities from System One."],
    ["Retrieval", retrieval, "Candidate policy chunks before the relevance judgment."],
  ];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card text-sm sm:flex-row sm:items-center">
      {demo ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-warning sm:border-r sm:border-b-0">
          <Info aria-hidden className="size-3.5" />
          Demo environment
        </div>
      ) : null}
      <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2 md:grid-cols-4">
        {items.map(([k, v, help]) => (
          <div key={k} className="min-w-0">
            <Tooltip>
              <TooltipTrigger render={<dt className="cursor-default text-[11px] text-muted-foreground" />}>{k}</TooltipTrigger>
              <TooltipContent className="max-w-64">{help}</TooltipContent>
            </Tooltip>
            <dd className={`truncate text-xs font-medium ${v.startsWith("Stub") ? "text-warning" : ""}`} title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
