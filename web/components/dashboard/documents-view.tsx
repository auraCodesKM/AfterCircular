"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProcessedDocument } from "@/lib/pipeline-types";
import { DocumentsTable } from "./documents-table";
import { impactKind, impactLabel, statusLabel } from "./labels";

const IMPACTS = ["all", "conflict", "aligned", "na", "uncertain", "pending", "failed"] as const;

/** Search + filters over the processed circulars, entirely client-side (the list is small and already loaded). `?impact=` preselects a filter so the overview tiles can link here. */
export function DocumentsView({ documents }: { documents: ProcessedDocument[] }) {
  const params = useSearchParams();
  const initialImpact = params.get("impact");
  const [q, setQ] = useState("");
  const [impact, setImpact] = useState<string>(initialImpact && (IMPACTS as readonly string[]).includes(initialImpact) ? initialImpact : "all");
  const [status, setStatus] = useState<string>("all");
  const statuses = useMemo(() => Array.from(new Set(documents.map((d) => d.status))), [documents]);
  const impactItems = Object.fromEntries(IMPACTS.map((k) => [k, k === "all" ? "All impacts" : impactLabel[k]]));
  const statusItems = { all: "All statuses", ...Object.fromEntries(statuses.map((s) => [s, statusLabel[s]])) };
  const rows = documents.filter((d) => {
    if (impact !== "all" && impactKind(d.impact, d.status) !== impact) return false;
    if (status !== "all" && d.status !== status) return false;
    const hay = `${d.title} ${d.circular_number ?? ""} ${d.document_id}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search regulatory publications" className="pl-8" aria-label="Search publications" />
        </div>
        <Select value={impact} onValueChange={(v) => setImpact(String(v ?? "all"))} items={impactItems}>
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by impact">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMPACTS.map((k) => (
              <SelectItem key={k} value={k}>
                {k === "all" ? "All impacts" : impactLabel[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(String(v ?? "all"))} items={statusItems}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {rows.length} of {documents.length}
        </span>
      </div>
      <DocumentsTable documents={rows} />
    </div>
  );
}
