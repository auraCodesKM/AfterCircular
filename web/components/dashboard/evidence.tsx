"use client";

import { ExternalLink, Quote } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Citations } from "@/components/agents/citations";
import { evidenceCitations } from "@/lib/citations";
import type { Evidence, PolicyEvidence } from "@/lib/pipeline-types";
import { fmtDate } from "./labels";
import { SectionHeader } from "./section-header";

type Source = { label: string; circular?: string | null; url?: string | null; published?: string | null };

function Excerpt({ meta, text, href, hrefLabel }: { meta: React.ReactNode; text: string; href?: string | null; hrefLabel: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > 220;
  return (
    <li className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">{meta}</p>
      <p className={`text-sm leading-6 ${more || !long ? "" : "line-clamp-3"}`}>“{text}”</p>
      <div className="-ml-2 flex gap-1">
        {long ? (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setMore((m) => !m)}>
            {more ? "Show less" : "Show more"}
          </Button>
        ) : null}
        {href ? (
          <Button variant="ghost" size="xs" className="text-muted-foreground" nativeButton={false} render={href.startsWith("/") ? <Link href={href} /> : <a href={href} target="_blank" rel="noreferrer" />}>
            {hrefLabel} <ExternalLink />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Two-sided evidence: what the regulator says, what the policy says. Scannable first, full text on demand. */
export function EvidencePair({ regulatory, policy, source }: { regulatory: Evidence[]; policy: PolicyEvidence[]; source?: Source }) {
  if (!regulatory.length && !policy.length) return null;
  return (
    <section className="space-y-3">
      <SectionHeader as="h3" icon={<Quote />} title="Evidence" description={`${regulatory.length} regulatory · ${policy.length} policy — what the regulator says, what your policy says.`} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Regulation</h4>
          <ul className="space-y-2">
            {regulatory.length ? (
              regulatory.map((e, i) => (
                <Excerpt
                  key={i}
                  text={e.text}
                  href={source?.url && source.url !== "#" ? source.url : null}
                  hrefLabel="Open source"
                  meta={
                    <>
                      <span>{source?.label ?? "Circular"}</span>
                      <span className="font-mono text-foreground">§{e.section}</span>
                      {source?.published ? <span>Published {fmtDate(source.published)}</span> : null}
                    </>
                  }
                />
              ))
            ) : (
              <li className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No regulatory clause cited.</li>
            )}
          </ul>
        </div>
        <div className="space-y-2">
          <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Internal policy</h4>
          <ul className="space-y-2">
            {policy.length ? (
              policy.map((e, i) => (
                <Excerpt
                  key={i}
                  text={e.text}
                  href={`/dashboard/policies?open=${e.doc_id}`}
                  hrefLabel="Open policy"
                  meta={
                    <>
                      <span className="font-mono text-foreground">{e.doc_id}</span>
                      <span className="font-mono text-foreground">§{e.section}</span>
                    </>
                  }
                />
              ))
            ) : (
              <li className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No policy clause cited.</li>
            )}
          </ul>
        </div>
      </div>
      <Citations citations={evidenceCitations(regulatory, policy, { label: source?.label, url: source?.url })} title="Sources" />
    </section>
  );
}
