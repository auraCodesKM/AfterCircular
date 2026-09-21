"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import type { AnalysisRecord, ProcessedDocument, ReviewRecord } from "@/lib/pipeline-types";
import { DecisionPath } from "./decision-path";
import { ImpactBadge } from "./impact-badge";
import { fmtDate, impactKind } from "./labels";

type Props = { doc: ProcessedDocument | null; review: ReviewRecord | null; onClose: () => void };

export function AnalysisSheet({ doc, review, onClose }: Props) {
  return (
    <Sheet open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">
        {doc ? <Body key={doc.id} doc={doc} review={review} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Body({ doc, review }: { doc: ProcessedDocument; review: ReviewRecord | null }) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [result, setResult] = useState<ReviewRecord | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (doc.analysis_id)
      api<AnalysisRecord>(`analyses/${doc.analysis_id}`)
        .then((a) => !cancelled && setAnalysis(a))
        .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [doc.analysis_id]);

  async function decide(kind: "approve" | "reject") {
    if (!review) return;
    setBusy(kind);
    try {
      const r = await api<ReviewRecord>(`reviews/${review.id}/${kind}`, { method: "POST", body: JSON.stringify({ note: note || null }) });
      setResult(r);
      if (kind === "approve") toast.success("Approval recorded", { description: r.ticket_id ? `GitHub issue #${r.ticket_id} created` : undefined });
      else toast("Rejected", { description: "No action taken. Recorded in the audit log." });
      router.refresh();
    } catch (e) {
      toast.error(kind === "approve" ? "Approval failed" : "Rejection failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const impact = analysis?.impact ?? null;
  const memo = analysis?.memo ?? null;
  const ex = analysis?.extraction;
  const kind = impact ? (impact.applicability === "YES" ? (impact.alignment === "CONFLICT" ? "conflict" : impact.alignment === "ALIGNED" ? "aligned" : "uncertain") : impact.applicability === "NO" ? "na" : "uncertain") : impactKind(doc.impact, doc.status);
  const current = result ?? review;
  const canDecide = current?.status === "AWAITING_REVIEW";

  return (
    <>
      <SheetHeader className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge kind={kind} />
          {impact?.severity ? <Badge variant="outline">Severity: {impact.severity}</Badge> : null}
          {doc.source_mode === "DEMO_SNAPSHOT" ? <Badge variant="secondary">Demo snapshot · fictional</Badge> : null}
        </div>
        <SheetTitle className="text-base leading-snug">{doc.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
          <span>
            {doc.source} · {doc.circular_number ?? doc.document_id}
          </span>
          <span>Published {fmtDate(doc.published_date)}</span>
          <span>Effective {fmtDate(impact?.effective_date ?? doc.effective_date)}</span>
          <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline">
            Source <ExternalLink aria-hidden className="size-3" />
          </a>
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-6 py-5 text-sm">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Analysis unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!analysis && !error ? (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {ex?.summary ? (
          <Section title="What changed">
            <p>{ex.summary}</p>
            {ex.applies_to?.length ? <p className="text-xs text-muted-foreground">Applies to: {ex.applies_to.join(", ")}</p> : null}
          </Section>
        ) : null}

        {impact ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Applicability</p>
              <p className="font-medium">{impact.applicability}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Alignment</p>
              <p className="font-medium">{impact.alignment ?? "—"}</p>
            </div>
            {impact.affected_policies.length ? (
              <div className="col-span-2">
                <p className="text-[11px] text-muted-foreground">Affected policies</p>
                <p className="font-mono text-xs">{impact.affected_policies.join(", ")}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {impact ? (
          <Section title="Why">
            <p>{impact.reason}</p>
          </Section>
        ) : null}

        {impact && (impact.regulatory_evidence.length || impact.policy_evidence.length) ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Section title="Regulatory evidence">
              <ul className="space-y-2 rounded-lg border border-border p-3 text-xs">
                {impact.regulatory_evidence.map((e, i) => (
                  <li key={i}>
                    <span className="font-mono text-muted-foreground">§{e.section}</span> “{e.text}”
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Policy evidence">
              <ul className="space-y-2 rounded-lg border border-border p-3 text-xs">
                {impact.policy_evidence.length ? (
                  impact.policy_evidence.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-muted-foreground">
                        {e.doc_id} §{e.section}
                      </span>{" "}
                      “{e.text}”
                    </li>
                  ))
                ) : (
                  <li className="text-muted-foreground">No policy clause cited.</li>
                )}
              </ul>
            </Section>
          </div>
        ) : null}

        {ex?.obligations?.length ? (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">{ex.obligations.length} extracted obligations</CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="mt-2 space-y-1.5">
                {ex.obligations.map((o, i) => (
                  <li key={i} className="rounded-md border border-border p-2 text-xs">
                    <p>{o.requirement}</p>
                    <p className="mt-0.5 font-mono text-muted-foreground">
                      {o.affected_area} · deadline {o.deadline ?? "—"} · §{o.evidence.section}
                    </p>
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {impact?.recommended_action ? (
          <Section title="Recommended action">
            <p>{impact.recommended_action}</p>
          </Section>
        ) : null}

        {memo ? (
          <Section title="Policy-update memo">
            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-xs font-medium">Draft amendment</p>
                <Badge variant="outline" className="border-warning/40 text-warning">
                  {memo.disclaimer}
                </Badge>
              </div>
              <dl className="space-y-3 px-3 py-3">
                {(
                  [
                    ["Regulatory change", memo.regulatory_change],
                    ["Current policy", memo.current_policy],
                    ["Identified gap", memo.identified_gap],
                    ["Proposed amendment", memo.proposed_amendment],
                    ["Effective date", memo.effective_date],
                    ["Recommended action", memo.recommended_action],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap">{v}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-[11px] text-muted-foreground">Evidence</dt>
                  <dd>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs">
                      {memo.evidence.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              </dl>
            </div>
          </Section>
        ) : null}

        {analysis?.escalation_reason ? (
          <Alert>
            <AlertTitle>Escalated beyond the typed judgments</AlertTitle>
            <AlertDescription>
              {analysis.escalation_reason}
              {analysis.decision_path.some((p) => p.endsWith(":escalation")) ? " → resolved by the reasoning model." : " → no reasoning model available, routed to a person."}
            </AlertDescription>
          </Alert>
        ) : null}

        {analysis ? <DecisionPath analysisId={analysis.id} /> : null}

        {analysis ? (
          <p className="text-[11px] text-muted-foreground">
            Analysis {analysis.id} · generative provider {analysis.ai_provider}
            {analysis.ai_provider === "stub" ? " (fixture, no model call)" : ""} · models {Object.entries(analysis.models).map(([k, v]) => `${k}=${v}`).join(", ") || "—"} · retrieval{" "}
            {analysis.metrics.retrieval?.backend ?? "—"}
          </p>
        ) : null}

        {review ? (
          <>
            <Separator />
            <section className="space-y-3">
              <Alert>
                <ShieldCheck />
                <AlertTitle>Human approval required</AlertTitle>
                <AlertDescription>
                  {canDecide
                    ? "AI detected a potential policy conflict and drafted a memo. No external action has been taken. Approving opens a compliance-review issue in the connected repository; nothing in the policy itself changes."
                    : `${current?.status === "APPROVED" ? "Approved" : "Rejected"} by @${current?.decided_by}${current?.note ? ` — “${current.note}”` : ""}.`}
                  {current?.ticket_url ? (
                    <>
                      {" "}
                      <a href={current.ticket_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline-offset-4 hover:underline">
                        GitHub issue #{current.ticket_id} <ExternalLink aria-hidden className="size-3" />
                      </a>
                    </>
                  ) : null}
                </AlertDescription>
              </Alert>
              {canDecide ? (
                <>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note for the audit log (optional)"
                    rows={2}
                    aria-label="Review note"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={() => decide("reject")}>
                      {busy === "reject" ? "Rejecting…" : "Reject"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger render={<Button size="sm" disabled={!!busy} />}>{busy === "approve" ? "Creating issue…" : "Approve"}</AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Approve and open a GitHub issue?</AlertDialogTitle>
                          <AlertDialogDescription>
                            A compliance-review issue will be created in the connected repository with the evidence and the AI-drafted memo. The policy file is not modified. This is recorded in the audit log under your GitHub account.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => decide("approve")}>Approve</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
