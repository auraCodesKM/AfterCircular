"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Clock, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Adapted from @spectrumui/recent-activity: same two-column row rhythm, but on the app's
 * semantic tokens (not hard-coded neutrals), no demo items, and rows carry an id/href so
 * the audit log can link each event to its document.
 */
export interface ActivityItem {
  id: string;
  icon?: React.ReactNode;
  title: string;
  /** Small chip next to the title, e.g. the actor. */
  chip?: string;
  description: string;
  /** Right-aligned chip, e.g. "15h". */
  timeAgo?: string;
  timeTitle?: string;
  href?: string;
  tone?: "default" | "human" | "warn" | "bad" | "good";
}

export interface RecentActivityProps {
  title?: string;
  titleIcon?: React.ReactNode;
  headerRight?: React.ReactNode;
  items: ActivityItem[];
  className?: string;
  /** Rendered when `items` is empty. */
  empty?: React.ReactNode;
  /** Wraps the rows (e.g. a scroll container). */
  rowsClassName?: string;
}

function TimeChip({ value, title }: { value: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-5 shrink-0 items-center gap-[3px] rounded-md border border-border bg-background px-[5px] text-[10px] font-medium leading-none text-foreground/80"
    >
      <Clock className="h-3 w-3 text-muted-foreground" />
      {value}
    </span>
  );
}

const toneRing: Record<NonNullable<ActivityItem["tone"]>, string> = {
  default: "border-border text-muted-foreground",
  human: "border-foreground/40 bg-foreground/5 text-foreground",
  warn: "border-warning/50 bg-warning/10 text-warning",
  bad: "border-destructive/50 bg-destructive/10 text-destructive",
  good: "border-success/50 bg-success/10 text-success",
};

export function RecentActivity({ title = "Recent Activity", titleIcon, headerRight, items, className, empty, rowsClassName }: RecentActivityProps) {
  return (
    <div className={cn("w-full rounded-[22px] border border-border bg-muted/50 p-1.5", className)}>
      <div className="overflow-hidden rounded-[16px] border border-border bg-background">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <span className="flex text-foreground/80 [&_svg]:h-4 [&_svg]:w-4">{titleIcon ?? <Workflow />}</span>
          <h3 className="text-[15px] font-semibold leading-none tracking-[-0.3px] text-foreground/90">{title}</h3>
          {headerRight ? <div className="ml-auto flex flex-wrap items-center gap-2">{headerRight}</div> : null}
        </div>

        <div className={rowsClassName}>
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">{empty ?? "Nothing here."}</div>
          ) : null}
          {items.map((item, index) => {
            const Row = item.href ? motion.a : motion.div;
            return (
              <Row
                key={item.id}
                href={item.href}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(index, 20) * 0.02, ease: "easeOut" }}
                className={cn(
                  "flex h-[41px] items-center px-4 transition-colors hover:bg-muted/60",
                  index > 0 && "border-t border-border/60",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-3 sm:w-[260px] sm:flex-none sm:shrink-0">
                  {item.icon ? (
                    <span
                      className={cn(
                        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border [&_svg]:h-3 [&_svg]:w-3",
                        toneRing[item.tone ?? "default"],
                      )}
                    >
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="ml-1 truncate text-xs font-medium tracking-[-0.2px] text-foreground/90">{item.title}</span>
                  {item.chip ? (
                    <span className="hidden h-5 shrink-0 items-center rounded-md border border-border bg-background px-[5px] font-mono text-[10px] leading-none text-muted-foreground md:inline-flex">
                      {item.chip}
                    </span>
                  ) : null}
                </div>
                <div className="hidden min-w-0 flex-1 items-center gap-3 self-stretch border-l border-border/60 pl-4 sm:flex">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={item.description}>
                    {item.description}
                  </span>
                  {item.timeAgo ? <TimeChip value={item.timeAgo} title={item.timeTitle} /> : null}
                </div>
                {item.timeAgo ? (
                  <span className="sm:hidden">
                    <TimeChip value={item.timeAgo} title={item.timeTitle} />
                  </span>
                ) : null}
              </Row>
            );
          })}
        </div>
      </div>
    </div>
  );
}
