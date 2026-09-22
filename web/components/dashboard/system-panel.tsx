import { Layers } from "lucide-react";
import { Marker, MarkerContent, MarkerIcon } from "@/components/xiod/marker";
import type { SystemStatus } from "@/lib/pipeline-types";
import { fmtTime } from "./labels";

const NA = "Not recorded";
const n = (v: number | null | undefined) => (v === null || v === undefined ? NA : v.toLocaleString());

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${on ? "text-success" : "text-muted-foreground"}`}>
      <span className={`size-2 rounded-full ${on ? "bg-success" : "bg-muted-foreground/40"}`} aria-hidden /> {label}
    </span>
  );
}

function Card({ title, sub, status, rows }: { title: string; sub: string; status: { on: boolean; label: string }; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        </div>
        <Dot on={status.on} label={status.label} />
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate font-mono text-[11px]" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Architecture proof: "connected" only when a successful call is on record — configuration alone never lights a dot. */
export function SystemPanel({ sys }: { sys: SystemStatus | null }) {
  if (!sys) return <p className="text-sm text-muted-foreground">System status: {NA} — the backend did not answer.</p>;
  const f = sys.foundry, e = sys.embeddings, s = sys.search, j = sys.jev, r = sys.sebi, g = sys.github;
  return (
    <section className="space-y-3">
      <Marker variant="border" render={<h2 />}>
        <MarkerIcon><Layers /></MarkerIcon>
        <MarkerContent className="font-medium text-foreground">Architecture · what is actually running</MarkerContent>
      </Marker>
      <p className="text-xs text-muted-foreground">Values come from configuration and from persisted telemetry (model calls, decision records, scans, the search index). A service shows as connected only when a successful call is on record.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Card title="Microsoft Foundry" sub="AI reasoning & generation · primary" status={{ on: f.connected, label: f.connected ? "Connected" : f.configured ? "Configured, no call yet" : "Not configured" }}
          rows={[["Resource", `${f.resource} · ${f.project}`], ["Model", f.deployments.extraction === f.deployments.impact && f.deployments.impact === f.deployments.memo ? f.deployments.extraction : `${f.deployments.extraction} / ${f.deployments.impact} / ${f.deployments.memo}`],
            ["API · auth", `${f.api === "responses" ? "Responses API" : f.api} · ${f.auth === "entra-id" ? "Entra ID" : "API key"}`], ["Last request", f.last_request_at ? `${fmtTime(f.last_request_at)} · ${f.last_task ?? ""}` : NA],
            ["Last response id", f.last_response_id ?? NA], ["Requests today", `${n(f.requests_today)} · est. $${(f.estimated_cost_today_usd ?? 0).toFixed(4)}`], ["All time", `${n(f.requests_total)} requests · ${n(f.errors_total)} errors`]]} />
        <Card title="Azure AI Search" sub="Policy retrieval · hybrid + vector" status={{ on: !!s.connected, label: s.connected ? "Connected" : s.configured ? "Configured, unreachable" : "Not configured" }}
          rows={[["Index", s.index ?? NA], ["Documents (this tenant)", n(s.documents_in_index)], ["Retrieval", s.retrieval], ["Semantic ranker", s.semantic_ranker ? "enabled" : "not enabled (Free tier; RRF hybrid)"], ["Tenant isolation", s.tenant_filter],
            ["Indexed commit", s.indexed_commit ? `${s.indexed_commit.slice(0, 10)} · ${fmtTime(s.indexed_at)}` : NA], ["Analyses grounded", n(s.analyses_retrieved)]]} />
        <Card title="Embeddings" sub="Foundry deployment" status={{ on: e.connected, label: e.connected ? "Connected" : "No embedding yet" }}
          rows={[["Model", e.model], ["Dimensions", String(e.dimensions)], ["Vector queries", `${n(e.analyses_with_vector_query)} analyses`]]} />
        <Card title="SEBI" sub="Live regulatory source · official connector" status={{ on: r.live && !!r.last_live_scan_at, label: r.live ? (r.last_live_scan_at ? "LIVE" : "Live mode, not scanned") : "Demo snapshot" }}
          rows={[["Mode", r.mode], ["Last live scan", r.last_live_scan_at ? `${fmtTime(r.last_live_scan_at)} · ${r.last_live_status ?? ""}` : NA], ["Last fetch", r.last_fetch_at ? fmtTime(r.last_fetch_at) : NA], ["Live documents", n(r.live_documents)],
            ["Curated entries", r.curated_entry_ids.length ? r.curated_entry_ids.join(", ") : "newest listing rows"]]} />
        <Card title="Jev · System One" sub="Reasoning support · typed judgments" status={{ on: j.connected, label: j.connected ? "Connected" : j.configured ? "Configured, no call yet" : "Not configured" }}
          rows={[["Model", j.model ?? NA], ["Role", j.role], ["Decisions today", n(j.decisions_today)], ["All time", `${n(j.decisions_total)} records`], ["Last judgment", j.last_at ? fmtTime(j.last_at) : NA]]} />
        <Card title="Human control → GitHub" sub="Review gate · action" status={{ on: g.issues_created > 0, label: g.issues_created > 0 ? "Issue created after approval" : "No side effect yet" }}
          rows={[["Repository", g.repo], ["Awaiting review", n(g.awaiting_review)], ["Issues created", n(g.issues_created)]]} />
      </div>
    </section>
  );
}
