"use client";

import {
  Archive,
  ArrowDownUp,
  BadgeCheck,
  BookOpenText,
  Bug,
  CircleDot,
  CircleHelp,
  DatabaseZap,
  FileDiff,
  FilePlus2,
  History,
  ListChecks,
  OctagonX,
  PenLine,
  Radar,
  Scale,
  ScanSearch,
  Search,
  ShieldAlert,
  SkipForward,
  ThumbsDown,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RecentActivity, type ActivityItem } from "@/components/spectrumui/recent-activity";
import type { AuditEvent } from "@/lib/pipeline-types";
import { eventDetail } from "./activity-feed";
import { eventLabel, fmtTime, relTime } from "./labels";

const ICON: Record<string, [LucideIcon, ActivityItem["tone"]]> = {
  SCAN_STARTED: [Radar, "default"],
  SCAN_COMPLETED: [ScanSearch, "default"],
  SCAN_FAILED: [OctagonX, "bad"],
  DOCUMENT_DETECTED: [FilePlus2, "default"],
  DOCUMENT_VERSION_DETECTED: [FileDiff, "warn"],
  DOCUMENT_SKIPPED: [SkipForward, "default"],
  OBLIGATIONS_EXTRACTED: [ListChecks, "default"],
  POLICIES_INDEXED: [DatabaseZap, "default"],
  POLICIES_RETRIEVED: [BookOpenText, "default"],
  IMPACT_ANALYZED: [Scale, "default"],
  CONFLICT_DETECTED: [TriangleAlert, "warn"],
  NEEDS_INVESTIGATION: [CircleHelp, "warn"],
  MEMO_GENERATED: [PenLine, "default"],
  REVIEW_REQUESTED: [ShieldAlert, "warn"],
  APPROVED: [BadgeCheck, "good"],
  REJECTED: [ThumbsDown, "human"],
  TICKET_CREATED: [CircleDot, "good"],
  ARCHIVED: [Archive, "default"],
  PIPELINE_FAILED: [Bug, "bad"],
};

const ROUTINE = new Set(["DOCUMENT_SKIPPED", "POLICIES_RETRIEVED"]);

type Sort = "newest" | "oldest" | "type" | "actor";
const SORTS: Record<Sort, string> = { newest: "Newest first", oldest: "Oldest first", type: "By event type", actor: "By actor" };
const WHO: Record<string, string> = { all: "Everyone", human: "Humans", agent: "Agents", system: "System" };

export function ActivityLog({ events }: { events: AuditEvent[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [who, setWho] = useState("all");
  const [type, setType] = useState("all");
  const [routine, setRoutine] = useState(false);

  const typeItems = useMemo(() => {
    const m: Record<string, string> = { all: "All events" };
    for (const t of Array.from(new Set(events.map((e) => e.event_type))).sort()) m[t] = eventLabel[t] ?? t;
    return m;
  }, [events]);

  const items = useMemo<ActivityItem[]>(() => {
    const needle = q.trim().toLowerCase();
    const rows = events
      .map((e) => ({ e, title: eventLabel[e.event_type] ?? e.event_type, desc: eventDetail(e) }))
      .filter(({ e }) => routine || !ROUTINE.has(e.event_type))
      .filter(({ e }) => who === "all" || e.actor_type === who)
      .filter(({ e }) => type === "all" || e.event_type === type)
      .filter(({ e, title, desc }) => !needle || `${title} ${desc} ${e.actor} ${e.document_pk ?? ""}`.toLowerCase().includes(needle));
    rows.sort((a, b) => {
      if (sort === "oldest") return a.e.timestamp.localeCompare(b.e.timestamp);
      if (sort === "type") return a.title.localeCompare(b.title) || b.e.timestamp.localeCompare(a.e.timestamp);
      if (sort === "actor") return a.e.actor.localeCompare(b.e.actor) || b.e.timestamp.localeCompare(a.e.timestamp);
      return b.e.timestamp.localeCompare(a.e.timestamp);
    });
    return rows.map(({ e, title, desc }) => {
      const [Icon, tone] = ICON[e.event_type] ?? [History, "default"];
      return {
        id: e.id,
        icon: <Icon />,
        tone: e.actor_type === "human" && tone === "default" ? "human" : tone,
        title,
        chip: e.actor_type === "human" ? `@${e.actor}` : e.actor,
        description: desc || "—",
        timeAgo: relTime(e.timestamp),
        timeTitle: fmtTime(e.timestamp),
        href: e.document_pk ? `/dashboard/documents/${encodeURIComponent(e.document_pk)}` : undefined,
      };
    });
  }, [events, q, sort, who, type, routine]);

  return (
    <RecentActivity
      title="Audit log"
      titleIcon={<History />}
      items={items}
      rowsClassName="max-h-[70vh] overflow-y-auto overscroll-contain scroll-smooth [scrollbar-gutter:stable]"
      empty={q || who !== "all" || type !== "all" ? "No events match these filters." : "No activity yet — run a scan to start the audit trail."}
      headerRight={
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events…" aria-label="Search events" className="h-8 w-48 pl-7 text-xs" />
          </div>
          <Select value={who} onValueChange={(v) => setWho(String(v ?? "all"))} items={WHO}>
            <SelectTrigger size="sm" className="w-28" aria-label="Filter by actor type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(WHO).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(v) => setType(String(v ?? "all"))} items={typeItems}>
            <SelectTrigger size="sm" className="w-48" aria-label="Filter by event type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(typeItems).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort((v as Sort) ?? "newest")} items={SORTS}>
            <SelectTrigger size="sm" className="w-36" aria-label="Sort">
              <ArrowDownUp className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SORTS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={routine} onChange={(e) => setRoutine(e.target.checked)} className="size-3.5 accent-foreground" />
            Routine
          </label>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </>
      }
    />
  );
}
