"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AnalysisRecord } from "@/lib/pipeline-types";

type Impact = NonNullable<AnalysisRecord["impact"]>;

/** Level 1 + 2: headline verdict, affected clauses, main change. The full comparison is one click away. */
export function WhyBlock({ impact }: { impact: Impact }) {
  const [more, setMore] = useState(false);
  const clauses = Array.from(new Set(impact.policy_evidence.map((e) => `${e.doc_id} §${e.section}`)));
  const headline = impact.reason.split(/(?<=\.)\s|:\s/)[0].replace(/\.$/, "");
  const title = impact.applicability === "NO" ? "Why it does not apply" : impact.alignment === "CONFLICT" ? "Why this is a conflict" : impact.alignment === "ALIGNED" ? "Why the policy already complies" : "Why a person is needed";
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm leading-6">{headline}.</p>
      {clauses.length ? (
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Affected clauses</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            {clauses.map((c) => (
              <li key={c} className="font-mono text-xs">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {impact.reason.length > headline.length + 2 ? (
        <>
          {more ? <p className="text-sm leading-6 text-muted-foreground">{impact.reason}</p> : null}
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setMore((m) => !m)}>
            {more ? "Hide detailed comparison" : "Show detailed comparison"}
          </Button>
        </>
      ) : null}
    </section>
  );
}
