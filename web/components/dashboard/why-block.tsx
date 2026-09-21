"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { AnalysisRecord } from "@/lib/pipeline-types";

type Impact = NonNullable<AnalysisRecord["impact"]>;

/** Level 1 + 2: headline verdict, affected clauses, main change. The full comparison is one click away. */
export function WhyBlock({ impact }: { impact: Impact }) {
  const [more, setMore] = useState(false);
  const clauses = Array.from(new Set(impact.policy_evidence.map((e) => `${e.doc_id} §${e.section}`)));
  const headline = impact.reason.split(/(?<=\.)\s|:\s/)[0].replace(/\.$/, "");
  const title = impact.applicability === "NO" ? "Why it does not apply" : impact.alignment === "CONFLICT" ? "Why this is a conflict" : impact.alignment === "ALIGNED" ? "Why the policy already complies" : "Why a person is needed";
  const tone = impact.applicability === "NO" ? "border-border" : impact.alignment === "CONFLICT" ? "border-destructive" : impact.alignment === "ALIGNED" ? "border-success" : "border-warning";
  return (
    <section className={cn("space-y-3 border-l-2 pl-4", tone)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-[15px] leading-7">{headline}.</p>
      {clauses.length ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Affected clauses
          {clauses.map((c) => (
            <span key={c} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground/80">
              {c}
            </span>
          ))}
        </p>
      ) : null}
      {impact.reason.length > headline.length + 2 ? (
        <>
          {more ? <p className="text-sm leading-6 text-muted-foreground">{impact.reason}</p> : null}
          <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={() => setMore((m) => !m)}>
            {more ? "Hide detailed comparison" : "Show detailed comparison"}
          </Button>
        </>
      ) : null}
    </section>
  );
}
