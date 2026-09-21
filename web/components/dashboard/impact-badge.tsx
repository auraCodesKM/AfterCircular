import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, MinusCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { impactLabel, type ImpactKind } from "./labels";

const styles: Record<ImpactKind, { cls: string; Icon: typeof AlertTriangle }> = {
  conflict: { cls: "border-destructive/30 bg-destructive/10 text-destructive", Icon: AlertTriangle },
  aligned: { cls: "border-success/30 bg-success/10 text-success", Icon: CheckCircle2 },
  na: { cls: "border-border bg-muted text-muted-foreground", Icon: MinusCircle },
  uncertain: { cls: "border-warning/40 bg-warning/10 text-warning", Icon: HelpCircle },
  failed: { cls: "border-destructive/30 text-destructive", Icon: XCircle },
  pending: { cls: "border-border text-muted-foreground", Icon: CircleDashed },
};

/** Status is never conveyed by colour alone: icon + text always. */
export function ImpactBadge({ kind, className }: { kind: ImpactKind; className?: string }) {
  const { cls, Icon } = styles[kind];
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", cls, className)}>
      <Icon aria-hidden className="size-3" />
      {impactLabel[kind]}
    </Badge>
  );
}
