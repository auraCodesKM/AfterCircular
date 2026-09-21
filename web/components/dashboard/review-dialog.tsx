"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type {
  AnalysisRecord,
  ProcessedDocument,
  ReviewRecord,
} from "@/lib/pipeline-types";
import { DecisionPath } from "./decision-path";
import { toneClass } from "./labels";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

type Props = {
  doc: ProcessedDocument | null;
  review: ReviewRecord | null;
  onClose: () => void;
  onDecided: () => Promise<void>;
  api: Api;
};

export function ReviewDialog({ doc, review, onClose, onDecided, api }: Props) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {doc ? (
          <ReviewBody
            key={doc.id}
            doc={doc}
            review={review}
            onDecided={onDecided}
            api={api}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  doc,
  review,
  onDecided,
  api,
}: {
  doc: ProcessedDocument;
  review: ReviewRecord | null;
  onDecided: () => Promise<void>;
  api: Api;
}) {
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewRecord | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (doc.analysis_id) {
      api<AnalysisRecord>(`analyses/${doc.analysis_id}`)
        .then((a) => !cancelled && setAnalysis(a))
        .catch((e: Error) => !cancelled && setError(e.message));
    }
    return () => {
      cancelled = true;
    };
  }, [doc.analysis_id, api]);

  async function decide(kind: "approve" | "reject") {
    if (!review) return;
    setBusy(kind);
    setError(null);
    try {
      const r = await api<ReviewRecord>(`reviews/${review.id}/${kind}`, {
        method: "POST",
        body: JSON.stringify({ note: note || null }),
      });
      setResult(r);
      await onDecided();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const impact = analysis?.impact ?? null;
  const memo = analysis?.memo ?? null;
  const extraction = analysis?.extraction;
  const canDecide = review?.status === "AWAITING_REVIEW" && !result;

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {impact ? (
            <>
              <Badge
                className={
                  toneClass[
                    impact.alignment === "CONFLICT"
                      ? "conflict"
                      : impact.alignment === "ALIGNED"
                        ? "aligned"
                        : impact.applicability === "UNCERTAIN"
                          ? "warn"
                          : "neutral"
                  ]
                }
              >
                {impact.applicability === "YES"
                  ? (impact.alignment ?? "—")
                  : impact.applicability === "NO"
                    ? "Not applicable"
                    : "Uncertain"}
              </Badge>
              {impact.severity ? <Badge variant="outline">severity: {impact.severity}</Badge> : null}
              <span className="text-xs text-muted" title="Model-reported; it routes the case, it does not prove it">
                model confidence {Math.round(impact.confidence * 100)}%
              </span>
            </>
          ) : null}
          {doc.source_mode === "DEMO_SNAPSHOT" ? (
            <Badge variant="outline">Demo snapshot — fictional circular</Badge>
          ) : null}
          {analysis?.ai_provider === "stub" ? (
            <Badge variant="outline" className="border-amber/60 bg-amber/20">
              extraction: stub fixture, no generative model
            </Badge>
          ) : null}
        </div>
        <DialogTitle className="text-base leading-snug">
          {doc.title}
        </DialogTitle>
        <DialogDescription className="font-mono text-xs">
          {doc.source} {doc.circular_number ?? doc.document_id} · published{" "}
          {doc.published_date ?? "—"} · effective{" "}
          {impact?.effective_date ?? doc.effective_date ?? "—"} ·{" "}
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            source
          </a>
        </DialogDescription>
      </DialogHeader>

      {error ? (
        <p role="alert" className="rounded-xl bg-accent/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}
      {!analysis && !error ? (
        <p className="text-sm text-muted">Loading analysis…</p>
      ) : null}

      {extraction?.summary ? (
        <section>
          <h3 className="eyebrow">What changed</h3>
          <p className="mt-1.5 text-sm">{extraction.summary}</p>
          {extraction.applies_to?.length ? (
            <p className="mt-1 text-xs text-muted">
              Applies to: {extraction.applies_to.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {impact ? (
        <section>
          <h3 className="eyebrow">What AfterCircular concluded</h3>
          <p className="mt-1.5 text-sm">{impact.reason}</p>
          {impact.affected_policies.length ? (
            <p className="mt-1 text-xs text-muted">
              Affects: {impact.affected_policies.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {impact &&
      (impact.regulatory_evidence.length || impact.policy_evidence.length) ? (
        <section>
          <h3 className="eyebrow">Why — evidence</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-paper-2 p-3">
              <p className="text-xs font-medium">Regulator says</p>
              <ul className="mt-1.5 space-y-2">
                {impact.regulatory_evidence.map((e, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-mono text-muted">§{e.section}</span> “
                    {e.text}”
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl bg-paper-2 p-3">
              <p className="text-xs font-medium">Policy says</p>
              <ul className="mt-1.5 space-y-2">
                {impact.policy_evidence.length ? (
                  impact.policy_evidence.map((e, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-mono text-muted">
                        {e.doc_id} §{e.section}
                      </span>{" "}
                      “{e.text}”
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-muted">
                    No policy clause cited.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {extraction?.obligations?.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted">
            {extraction.obligations.length} extracted obligation(s)
          </summary>
          <ol className="mt-2 space-y-2">
            {extraction.obligations.map((o, i) => (
              <li
                key={i}
                className="rounded-xl border border-line p-2.5 text-xs"
              >
                <p>{o.requirement}</p>
                <p className="mt-1 font-mono text-muted">
                  {o.affected_area} · deadline {o.deadline ?? "—"} · §
                  {o.evidence.section}
                </p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {memo ? (
        <section className="rounded-2xl border border-line bg-white/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="eyebrow">Policy-update memo</h3>
            <Badge
              variant="outline"
              className="border-amber/60 bg-amber/20 text-[10px]"
            >
              {memo.disclaimer}
            </Badge>
          </div>
          <dl className="mt-3 space-y-3 text-sm">
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
                <dt className="text-xs font-medium text-muted">{k}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs font-medium text-muted">Evidence</dt>
              <dd className="mt-0.5">
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {memo.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {analysis?.escalation_reason ? (
        <p className="rounded-xl bg-amber/20 px-3 py-2 text-xs">
          <span className="font-medium">Escalated:</span> {analysis.escalation_reason}
          {analysis.decision_path.some((p) => p.endsWith(":escalation")) ? " → resolved by the reasoning model" : " → no reasoning model available, routed to a person"}
        </p>
      ) : null}

      {analysis ? <DecisionPath analysisId={analysis.id} api={api} /> : null}

      {analysis ? (
        <p className="text-[11px] text-muted">
          Analysis {analysis.id} · path {analysis.decision_path.join(" → ") || "—"} · provider {analysis.ai_provider} · models{" "}
          {Object.entries(analysis.models)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ") || "—"}{" "}
          · retrieval {analysis.metrics.retrieval?.backend ?? "—"} (
          {analysis.metrics.retrieval?.count ?? 0} chunks)
          {analysis.metrics.gate_prefilter &&
          !analysis.metrics.gate_prefilter.full_analysis
            ? ` · gate skipped the model call: ${analysis.metrics.gate_prefilter.reason}`
            : ""}
        </p>
      ) : null}

      {review ? (
        <>
          <Separator />
          <section>
            <h3 className="eyebrow">Human review</h3>
            {result || review.status !== "AWAITING_REVIEW" ? (
              <p className="mt-2 text-sm">
                {(result ?? review).status === "APPROVED"
                  ? "Approved"
                  : "Rejected"}{" "}
                by @{(result ?? review).decided_by}
                {(result ?? review).ticket_url ? (
                  <>
                    {" "}
                    · GitHub issue{" "}
                    <a
                      href={(result ?? review).ticket_url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4"
                    >
                      #{(result ?? review).ticket_id}
                    </a>
                  </>
                ) : null}
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted">
                  Approving opens a compliance-review issue in{" "}
                  {`the connected repository`}. Nothing is changed in the policy
                  itself.
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note for the audit log (optional)"
                  rows={2}
                  className="mt-3 w-full rounded-xl border border-line bg-white/70 px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </>
            )}
          </section>
          {canDecide ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!!busy}
                onClick={() => decide("reject")}
              >
                {busy === "reject" ? "Rejecting…" : "Reject"}
              </Button>
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() => decide("approve")}
              >
                {busy === "approve"
                  ? "Creating issue…"
                  : "Approve & create GitHub issue"}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
