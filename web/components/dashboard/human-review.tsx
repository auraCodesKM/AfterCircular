"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { ReviewRecord } from "@/lib/pipeline-types";

/** The one place a side effect is authorized. Approve is confirmed in an AlertDialog; the backend enforces the state machine. */
export function HumanReview({ review, onDecided }: { review: ReviewRecord; onDecided?: (r: ReviewRecord) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [result, setResult] = useState<ReviewRecord | null>(null);
  const [note, setNote] = useState("");
  const current = result ?? review;
  const canDecide = current.status === "AWAITING_REVIEW";

  async function decide(kind: "approve" | "reject") {
    setBusy(kind);
    try {
      const r = await api<ReviewRecord>(`reviews/${review.id}/${kind}`, { method: "POST", body: JSON.stringify({ note: note || null }) });
      setResult(r);
      onDecided?.(r);
      if (kind === "approve") toast.success("Approval recorded", { description: r.ticket_id ? `GitHub issue #${r.ticket_id} created` : undefined });
      else toast("Rejected", { description: "No action taken. Recorded in the audit log." });
      router.refresh();
    } catch (e) {
      toast.error(kind === "approve" ? "Approval failed" : "Rejection failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <Alert>
        <ShieldCheck />
        <AlertTitle>Human review required</AlertTitle>
        <AlertDescription>
          {canDecide
            ? "AI has identified a policy conflict and drafted a memo. No external action has been taken. Approving opens a compliance-review issue in the connected repository; the policy itself is not modified."
            : `${current.status === "APPROVED" ? "Approved" : "Rejected"} by @${current.decided_by}${current.note ? ` — “${current.note}”` : ""}.`}
          {current.ticket_url ? (
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
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit log (optional)" rows={2} aria-label="Review note" />
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
                    A compliance-review issue with the evidence and the AI-drafted memo will be created in the connected repository. The policy file is not modified. Recorded in the audit log under your GitHub account.
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
  );
}
