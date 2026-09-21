"use client";

import { Check, ChevronDown, Circle, Loader2, Minus, RefreshCw, TriangleAlert, X } from "lucide-react";
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
import { fmtTime, sourceStatus } from "./labels";
import { PageHeader } from "./page-header";
import { useSound } from "./sound-effects";
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
export function ScanControl({ initial, disabled, eyebrow, title, description, actions, children }: { initial: ScanRecord | null; disabled?: boolean; eyebrow?: React.ReactNode; title: React.ReactNode; description: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const sound = useSound();
  const [scan, setScan] = useState(initial);
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState(initial?.status === "RUNNING");
  const alive = useRef(true);
  // One poll loop per scan id. router.refresh() re-renders the server page with a RUNNING `initial`,
  // which used to start another loop per refresh — and each loop fired its own completion toasts.
  const polling = useRef<string | null>(null);
  const running = scan?.status === "RUNNING";

  const poll = useCallback(
    async (id: string) => {
      if (polling.current === id) return;
      polling.current = id;
      try {
        for (;;) {
          const rec = await api<ScanRecord>(`scans/${id}`);
          if (!alive.current || polling.current !== id) return;
          setScan(rec);
          if (rec.status !== "RUNNING") {
            router.refresh();
            if (rec.status === "COMPLETED") {
              sound(rec.new_documents ? "notification" : "success");
              const src = sourceStatus(rec);
              const summary = `${rec.new_documents} new · ${rec.skipped_documents} already processed`;
              if (src.warn) toast.warning(src.title, { id: `scan-${id}`, description: `${src.detail} · ${summary}` });
              else toast.success("Scan completed", { id: `scan-${id}`, description: `${src.title} · ${summary}` });
            } else {
              sound("error");
              toast.error(ERROR_TITLE[rec.error_kind ?? "backend"], { id: `scan-${id}`, description: rec.error ?? undefined });
            }
            return;
          }
          router.refresh();
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (e) {
        toast.error("Lost contact with the backend", { id: `scan-${id}`, description: (e as Error).message });
      } finally {
        if (polling.current === id) polling.current = null;
      }
    },
    [router, sound],
  );

  const scanNow = useCallback(async () => {
    setStarting(true);
    setOpen(true);
    sound("command");
    try {
      const rec = await api<ScanRecord>("scan", { method: "POST", body: JSON.stringify({}) });
      setScan(rec);
      void poll(rec.id);
    } catch (e) {
      toast.error("Could not start scan", { description: (e as Error).message });
    } finally {
      setStarting(false);
    }
  }, [poll, sound]);

  const autoStarted = useRef(false);
  const initialId = initial?.status === "RUNNING" ? initial.id : null;
  useEffect(() => {
    alive.current = true;
    const id = initialId;
    let t: ReturnType<typeof setTimeout> | null = null;
    if (id) t = setTimeout(() => poll(id), 0);
    else if (params.get("scan") === "1" && !disabled && !autoStarted.current) {
      autoStarted.current = true; // ?scan=1 starts exactly one scan, then leaves the URL
      t = setTimeout(() => {
        router.replace("/dashboard");
        void scanNow();
      }, 0);
    }
    return () => {
      alive.current = false;
      if (t) clearTimeout(t);
    };
  }, [initialId, poll, params, scanNow, disabled, router]);

  const button = (
    <Button onClick={scanNow} disabled={running || starting || disabled} size="sm" variant={actions ? "outline" : "default"}>
      {running || starting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
      {running ? "Scanning…" : "Scan now"}
    </Button>
  );

  const done = scan?.steps.filter((s) => s.status === "done").length ?? 0;
  const total = scan?.steps.length ?? 0;
  const failed = scan?.status === "FAILED";

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {button}
          </>
        }
      />
      {failed && scan.error ? (
        <Alert variant={scan.error_kind === "repository" || scan.error_kind === "source" ? "warning" : "error"}>
          {scan.error_kind === "repository" || scan.error_kind === "source" ? <TriangleAlert /> : <X />}
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
                <Button size="xs" variant="outline" nativeButton={false} render={<Link href="/connect" />}>
                  Repository settings
                </Button>
              ) : null}
            </div>
          </AlertAction>
        </Alert>
      ) : null}
      {/* One quiet system line: pipeline state on the left, environment on the right, steps behind a toggle. */}
      <Collapsible open={open || running} onOpenChange={setOpen} className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            {running ? <Orb state="solving" px={20} /> : <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-destructive" : scan ? "bg-success" : "bg-muted-foreground/35")} />}
            {running ? "Pipeline running" : failed ? "Last scan failed" : scan ? "Pipeline idle" : "No scan yet"}
          </span>
          <span className="text-xs text-muted-foreground">
            {running
              ? `${done} of ${total} steps`
              : failed
                ? "Details above"
                : scan
                  ? `Last scan ${fmtTime(scan.finished_at ?? scan.started_at)} · ${scan.new_documents} new · ${scan.skipped_documents} already processed`
                  : "Scan to fetch the latest circulars"}
          </span>
          {running ? (
            <span className="h-1 w-24 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Pipeline progress">
              <span className="block h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </span>
          ) : null}
          {scan ? (
            <CollapsibleTrigger className="group ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              Steps
              <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
            </CollapsibleTrigger>
          ) : null}
        </div>
        {children ? <div className="border-t border-border bg-muted/30 px-4 py-2">{children}</div> : null}
        {scan ? (
          <CollapsibleContent>
            <ol className="grid gap-x-8 gap-y-2 border-t border-border px-4 py-3 sm:grid-cols-2" aria-live="polite" aria-label="Pipeline steps">
              {scan.steps.map((s) => (
                <li key={s.key} className="flex min-w-0 items-start gap-2.5 text-xs">
                  <span className="mt-[2px]">
                    <StepIcon status={s.status} />
                  </span>
                  <div className="min-w-0">
                    <p className={cn("font-medium", (s.status === "pending" || s.status === "skipped") && "font-normal text-muted-foreground")}>{s.label}</p>
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
        ) : null}
      </Collapsible>
    </>
  );
}
