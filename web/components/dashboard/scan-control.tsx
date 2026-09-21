"use client";

import { Check, ChevronDown, Circle, Loader2, Minus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "cn";
import { api } from "@/lib/client-api";
import { Orb } from "./orb";
import type { ScanRecord, ScanStep } from "@/lib/pipeline-types";

const StepIcon = ({ status }: { status: ScanStep["status"] }) => {
  const c = "size-3.5 shrink-0";
  if (status === "done") return <Check aria-hidden className={cn(c, "text-success")} />;
  if (status === "running") return <Loader2 aria-hidden className={cn(c, "animate-spin motion-reduce:animate-none")} />;
  if (status === "failed") return <X aria-hidden className={cn(c, "text-destructive")} />;
  if (status === "skipped") return <Minus aria-hidden className={cn(c, "text-muted-foreground/60")} />;
  return <Circle aria-hidden className={cn(c, "text-muted-foreground/40")} />;
};

const ERROR_TITLE: Record<string, string> = { repository: "Policy repository unavailable", source: "Regulatory source unavailable", ai: "AI provider unavailable", backend: "Scan failed" };

/** Scan now + a compact pipeline readout. Polls while running and refreshes server-rendered data. */
export function ScanControl({ initial, disabled, title, description, children }: { initial: ScanRecord | null; disabled?: boolean; title: string; description: string; children?: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [scan, setScan] = useState(initial);
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState(initial?.status === "RUNNING");
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
              toast.success("Scan completed", { description: `${rec.new_documents} new · ${rec.skipped_documents} already processed` });
              if (rec.source_mode === "DEMO_SNAPSHOT" && rec.steps.find((s) => s.key === "connect")?.detail?.includes("unavailable"))
                toast.warning("SEBI source unavailable", { description: "Using the fictional demo snapshot." });
            } else toast.error(ERROR_TITLE[rec.error_kind ?? "backend"], { description: rec.error ?? undefined });
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

  const scanNow = useCallback(async () => {
    setStarting(true);
    setOpen(true);
    try {
      const rec = await api<ScanRecord>("scan", { method: "POST", body: JSON.stringify({}) });
      setScan(rec);
      void poll(rec.id);
    } catch (e) {
      toast.error("Could not start scan", { description: (e as Error).message });
    } finally {
      setStarting(false);
    }
  }, [poll]);

  useEffect(() => {
    alive.current = true;
    const id = initial?.status === "RUNNING" ? initial.id : null;
    const t = id ? setTimeout(() => poll(id), 0) : params.get("scan") === "1" && !disabled ? setTimeout(() => scanNow(), 0) : null;
    return () => {
      alive.current = false;
      if (t) clearTimeout(t);
    };
  }, [initial, poll, params, scanNow, disabled]);

  const button = (
    <Button onClick={scanNow} disabled={running || starting || disabled} size="sm">
      {running || starting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
      {running ? "Scanning…" : "Scan now"}
    </Button>
  );

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {button}
        </div>
        {children}
      </div>
      {scan?.status === "FAILED" && scan.error ? (
        <Alert variant="destructive">
          <X />
          <AlertTitle>{ERROR_TITLE[scan.error_kind ?? "backend"]}</AlertTitle>
          <AlertDescription>
            <p>{scan.error}</p>
            {scan.error_detail ? (
              <Collapsible>
                <CollapsibleTrigger className="mt-1 text-xs underline-offset-4 hover:underline">Technical details</CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{scan.error_detail}</pre>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </AlertDescription>
          <AlertAction>
            <div className="flex gap-2">
              <Button size="xs" variant="outline" onClick={scanNow} disabled={running || starting}>
                Retry
              </Button>
              {scan.error_kind === "repository" ? (
                <Button size="xs" variant="outline" render={<Link href="/connect" />}>
                  Repository settings
                </Button>
              ) : null}
            </div>
          </AlertAction>
        </Alert>
      ) : null}
      {scan ? (
        <Collapsible open={open || running} onOpenChange={setOpen}>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
            {running ? <Orb state="working" size={20} /> : null}
            <span className="font-medium text-foreground">Pipeline</span>
            {running
              ? ` · ${scan.steps.filter((s) => s.status === "done").length} of ${scan.steps.length} steps · processing…`
              : scan.status === "FAILED"
                ? " · last scan failed"
                : ` · last scan completed · ${scan.new_documents} new`}
            <span className="ml-1 underline-offset-4 group-hover:underline">{open || running ? "Hide details" : "Show details"}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 grid gap-x-6 gap-y-1 rounded-md border border-border p-3 sm:grid-cols-2" aria-live="polite" aria-label="Pipeline steps">
              {scan.steps.map((s) => (
                <li key={s.key} className="flex min-w-0 items-start gap-2 text-xs">
                  <span className="mt-[2px]">
                    <StepIcon status={s.status} />
                  </span>
                  <div className="min-w-0">
                    <p className={s.status === "pending" || s.status === "skipped" ? "text-muted-foreground" : ""}>{s.label}</p>
                    {s.detail ? (
                      <p className="truncate text-[11px] text-muted-foreground" title={s.detail}>
                        {s.detail}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </>
  );
}
