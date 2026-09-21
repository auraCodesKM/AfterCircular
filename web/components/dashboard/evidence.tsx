import type { Evidence, PolicyEvidence } from "@/lib/pipeline-types";

/** Two-sided evidence, always shown together: what the regulator says and what the policy says. */
export function EvidencePair({ regulatory, policy }: { regulatory: Evidence[]; policy: PolicyEvidence[] }) {
  if (!regulatory.length && !policy.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-muted-foreground">Regulatory evidence</h4>
        <ul className="space-y-2 rounded-md border border-border p-3 text-xs">
          {regulatory.length ? (
            regulatory.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-muted-foreground">§{e.section}</span> “{e.text}”
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">No regulatory clause cited.</li>
          )}
        </ul>
      </div>
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-muted-foreground">Policy evidence</h4>
        <ul className="space-y-2 rounded-md border border-border p-3 text-xs">
          {policy.length ? (
            policy.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-muted-foreground">
                  {e.doc_id} §{e.section}
                </span>{" "}
                “{e.text}”
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">No policy clause cited.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
