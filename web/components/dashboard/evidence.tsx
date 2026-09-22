"use client";

import { ExternalLink, Quote } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Evidence, PolicyEvidence, PolicySource, RegulatorySource } from "@/lib/pipeline-types";
import { fmtDate } from "./labels";
import { SectionHeader } from "./section-header";

type Source = { label: string; circular?: string | null; url?: string | null; published?: string | null; regulatory?: RegulatorySource | null; policies?: Record<string, PolicySource> };

function Excerpt({ meta, text, href, hrefLabel, extra }: { meta: React.ReactNode; text: string; href?: string | null; hrefLabel: string; extra?: React.ReactNode }) {
  const [more, setMore] = useState(false);
  const long = text.length > 220;
  return (
    <li className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">{meta}</p>
      <p className={`text-sm leading-6 ${more || !long ? "" : "line-clamp-3"}`}>“{text}”</p>
      <div className="-ml-2 flex flex-wrap gap-1">
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
        {extra}
      </div>
    </li>
  );
}

/** Two-sided evidence: what the regulator says, what the policy says. Scannable first, full text on demand. */
export function EvidencePair({ regulatory, policy, source }: { regulatory: Evidence[]; policy: PolicyEvidence[]; source?: Source }) {
  if (!regulatory.length && !policy.length) return null;
  const reg = source?.regulatory ?? null;
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
                  href={reg?.detail_url ?? (source?.url && source.url !== "#" ? source.url : null)}
                  hrefLabel={reg?.synthetic ? "Snapshot record" : "Open SEBI source"}
                  extra={
                    reg?.pdf_url && !reg.synthetic ? (
                      <Button variant="ghost" size="xs" className="text-muted-foreground" nativeButton={false} render={<a href={reg.pdf_url} target="_blank" rel="noreferrer" />}>
                        PDF <ExternalLink />
                      </Button>
                    ) : null
                  }
                  meta={
                    <>
                      <span className="font-medium text-foreground">{reg?.regulator ?? source?.label ?? "Circular"}</span>
                      <span className={reg?.synthetic || reg?.source_mode === "DEMO_SNAPSHOT" ? "rounded-sm bg-warning/15 px-1 text-warning" : "rounded-sm bg-success/15 px-1 text-success"}>
                        {reg?.synthetic || reg?.source_mode === "DEMO_SNAPSHOT" ? "DEMO SNAPSHOT · synthetic" : "LIVE"}
                      </span>
                      {reg?.published_date || source?.published ? <span>{fmtDate(reg?.published_date ?? source?.published)}</span> : null}
                      {reg?.reference ? <span className="font-mono">{reg.reference}</span> : null}
                      <span className="font-mono text-foreground">§{e.section}</span>
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
              policy.map((e, i) => {
                const ps = source?.policies?.[e.doc_id];
                return (
                  <Excerpt
                    key={i}
                    text={e.text}
                    href={ps?.url ?? `/dashboard/policies?open=${e.doc_id}`}
                    hrefLabel={ps?.url ? "Open on GitHub" : "Open policy"}
                    extra={
                      ps?.url ? (
                        <Button variant="ghost" size="xs" className="text-muted-foreground" nativeButton={false} render={<Link href={`/dashboard/policies?open=${e.doc_id}`} />}>
                          View in workspace
                        </Button>
                      ) : null
                    }
                    meta={
                      <>
                        <span className="rounded-sm bg-muted px-1 text-muted-foreground">Internal policy · fictional PoC tenant</span>
                        <span className="font-mono text-foreground">{e.doc_id}</span>
                        <span className="font-mono text-foreground">§{e.section}</span>
                        {ps?.path ? <span className="font-mono">{ps.repo}/{ps.path}</span> : null}
                      </>
                    }
                  />
                );
              })
            ) : (
              <li className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No policy clause cited.</li>
            )}
          </ul>
        </div>
      </div>

    </section>
  );
}
