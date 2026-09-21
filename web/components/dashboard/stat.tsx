import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";
import { CountUp } from "./count-up";

export type StatTone = "default" | "destructive" | "warning" | "success";

const toneDot: Record<StatTone, string> = {
  default: "bg-muted-foreground/35",
  destructive: "bg-destructive",
  warning: "bg-warning",
  success: "bg-success",
};

/** One metric in a StatGrid: small label with a tone dot, a large number, one line of context. Only "needs you" turns the number red; everything else stays quiet. */
export function Stat({ label, value, hint, tone = "default", href, icon, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: StatTone; href?: string; icon?: ReactNode; className?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", toneDot[tone])} />
        <span className="truncate">{label}</span>
        {icon ? <span className="ml-auto flex text-muted-foreground/70 [&_svg]:size-3.5">{icon}</span> : null}
      </div>
      <p className={cn("mt-2.5 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums", tone === "destructive" ? "text-destructive" : "text-foreground")}>{typeof value === "number" ? <CountUp value={value} /> : value}</p>
      {hint ? <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const cls = cn("flex min-w-0 flex-col bg-card px-5 py-4 text-left", href && "transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** One panel, hairline-divided: the 1px gap over a border-coloured background draws the dividers in any column count. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4", className)}>{children}</dl>;
}
