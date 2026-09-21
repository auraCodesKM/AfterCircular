import { Badge } from "@/components/ui/badge";
import type { AnalysisRecord } from "@/lib/pipeline-types";

export function MemoView({ memo }: { memo: NonNullable<AnalysisRecord["memo"]> }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">Policy-update memo</h3>
      <div className="rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-xs font-medium">Draft amendment</p>
          <Badge variant="outline" className="border-warning/40 text-warning">
            {memo.disclaimer}
          </Badge>
        </div>
        <dl className="space-y-3 px-3 py-3 text-sm">
          {(
            [
              ["Regulatory change", memo.regulatory_change],
              ["Current policy", memo.current_policy],
              ["Identified gap", memo.identified_gap],
              ["Proposed amendment", memo.proposed_amendment],
              ["Effective date", memo.effective_date],
              ["Recommended action", memo.recommended_action],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[11px] text-muted-foreground">Evidence</dt>
            <dd>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs">
                {memo.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
