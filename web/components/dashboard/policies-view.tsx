"use client";

import { BookOpen, ChevronRight, ExternalLink, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";
import { api } from "@/lib/client-api";
import type { PolicyDetail, PolicyDoc } from "@/lib/pipeline-types";
import { EmptyState } from "./empty-state";
import { Markdown } from "./markdown";
import { fmtDate } from "./labels";
import { useWorkspace } from "./workspace-provider";

/** Repository explorer: search, list with metadata, detail sheet with sections. */
export function PoliciesView({ documents, repo, branch }: { documents: PolicyDoc[]; repo: string; branch: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { ask } = useWorkspace();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(params.get("open"));
  const rows = documents.filter((d) => `${d.doc_id} ${d.title} ${(d.topics ?? []).join(" ")} ${d.owner ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const close = () => {
    setOpen(null);
    if (params.get("open")) router.replace("/dashboard/policies");
  };

  if (!documents.length) return <EmptyState icon={BookOpen} title="No policies indexed yet" description="The repository is read and chunked on the first scan." />;
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policies, topics, owners" className="pl-8" aria-label="Search policies" />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {rows.length} of {documents.length} policies
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((d) => (
          <li key={d.doc_id}>
            <button type="button" onClick={() => setOpen(d.doc_id)} className={cn("group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60", d.affected_by?.length && "shadow-[inset_3px_0_0_0_var(--destructive)]")}>
              <span className="mt-0.5 inline-flex w-[4.75rem] shrink-0 justify-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">{d.doc_id}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {d.owner ? `Owner ${d.owner} · ` : ""}v{d.version ?? "—"} · effective {fmtDate(d.effective_date)} · {d.sections.length} sections
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {d.affected_by?.length ? (
                  <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                    {d.affected_by.length} circular{d.affected_by.length > 1 ? "s" : ""}
                  </Badge>
                ) : null}
                {d.status ? <Badge variant="secondary">{d.status}</Badge> : null}
              </span>
              <ChevronRight aria-hidden className="mt-0.5 hidden size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground sm:block" />
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!open} onOpenChange={(o) => !o && close()}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">{open ? <PolicyBody key={open} docId={open} repo={repo} branch={branch} onAsk={(qq) => { close(); ask.start(qq); }} /> : null}</SheetContent>
      </Sheet>
    </div>
  );
}

function PolicyBody({ docId, repo, branch, onAsk }: { docId: string; repo: string; branch: string; onAsk: (q: string) => void }) {
  const [p, setP] = useState<PolicyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<PolicyDetail>(`policies/${docId}`)
      .then((d) => !cancelled && setP(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [docId]);
  return (
    <>
      <SheetHeader className="sticky top-0 z-10 gap-2.5 border-b border-border/80 bg-background/90 px-6 py-4 pr-14 backdrop-blur">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Policy</span>
          <span aria-hidden>·</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">{docId}</span>
          {p?.status ? <Badge variant="secondary">{p.status}</Badge> : null}
        </p>
        <SheetTitle className="text-[17px] leading-snug font-semibold tracking-tight text-balance">{p?.title ?? "Policy"}</SheetTitle>
        <SheetDescription className="sr-only">Policy sections and metadata</SheetDescription>
        {p ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            {(
              [
                ["Version", p.version ? `v${p.version}` : "—"],
                ["Effective", fmtDate(p.effective_date)],
                ["Review cycle", p.review_cycle ?? "—"],
                ["Owner", p.owner ?? "—"],
                ["Approver", p.approver ?? "—"],
                ["Sections", String(p.sections.length)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate font-medium text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Skeleton className="h-10 w-full" />
        )}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button size="xs" variant="outline" nativeButton={false} render={<a href={`https://github.com/${repo}/blob/${branch}/${p?.path ?? ""}`} target="_blank" rel="noreferrer" />}>
            Open on GitHub <ExternalLink />
          </Button>
          <Button size="xs" variant="outline" onClick={() => onAsk(`Which circulars affect ${docId}?`)}>
            Which circulars affect it?
          </Button>
        </div>
      </SheetHeader>
      <div className="px-6 py-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!p && !error ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ) : null}
        {p ? (
          <>
            {p.applies_to?.length ? (
              <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Applies to
                {p.applies_to.map((a) => (
                  <span key={a} className="rounded-md bg-muted px-1.5 py-0.5 text-foreground/80">
                    {a}
                  </span>
                ))}
              </p>
            ) : null}
            <Accordion multiple className="divide-y divide-border rounded-xl border border-border bg-card px-3">
              {p.sections.map((s) => (
                <AccordionItem key={s.chunk_id} value={s.chunk_id} className="border-0">
                  <AccordionTrigger className="py-2.5 text-sm font-medium hover:no-underline">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">§{s.section.split(" ")[0]}</span>
                    {s.section.split(" ").slice(1).join(" ")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <Markdown className="text-[13px] leading-6">{s.text}</Markdown>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </>
        ) : null}
      </div>
    </>
  );
}
