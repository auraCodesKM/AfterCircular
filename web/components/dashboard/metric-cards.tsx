import { AlertTriangle, CheckCircle2, ClipboardCheck, HelpCircle, MinusCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "cn";
import type { ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";

export function MetricCards({ documents, reviews }: { documents: ProcessedDocument[]; reviews: ReviewRecord[] }) {
  const n = (f: (d: ProcessedDocument) => boolean) => documents.filter(f).length;
  const pending = reviews.filter((r) => r.status === "AWAITING_REVIEW").length;
  const items = [
    { label: "Needs review", value: pending, Icon: ClipboardCheck, cls: pending ? "text-destructive" : "" },
    { label: "Conflicts", value: n((d) => d.impact === "CONFLICT"), Icon: AlertTriangle, cls: "text-destructive" },
    { label: "Aligned", value: n((d) => d.impact === "ALIGNED"), Icon: CheckCircle2, cls: "text-success" },
    { label: "Not applicable", value: n((d) => d.impact === "NOT_APPLICABLE"), Icon: MinusCircle, cls: "text-muted-foreground" },
    { label: "Uncertain", value: n((d) => d.status === "NEEDS_INVESTIGATION"), Icon: HelpCircle, cls: "text-warning" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {items.map((m) => (
        <Card key={m.label} size="sm" className="gap-0 py-3">
          <CardContent className="px-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <m.Icon aria-hidden className={cn("size-3.5", m.value ? m.cls : "text-muted-foreground/60")} />
            </div>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", m.value ? m.cls : "")}>{m.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
