"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { DecisionAnswer, DecisionRecord } from "@/lib/pipeline-types";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

const stageLabel: Record<DecisionRecord["stage"], string> = {
  extraction_check: "Obligations verified against the circular",
  applicability: "Applicability",
  rerank: "Policy relevance",
  alignment: "Policy alignment",
  verification: "Citation check",
  escalation: "Reasoning model",
};

const providerLabel: Record<DecisionRecord["provider"], string> = { typesafe: "Jev · System One", foundry: "Foundry", stub: "stub (fixture)", code: "code" };

function fmtAnswer(a: DecisionAnswer) {
  if (a.type === "noul") return `p(yes) ${(a.noul ?? 0).toFixed(2)}`;
  if (a.type === "choice") return `${a.choice} · p ${((a.probabilities ?? {})[a.choice ?? ""] ?? 0).toFixed(2)} · conf ${(a.confidence ?? 0).toFixed(2)}`;
  return `level ${(a.score ?? 0).toFixed(2)} · conf ${(a.confidence ?? 0).toFixed(2)}`;
}

/** Groups the per-chunk rerank/alignment records so the path reads as stages, not as 20 rows. */
function group(records: DecisionRecord[]) {
  const out: { stage: DecisionRecord["stage"]; provider: DecisionRecord["provider"]; model: string; calibrated: boolean | null; items: DecisionRecord[] }[] = [];
  for (const r of records) {
    const last = out[out.length - 1];
    if (last && last.stage === r.stage && last.provider === r.provider) last.items.push(r);
    else out.push({ stage: r.stage, provider: r.provider, model: r.model, calibrated: r.calibrated, items: [r] });
  }
  return out;
}

function summary(stage: DecisionRecord["stage"], items: DecisionRecord[]): string {
  const r0 = items[0].routing as Record<string, unknown>;
  switch (stage) {
    case "extraction_check":
      return r0.skipped ? `skipped: ${String(r0.skipped)}` : `${String(r0.kept)} kept · ${(r0.dropped as unknown[] | undefined)?.length ?? 0} dropped · ${(r0.flagged_uncertain as unknown[] | undefined)?.length ?? 0} flagged`;
    case "applicability":
      return `${String(r0.outcome)} — ${String(r0.reason)}`;
    case "rerank": {
      const kept = items.filter((i) => i.routing.kept);
      return `${kept.length} of ${items.length} chunks judged relevant: ${kept.map((i) => i.evidence_ids[0]).join(", ") || "none"}`;
    }
    case "alignment": {
      const pairs = items.flatMap((i) => Object.values((i.routing.pairs as Record<string, { bucket: string }>) ?? {}));
      const n = (b: string) => pairs.filter((p) => p.bucket === b).length;
      return `${pairs.length} obligation × policy pairs: ${n("conflicts")} conflict · ${n("satisfies")} satisfied · ${n("not_addressed") + n("harmless_uncertain")} not addressed · ${n("uncertain")} uncertain`;
    }
    case "verification": {
      const v = items.map((i) => String(i.routing.verdict));
      return `${v.filter((x) => x === "verified").length} of ${v.length} regulatory claims verified against the circular text${v.includes("fabricated") ? " · fabricated excerpt dropped" : ""}`;
    }
    case "escalation":
      return `${String(r0.outcome)} — ${String(r0.reason)}`;
  }
}

export function DecisionPath({ analysisId, api }: { analysisId: string; api: Api }) {
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DecisionRecord[]>(`analyses/${analysisId}/decisions`)
      .then((r) => !cancelled && setRecords(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [analysisId, api]);

  if (error) return <p className="text-xs text-muted">Decision records unavailable: {error}</p>;
  if (!records) return <p className="text-xs text-muted">Loading decision path…</p>;
  if (!records.length) return null;
  const groups = group(records);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">Decision path</h3>
        <p className="text-[11px] text-muted">Probabilities are the model&rsquo;s own; they route the case, they do not prove it.</p>
      </div>
      <ol className="mt-2 space-y-1.5">
        {groups.map((g, gi) => (
          <li key={gi} className="rounded-xl border border-line bg-white/60">
            <button type="button" onClick={() => setOpen(open === gi ? null : gi)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm">
              <span className="w-5 shrink-0 font-mono text-[11px] text-muted">{gi + 1}</span>
              <span className="font-medium">{stageLabel[g.stage]}</span>
              <Badge variant="outline" className={`text-[10px] ${g.provider === "typesafe" ? "border-ink/40" : g.provider === "stub" ? "border-amber/60 bg-amber/20" : "border-line"}`}>
                {providerLabel[g.provider]}
                {g.model !== "-" ? ` · ${g.model}` : ""}
              </Badge>
              {g.calibrated === true ? <span className="text-[10px] text-muted">calibrated probabilities</span> : g.calibrated === false ? <span className="text-[10px] text-muted">self-reported probabilities</span> : null}
              <span className="ml-auto text-[11px] text-muted">
                {g.items.length > 1 ? `${g.items.length} requests · ` : ""}
                {g.items.reduce((s, i) => s + i.latency_ms, 0)} ms
              </span>
              <span className="basis-full pl-7 text-xs text-ink-2">{summary(g.stage, g.items)}</span>
            </button>
            {open === gi ? (
              <div className="border-t border-line px-3 py-2">
                {g.items.map((r) => (
                  <div key={r.id} className="py-1.5 text-[11px]">
                    <p className="font-mono text-muted">
                      {r.evidence_ids.join(" · ") || r.stage} · state {r.state_digest.slice(0, 10) || "—"} · {r.input_tokens ?? "—"} tok
                    </p>
                    {Object.keys(r.answers).length ? (
                      <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                        {Object.entries(r.answers).map(([qid, a]) => (
                          <li key={qid} className="flex justify-between gap-2">
                            <span className="truncate font-mono text-muted">{qid}</span>
                            <span className="shrink-0">{fmtAnswer(a)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {r.routing.thresholds ? <p className="mt-1 text-muted">thresholds: {JSON.stringify(r.routing.thresholds)}</p> : null}
                    {r.routing.verdict ? <p className="mt-1 text-muted">verdict: {String(r.routing.verdict)} {r.routing.auto === false ? "· human should confirm" : ""}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
