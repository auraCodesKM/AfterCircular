"use client";

import { BookOpen, ExternalLink, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
    <>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policies, topics, owners" className="pl-8" aria-label="Search policies" />
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map((d) => (
          <li key={d.doc_id}>
            <button type="button" onClick={() => setOpen(d.doc_id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-left hover:bg-muted/50">
              <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{d.doc_id}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {d.owner ? `Owner: ${d.owner} · ` : ""}v{d.version ?? "—"} · effective {fmtDate(d.effective_date)} · {d.sections.length} sections
                </span>
              </span>
              {d.affected_by?.length ? (
                <Badge variant="outline" className="border-destructive/30 text-destructive">
                  {d.affected_by.length} circular{d.affected_by.length > 1 ? "s" : ""}
                </Badge>
              ) : null}
              {d.status ? <Badge variant="secondary">{d.status}</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!open} onOpenChange={(o) => !o && close()}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">{open ? <PolicyBody key={open} docId={open} repo={repo} branch={branch} onAsk={(qq) => { close(); ask.start(qq); }} /> : null}</SheetContent>
      </Sheet>
    </>
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
      <SheetHeader className="border-b border-border px-5 py-4">
        <SheetTitle className="text-base">
          <span className="mr-2 font-mono text-xs text-muted-foreground">{docId}</span>
          {p?.title ?? "Policy"}
        </SheetTitle>
        <SheetDescription className="font-mono text-[11px]">
          {p ? `v${p.version ?? "—"} · ${p.status ?? "—"} · effective ${fmtDate(p.effective_date)} · ${p.owner ?? "owner —"} · approver ${p.approver ?? "—"} · review ${p.review_cycle ?? "—"}` : "Loading…"}
        </SheetDescription>
        <div className="flex flex-wrap gap-1 pt-1">
          <Button size="xs" variant="outline" nativeButton={false} render={<a href={`https://github.com/${repo}/blob/${branch}/${p?.path ?? ""}`} target="_blank" rel="noreferrer" />}>
            Open on GitHub <ExternalLink />
          </Button>
          <Button size="xs" variant="outline" onClick={() => onAsk(`Which circulars affect ${docId}?`)}>
            Which circulars affect it?
          </Button>
        </div>
      </SheetHeader>
      <div className="px-5 py-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!p && !error ? <Skeleton className="h-24 w-full" /> : null}
        {p ? (
          <>
            {p.applies_to?.length ? <p className="mb-2 text-xs text-muted-foreground">Applies to: {p.applies_to.join(", ")}</p> : null}
            <Accordion multiple>
              {p.sections.map((s) => (
                <AccordionItem key={s.chunk_id} value={s.chunk_id}>
                  <AccordionTrigger className="py-2 text-sm">§{s.section}</AccordionTrigger>
                  <AccordionContent>
                    <Markdown className="text-[13px]">{s.text}</Markdown>
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
