"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApprovalCard, type ApprovalCardStatus } from "@/components/agents/approval-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { ReviewRecord } from "@/lib/pipeline-types";
import { useSound } from "./sound-effects";

/** The one place a side effect is authorized. Approve confirms in an AlertDialog; the backend enforces the state machine. */
export function HumanReview({ review, onDecided, compact }: { review: ReviewRecord; onDecided?: (r: ReviewRecord) => void; compact?: boolean }) {
  const router = useRouter();
  const sound = useSound();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<ReviewRecord | null>(null);
  const [note, setNote] = useState("");
  const current = result ?? review;
  const status: ApprovalCardStatus = busy ? "submitting" : current.status === "APPROVED" ? "approved" : current.status === "REJECTED" ? "rejected" : "pending";

  async function decide(kind: "approve" | "reject") {
    setBusy(true);
    try {
      const r = await api<ReviewRecord>(`reviews/${review.id}/${kind}`, { method: "POST", body: JSON.stringify({ note: note || null }) });
      setResult(r);
      onDecided?.(r);
      if (kind === "approve") {
        sound("success");
        toast.success("Approval recorded", { description: r.ticket_id ? `GitHub issue #${r.ticket_id} created` : undefined });
      } else {
        sound("warning");
        toast("Rejected", { description: "No action taken. Recorded in the audit log." });
      }
      router.refresh();
    } catch (e) {
      sound("error");
      toast.error(kind === "approve" ? "Approval failed" : "Rejection failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ApprovalCard
        title="Human review required"
        description={
          compact
            ? "AI identified a conflict and drafted a memo. No external action has been taken."
            : "AI has identified a policy conflict and drafted a memo. No external action has been taken. Approving opens a compliance-review issue in the connected repository; the policy itself is not modified."
        }
        status={status}
        approveLabel="Approve & open issue"
        onApprove={() => setConfirm(true)}
        onReject={() => decide("reject")}
        result={
          status === "approved" || status === "rejected" ? (
            <span>
              {status === "approved" ? "Approved" : "Rejected"} by @{current.decided_by}
              {current.note ? ` — “${current.note}”` : ""}
              {current.ticket_url ? (
                <>
                  {" · "}
                  <a href={current.ticket_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline-offset-4 hover:underline">
                    GitHub issue #{current.ticket_id} <ExternalLink aria-hidden className="size-3" />
                  </a>
                </>
              ) : null}
            </span>
          ) : undefined
        }
      >
        {status === "pending" ? <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit log (optional)" rows={compact ? 1 : 2} aria-label="Review note" /> : null}
      </ApprovalCard>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve and open a GitHub issue?</AlertDialogTitle>
            <AlertDialogDescription>
              A compliance-review issue with the evidence and the AI-drafted memo will be created in the connected repository. The policy file is not modified. Recorded in the audit log under your GitHub account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                void decide("approve");
              }}
            >
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
