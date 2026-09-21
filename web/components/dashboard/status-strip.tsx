import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Health, ScanRecord } from "@/lib/pipeline-types";
import { fmtTime } from "./labels";

/** One quiet line of product metadata. Transparent about stubs; never a card. */
export function StatusStrip({ health, scan }: { health: Health | null; scan: ScanRecord | null }) {
  const demo = scan?.source_mode === "DEMO_SNAPSHOT" || (scan == null && health?.sebi_mode === "snapshot");
  const items: { label: string; value: string; help: string; warn?: boolean }[] = [
    { label: "Source", value: demo ? "Demo snapshot" : "SEBI live", help: demo ? "Fictional circulars from data/snapshot, labelled everywhere they appear." : "sebi.gov.in circular listing." },
    { label: "Judgments", value: health?.judge?.default === "typesafe" ? `Jev ${health.judge.model}` : health?.judge?.default === "stub" ? "Stub" : "Foundry", help: "Applicability, relevance, alignment and citation checks — typed, calibrated decisions.", warn: health?.judge?.default === "stub" },
    { label: "Generative", value: health?.ai_provider === "foundry" ? "Foundry" : "Stub", help: "Obligation extraction, memo drafting, reasoning escalation.", warn: health?.ai_provider !== "foundry" },
    { label: "Retrieval", value: health?.retrieval === "azure-ai-search" ? "Azure AI Search" : "Local hybrid", help: "Candidate policy chunks before the relevance judgment." },
    { label: "Last scan", value: fmtTime(scan?.finished_at ?? scan?.started_at, false), help: scan ? `${scan.new_documents} new · ${scan.skipped_documents} already processed` : "No scan yet." },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {demo || health?.ai_provider !== "foundry" ? (
        <>
          <Badge variant="outline" className="border-warning/40 text-warning">
            Demo environment
          </Badge>
          <Separator orientation="vertical" className="!h-3" />
        </>
      ) : null}
      {items.map((it, i) => (
        <span key={it.label} className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-default" />}>
              {it.label} <span className={it.warn ? "font-medium text-warning" : "font-medium text-foreground"}>{it.value}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{it.help}</TooltipContent>
          </Tooltip>
          {i < items.length - 1 ? <Separator orientation="vertical" className="!h-3" /> : null}
        </span>
      ))}
    </div>
  );
}
