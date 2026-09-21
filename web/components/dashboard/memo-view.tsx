import type { AnalysisRecord } from "@/lib/pipeline-types";
import { Markdown } from "./markdown";

export function MemoView({ memo }: { memo: NonNullable<AnalysisRecord["memo"]> }) {
  return (
    <dl className="space-y-3 text-sm leading-6">
      {(
        [
          ["Proposed amendment", memo.proposed_amendment],
          ["Identified gap", memo.identified_gap],
          ["Regulatory change", memo.regulatory_change],
          ["Current policy", memo.current_policy],
          ["Effective date", memo.effective_date],
          ["Recommended action", memo.recommended_action],
        ] as const
      ).map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd>
            <Markdown>{v}</Markdown>
          </dd>
        </div>
      ))}
      <div>
        <dt className="text-xs text-muted-foreground">Evidence cited</dt>
        <dd>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-5 text-muted-foreground">
            {memo.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </dd>
      </div>
    </dl>
  );
}
