"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Glass } from "@/components/ui/glass";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditEvent, DashboardSnapshot, ProcessedDocument, ReviewRecord, ScanRecord } from "@/lib/pipeline-types";
import { ReviewDialog } from "./review-dialog";
import { eventLabel, fmtTime, impactTone, statusLabel, toneClass } from "./labels";

type Props = { tenant: { companyName: string; githubRepo: string; defaultBranch: string }; initial: DashboardSnapshot };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/backend/${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = (await res.json()) as T & { detail?: string };
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

export function Dashboard({ tenant, initial }: Props) {
  const [snap, setSnap] = useState(initial);
  const [scan, setScan] = useState<ScanRecord | null>(initial.scan);
  const [error, setError] = useState<string | null>(initial.backendError);
  const [open, setOpen] = useState<ProcessedDocument | null>(null);
  const running = scan?.status === "RUNNING";

  const refresh = useCallback(async () => {
    try {
      const [documents, reviews, audit] = await Promise.all([
        api<ProcessedDocument[]>("documents"),
        api<ReviewRecord[]>("reviews"),
        api<AuditEvent[]>("audit?limit=40"),
      ]);
      setSnap((s) => ({ ...s, documents, reviews, audit }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const alive = useRef(true);
  const poll = useCallback(
    async (id: string) => {
      try {
        for (;;) {
          const rec = await api<ScanRecord>(`scans/${id}`);
          if (!alive.current) return;
          setScan(rec);
          await refresh();
          if (rec.status !== "RUNNING") return;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh],
  );

  useEffect(() => {
    alive.current = true;
    const id = initial.scan?.status === "RUNNING" ? initial.scan.id : null;
    const t = id ? setTimeout(() => poll(id), 0) : null;
    return () => {
      alive.current = false;
      if (t) clearTimeout(t);
    };
  }, [initial.scan, poll]);

  async function scanNow() {
    setError(null);
    try {
      const rec = await api<ScanRecord>("scan", { method: "POST", body: JSON.stringify({}) });
      setScan(rec);
      poll(rec.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const awaiting = snap.reviews.filter((r) => r.status === "AWAITING_REVIEW");
  const reviewByDoc = new Map(snap.reviews.map((r) => [r.document_pk, r]));
  const counts = {
    conflict: snap.documents.filter((d) => d.impact === "CONFLICT").length,
    aligned: snap.documents.filter((d) => d.impact === "ALIGNED").length,
    na: snap.documents.filter((d) => d.impact === "NOT_APPLICABLE").length,
    uncertain: snap.documents.filter((d) => d.status === "NEEDS_INVESTIGATION").length,
  };
  const h = snap.health;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="display mt-2 text-3xl md:text-4xl">{tenant.companyName}</h1>
          <p className="mt-2 font-mono text-xs text-muted">
            {tenant.githubRepo} · {tenant.defaultBranch}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-line font-mono text-[11px] uppercase tracking-wider">
            source: {scan?.source_mode === "LIVE" ? "LIVE sebi.gov.in" : scan?.source_mode === "DEMO_SNAPSHOT" ? "DEMO SNAPSHOT" : h?.sebi_mode ?? "—"}
          </Badge>
          <Badge variant="outline" className={`font-mono text-[11px] uppercase tracking-wider ${h?.ai_provider === "stub" ? "border-amber/60 bg-amber/20" : "border-line"}`}>
            AI: {h?.ai_provider === "foundry" ? "Microsoft Foundry" : h?.ai_provider === "stub" ? "stub — no model calls" : "—"}
          </Badge>
          <Badge variant="outline" className={`font-mono text-[11px] uppercase tracking-wider ${h?.judge?.default === "stub" ? "border-amber/60 bg-amber/20" : "border-line"}`}>
            judgments: {h?.judge?.default === "typesafe" ? `Jev (${h.judge.model})` : h?.judge?.default === "foundry" ? "Foundry (uncalibrated)" : h?.judge?.default === "stub" ? "stub — no model calls" : "—"}
          </Badge>
          <Badge variant="outline" className="border-line font-mono text-[11px] uppercase tracking-wider">
            retrieval: {h?.retrieval ?? "—"}
          </Badge>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-12">
        <Glass tone="ink" className="md:col-span-7" bodyClassName="flex h-full flex-col p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow text-white/55">Regulatory monitor</p>
              <p className="mt-2 text-sm text-white/70">
                Last scan: <span className="text-white">{fmtTime(scan?.finished_at ?? scan?.started_at)}</span>
                {scan ? (
                  <>
                    {" "}
                    · {scan.new_documents} new · {scan.skipped_documents} already processed
                  </>
                ) : null}
              </p>
            </div>
            <button type="button" onClick={scanNow} disabled={running || !!initial.backendError} className="pill h-10 shrink-0 px-5 text-sm disabled:opacity-60 disabled:hover:transform-none">
              {running ? "Scanning…" : "Scan now"}
            </button>
          </div>
          {scan ? (
            <ol className="mt-5 grid gap-1.5 sm:grid-cols-2" aria-live="polite">
              {scan.steps.map((s) => (
                <li key={s.key} className="flex items-start gap-2.5 text-sm">
                  <StepDot status={s.status} />
                  <div className="min-w-0">
                    <span className={s.status === "pending" ? "text-white/40" : s.status === "skipped" ? "text-white/50" : "text-white"}>{s.label}</span>
                    {s.detail ? <p className="truncate text-xs text-white/50" title={s.detail}>{s.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 text-sm text-white/60">No scan yet. Press Scan now to fetch SEBI publications and run the pipeline.</p>
          )}
          {scan?.error ? <p className="mt-3 text-xs text-rose">{scan.error}</p> : null}
        </Glass>

        <Glass tone={awaiting.length ? "rose" : "paper"} className="md:col-span-5" bodyClassName="flex h-full flex-col justify-between p-5 md:p-6">
          <div>
            <p className={`eyebrow ${awaiting.length ? "text-white/75" : ""}`}>Needs you</p>
            <p className="display mt-3 text-5xl">{awaiting.length}</p>
            <p className={`mt-1 text-sm ${awaiting.length ? "text-white/80" : "text-ink-2"}`}>
              {awaiting.length === 1 ? "conflict awaiting your decision" : "conflicts awaiting your decision"}
            </p>
          </div>
          <dl className={`mt-6 grid grid-cols-4 gap-2 text-center text-xs ${awaiting.length ? "text-white/80" : "text-ink-2"}`}>
            {[
              ["Conflict", counts.conflict],
              ["Aligned", counts.aligned],
              ["N/A", counts.na],
              ["Uncertain", counts.uncertain],
            ].map(([k, v]) => (
              <div key={k} className={`rounded-xl px-2 py-2 ${awaiting.length ? "bg-white/10" : "bg-paper-2"}`}>
                <dt>{k}</dt>
                <dd className="mt-0.5 text-lg font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Glass>
      </div>

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">What changed</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="models">Model intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <Glass tone="paper" bodyClassName="p-2 md:p-4">
            {snap.documents.length === 0 ? (
              <p className="p-4 text-sm text-ink-2">No regulatory documents processed yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Circular</TableHead>
                      <TableHead>Published</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Conclusion</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snap.documents.map((d) => {
                      const tone = impactTone(d.impact, d.status);
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="max-w-[28rem]">
                            <p className="truncate font-medium" title={d.title}>
                              {d.title}
                            </p>
                            <p className="font-mono text-[11px] text-muted">
                              {d.source} {d.circular_number ?? d.document_id}
                              {d.document_version > 1 ? ` · v${d.document_version}` : ""}
                              {d.source_mode === "DEMO_SNAPSHOT" ? " · DEMO" : ""}
                            </p>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-ink-2">{d.published_date ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-ink-2">{d.effective_date ?? "—"}</TableCell>
                          <TableCell>
                            <Badge className={toneClass[tone]}>{d.impact === "NOT_APPLICABLE" ? "Not applicable" : d.impact ?? "—"}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-ink-2">{statusLabel[d.status]}</TableCell>
                          <TableCell className="text-right">
                            {d.ticket_url ? (
                              <span className="inline-flex items-center gap-3">
                                <a href={d.ticket_url} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">
                                  Issue #{d.ticket_id}
                                </a>
                                {d.analysis_id ? (
                                  <Button size="sm" variant="secondary" onClick={() => setOpen(d)}>
                                    Why?
                                  </Button>
                                ) : null}
                              </span>
                            ) : d.analysis_id ? (
                              <Button size="sm" variant={d.status === "AWAITING_REVIEW" ? "primary" : "secondary"} onClick={() => setOpen(d)}>
                                {d.status === "AWAITING_REVIEW" ? "Review" : "Why?"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted">{d.error ? "failed" : "—"}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Glass>
        </TabsContent>

        <TabsContent value="activity">
          <Glass tone="paper" bodyClassName="p-5 md:p-6">
            {snap.audit.length === 0 ? (
              <p className="text-sm text-ink-2">No activity yet.</p>
            ) : (
              <ol className="space-y-3">
                {snap.audit.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <span className="w-28 shrink-0 font-mono text-[11px] text-muted">{fmtTime(e.timestamp)}</span>
                    <span className="font-medium">{eventLabel[e.event_type] ?? e.event_type}</span>
                    <span className="text-xs text-muted">
                      {e.actor_type === "human" ? `@${e.actor}` : e.actor_type}
                      {metaSummary(e.metadata)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Glass>
        </TabsContent>

        <TabsContent value="models">
          <Glass tone="paper" bodyClassName="p-5 md:p-6">
            {snap.evals?.judges ? (
              <div className="mb-6 space-y-3">
                <p className="text-sm text-ink-2">
                  Judgment layer · {snap.evals.judges.scenarios.length} golden scenarios · {fmtTime(snap.evals.judges.generated_at)}
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Judge</TableHead>
                        <TableHead>Applicability</TableHead>
                        <TableHead>Alignment</TableHead>
                        <TableHead>Affected</TableHead>
                        <TableHead>Evidence verbatim</TableHead>
                        <TableHead>Rerank hit</TableHead>
                        <TableHead>Escalated</TableHead>
                        <TableHead>Brier</TableHead>
                        <TableHead>Req / case</TableHead>
                        <TableHead>Tokens / case</TableHead>
                        <TableHead>Cost / case</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snap.evals.judges.summary.map((r) => (
                        <TableRow key={r.judge}>
                          <TableCell className="font-mono text-xs">
                            {r.judge} · {r.models.join(", ")}
                            {r.calibrated ? "" : " (self-reported)"}
                          </TableCell>
                          <TableCell>{pctOrDash(r.applicability_accuracy)}</TableCell>
                          <TableCell>{pctOrDash(r.alignment_accuracy)}</TableCell>
                          <TableCell>{pctOrDash(r.affected_accuracy)}</TableCell>
                          <TableCell>{pctOrDash(r.evidence_verbatim_rate)}</TableCell>
                          <TableCell>{pctOrDash(r.rerank_hit_rate)}</TableCell>
                          <TableCell>{pctOrDash(r.escalation_rate)}</TableCell>
                          <TableCell>{r.brier_mean ?? "—"}</TableCell>
                          <TableCell>{r.requests_per_case ?? "—"}</TableCell>
                          <TableCell>{r.input_tokens_per_case ?? "—"}</TableCell>
                          <TableCell>{r.estimated_cost_per_case == null ? "—" : `$${r.estimated_cost_per_case}`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {snap.evals.judges.note ? <p className="text-xs text-muted">{snap.evals.judges.note}</p> : null}
              </div>
            ) : null}
            {!snap.evals || !snap.evals.available ? (
              <p className="text-sm text-ink-2">{snap.evals && !snap.evals.available ? snap.evals.message : "No evaluation report."}</p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-ink-2">
                  Golden set of {snap.evals.scenarios.length} scenarios · {snap.evals.retrieval} · {fmtTime(snap.evals.generated_at)}
                </p>
                {snap.evals.warning ? <p className="rounded-xl bg-amber/20 px-3 py-2 text-sm">{snap.evals.warning}</p> : null}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Model</TableHead>
                        <TableHead>Task</TableHead>
                        <TableHead>Quality</TableHead>
                        <TableHead>JSON valid</TableHead>
                        <TableHead>Evidence</TableHead>
                        <TableHead>Latency</TableHead>
                        <TableHead>Tokens</TableHead>
                        <TableHead>Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snap.evals.summary.map((r) => (
                        <TableRow key={`${r.model}-${r.task}`}>
                          <TableCell className="font-mono text-xs">{r.model}</TableCell>
                          <TableCell>{r.task}</TableCell>
                          <TableCell>{pct(r.quality_score)}</TableCell>
                          <TableCell>{pct(r.json_valid_rate)}</TableCell>
                          <TableCell>{r.evidence_accuracy == null ? "—" : pct(r.evidence_accuracy)}</TableCell>
                          <TableCell>{r.latency_ms_median == null ? "—" : `${r.latency_ms_median} ms`}</TableCell>
                          <TableCell>{r.input_tokens == null ? "—" : `${r.input_tokens} / ${r.output_tokens}`}</TableCell>
                          <TableCell>{r.estimated_cost_total == null ? "—" : `$${r.estimated_cost_total}`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {Object.keys(snap.evals.recommendation).length ? (
                  <p className="text-sm text-ink-2">
                    Suggested:{" "}
                    {Object.entries(snap.evals.recommendation)
                      .map(([task, r]) => `${task} → ${r.model} (${pct(r.quality_score)})`)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            )}
          </Glass>
        </TabsContent>
      </Tabs>

      <ReviewDialog
        doc={open}
        review={open ? reviewByDoc.get(open.id) ?? null : null}
        onClose={() => setOpen(null)}
        onDecided={async () => {
          await refresh();
        }}
        api={api}
      />
    </div>
  );
}

function StepDot({ status }: { status: string }) {
  const cls =
    status === "done" ? "bg-white" : status === "running" ? "bg-rose animate-pulse" : status === "failed" ? "bg-accent" : status === "skipped" ? "bg-white/30" : "bg-white/15";
  return <span aria-hidden className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${cls}`} />;
}

function metaSummary(m: Record<string, unknown>) {
  const keys = ["circular", "reason", "applicability", "alignment", "ticket_id", "error", "count", "new"].filter((k) => m[k] !== undefined && m[k] !== null);
  if (!keys.length) return "";
  return " · " + keys.map((k) => `${k}: ${String(m[k]).slice(0, 80)}`).join(" · ");
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const pctOrDash = (n: number | null) => (n == null ? "—" : pct(n));
