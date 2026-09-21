"use client";

import { Check, Circle, Loader2, Minus, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "cn";
import { api } from "@/lib/client-api";
import type { ScanRecord, ScanStep } from "@/lib/pipeline-types";
import { fmtTime } from "./labels";

const StepIcon = ({ status }: { status: ScanStep["status"] }) => {
  const c = "size-3.5 shrink-0";
  if (status === "done") return <Check aria-hidden className={cn(c, "text-success")} />;
  if (status === "running") return <Loader2 aria-hidden className={cn(c, "animate-spin text-foreground motion-reduce:animate-none")} />;
  if (status === "failed") return <X aria-hidden className={cn(c, "text-destructive")} />;
  if (status === "skipped") return <Minus aria-hidden className={cn(c, "text-muted-foreground/60")} />;
  return <Circle aria-hidden className={cn(c, "text-muted-foreground/40")} />;
};

/** Scan now + live pipeline. Polls the running scan and refreshes server data (router.refresh) as it progresses. */
export function ScanPanel({ initial, disabled }: { initial: ScanRecord | null; disabled?: boolean }) {
  const router = useRouter();
  const [scan, setScan] = useState(initial);
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);
  const running = scan?.status === "RUNNING";

  const poll = useCallback(
    async (id: string) => {
      try {
        for (;;) {
          const rec = await api<ScanRecord>(`scans/${id}`);
          if (!alive.current) return;
          setScan(rec);
          router.refresh();
          if (rec.status !== "RUNNING") {
            if (rec.status === "COMPLETED") {
              toast.success("Scan completed", { description: `${rec.new_documents} new · ${rec.skipped_documents} already processed · ${rec.source_mode === "DEMO_SNAPSHOT" ? "demo snapshot" : "live source"}` });
              if (rec.source_mode === "DEMO_SNAPSHOT" && rec.steps.find((s) => s.key === "connect")?.detail?.includes("unavailable"))
                toast.warning("SEBI source unavailable", { description: "Using the fictional demo snapshot." });
            } else toast.error("Scan failed", { description: rec.error ?? undefined });
            return;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (e) {
        toast.error("Lost contact with the backend", { description: (e as Error).message });
      }
    },
    [router],
  );

  useEffect(() => {
    alive.current = true;
    const id = initial?.status === "RUNNING" ? initial.id : null;
    const t = id ? setTimeout(() => poll(id), 0) : null;
    return () => {
      alive.current = false;
      if (t) clearTimeout(t);
    };
  }, [initial, poll]);

  async function scanNow() {
    setStarting(true);
    try {
      const rec = await api<ScanRecord>("scan", { method: "POST", body: JSON.stringify({}) });
      setScan(rec);
      poll(rec.id);
    } catch (e) {
      toast.error("Could not start scan", { description: (e as Error).message });
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Regulatory monitor</CardTitle>
          <CardDescription>
            {scan ? (
              <>
                Last scan {fmtTime(scan.finished_at ?? scan.started_at)} · {scan.new_documents} new · {scan.skipped_documents} already processed
                {scan.source_mode === "DEMO_SNAPSHOT" ? " · demo snapshot" : scan.source_mode === "LIVE" ? " · live" : ""}
              </>
            ) : (
              "No scan yet. Fetch SEBI publications and run the pipeline."
            )}
          </CardDescription>
        </div>
        <Button onClick={scanNow} disabled={running || starting || disabled} size="sm">
          {running || starting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
          {running ? "Scanning…" : "Scan now"}
        </Button>
      </CardHeader>
      {scan ? (
        <CardContent>
          <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2" aria-live="polite" aria-label="Pipeline steps">
            {scan.steps.map((s) => (
              <li key={s.key} className="flex min-w-0 items-start gap-2 text-sm transition-colors duration-200">
                <span className="mt-[3px]">
                  <StepIcon status={s.status} />
                </span>
                <div className="min-w-0">
                  <p className={cn(s.status === "pending" || s.status === "skipped" ? "text-muted-foreground" : "text-foreground")}>{s.label}</p>
                  {s.detail ? (
                    <p className="truncate text-xs text-muted-foreground" title={s.detail}>
                      {s.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {scan.error ? <p className="mt-3 text-xs text-destructive">{scan.error}</p> : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
