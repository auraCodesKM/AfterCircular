import type { ReactNode } from "react";
import { cn } from "cn";

/** Section title row: heading, optional count, one-line description, action on the right. No borders — spacing does the grouping. */
export function SectionHeader({ title, count, description, action, icon, as: Tag = "h2", className }: { title: ReactNode; count?: number | string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; as?: "h2" | "h3"; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-3 gap-y-1", className)}>
      <div className="min-w-0">
        <Tag className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] font-semibold tracking-tight text-foreground">
          {icon ? <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
          <span>{title}</span>
          {count !== undefined ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{count}</span> : null}
        </Tag>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}
