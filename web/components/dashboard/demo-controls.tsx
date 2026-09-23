"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { demoStatus, resetDemo, setDemoMode, type DemoStatus } from "@/app/dashboard/profile/demo-actions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const LABEL: Record<string, string> = {
  processed_documents: "publications", analyses: "analyses", decisions: "Jev decisions", reviews: "reviews",
  investigations: "Ask conversations", scans: "scans", audit_events: "activity events",
};
const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

type Pending = { kind: "reset" | "mark"; s: DemoStatus } | null;

/** Owner-only demo controls. Every workspace starts live; only one its owner marked as a demo workspace can be reset. */
export function DemoControls({ initial }: { initial: DemoStatus[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const put = (s: DemoStatus) => setRows((rs) => rs.map((r) => (r.tenant_id === s.tenant_id ? s : r)));

  async function mode(s: DemoStatus, enabled: boolean) {
    setBusy(s.tenant_id);
    const r = await setDemoMode(s.tenant_id, enabled);
    setBusy(null);
    if (!r.ok) return toast.error("Could not change the workspace", { description: r.error });
    put(r.data);
    toast(enabled ? `${s.company_name} is now a demo workspace` : `${s.company_name} is a live workspace again`);
  }

  async function reset(s: DemoStatus) {
    setBusy(s.tenant_id);
    const r = await resetDemo(s.tenant_id);
    if (r.ok) {
      const st = await demoStatus(s.tenant_id);
      if (st.ok) put(st.data);
      toast.success("Workspace reset. Ready for another demo.", { description: `${total(r.data.records_reset)} records cleared in ${r.data.company_name}; policies and configuration kept.` });
      router.refresh();
    } else {
      toast.error("Reset failed", { description: r.error });
    }
    setBusy(null);
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {rows.map((s) => {
          const n = total(s.will_reset);
          return (
            <li key={s.tenant_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {s.company_name}
                  <Badge variant={s.demo ? "secondary" : "outline"}>{s.demo ? "Demo" : "Live"}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {n ? `${n} records from past runs` : "At the demo baseline"}
                  {s.scan_running ? " · scan running" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {s.demo ? (
                  <>
                    <Button variant="ghost" size="xs" disabled={busy === s.tenant_id} onClick={() => mode(s, false)}>
                      Mark live
                    </Button>
                    <Button variant="outline" size="xs" disabled={busy === s.tenant_id || !s.reset_available || s.scan_running} onClick={() => setPending({ kind: "reset", s })}>
                      Reset demo
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="xs" disabled={busy === s.tenant_id} onClick={() => setPending({ kind: "mark", s })}>
                    Use as demo workspace
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.some((s) => s.demo && !s.reset_available) ? <p className="text-xs text-muted-foreground">Demo reset is not enabled on this deployment.</p> : null}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          {pending?.kind === "reset" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset {pending.s.company_name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears demo investigations, reviews and scan state for this workspace. Policies and workspace configuration are preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>
                  Clears{" "}
                  {Object.entries(pending.s.will_reset)
                    .filter(([, v]) => v)
                    .map(([k, v]) => `${v} ${LABEL[k] ?? k}`)
                    .join(", ") || "nothing — already at the baseline"}
                  . The next scan fetches the circulars from sebi.gov.in again.
                </p>
                {pending.s.github_issues_kept.length ? <p>{pending.s.github_issues_kept.length} GitHub issue(s) already opened stay in the repository.</p> : null}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => reset(pending.s)}>Reset workspace</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : pending ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Use {pending.s.company_name} as a demo workspace?</AlertDialogTitle>
                <AlertDialogDescription>
                  Demo workspaces can be reset, which clears their scan history, analyses and reviews. Use this only for companies you demonstrate with — live workspaces can never be reset.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => mode(pending.s, true)}>Use as demo</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
