import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { Glass, type GlassTone } from "@/components/ui/glass";
import { modelEvalResults, taskModelConfig, type ModelEvalResult } from "@/lib/model-evals";

const axes: { k: string; d: string; tone: GlassTone }[] = [
  { k: "Quality", d: "Accuracy on the golden set", tone: "rose" },
  { k: "Cost", d: "Per run, at real token profile", tone: "plum" },
  { k: "Latency", d: "Median time to a decision", tone: "ember" },
  { k: "Reliability", d: "Structured output + tool calls", tone: "ink" },
];

const columns: { key: keyof ModelEvalResult; label: string }[] = [
  { key: "model", label: "Model" },
  { key: "task", label: "Task" },
  { key: "quality", label: "Quality" },
  { key: "latencyMs", label: "Latency" },
  { key: "costPer1kRuns", label: "Cost" },
  { key: "structuredOutputSuccess", label: "Structured" },
  { key: "toolCallSuccess", label: "Tool calls" },
  { key: "evidenceAccuracy", label: "Evidence" },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;
function cell(r: ModelEvalResult, key: keyof ModelEvalResult) {
  const v = r[key];
  if (key === "latencyMs") return `${v} ms`;
  if (key === "costPer1kRuns") return `$${v} / 1k`;
  if (typeof v === "number") return pct(v);
  return String(v);
}

export function ModelIntelligence({ results = modelEvalResults }: { results?: ModelEvalResult[] }) {
  return (
    <Section
      id="model-intelligence"
      index="04"
      eyebrow="Model intelligence"
      title="Models chosen per task, by measurement."
      lede="Each task is bound to a model role. Roles are picked by evaluating Foundry models on AfterCircular's own work."
    >
      <div className="grid gap-4 md:grid-cols-12">
        <Reveal className="md:col-span-7">
          <ul className="grid h-full grid-cols-2 gap-4" role="list">
            {axes.map((a, i) => (
              <li key={a.k}>
                <Glass tone={a.tone} className="h-full" bodyClassName="flex h-full min-h-[9.5rem] flex-col justify-between p-5">
                  <p className={`eyebrow ${a.tone === "ink" ? "text-white/55" : "text-white/75"}`}>{String(i + 1).padStart(2, "0")}</p>
                  <div>
                    <p className="display text-2xl md:text-3xl">{a.k}</p>
                    <p className="mt-1 text-sm text-white/75">{a.d}</p>
                  </div>
                </Glass>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal className="md:col-span-5" delay={100}>
          <Glass tone="paper" className="h-full" bodyClassName="flex h-full flex-col p-5 md:p-6">
            <p className="eyebrow">Task → model role</p>
            <pre className="pane mt-4 overflow-x-auto p-4 font-mono text-[0.78rem] leading-relaxed text-ink shadow-none">
              <code>{taskModelConfig}</code>
            </pre>
            <p className="mt-4 text-sm text-muted">Swapping a model is a config change. The pipeline is untouched.</p>
          </Glass>
        </Reveal>
      </div>

      <Reveal className="mt-4" delay={200}>
        <Glass tone="ink" bodyClassName="p-5 md:p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="eyebrow text-white/55">Evaluation results</p>
            <span className="chip">{results.length ? `${results.length} rows` : "Pending measurement"}</span>
          </div>
          {results.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead>
                  <tr className="text-xs text-white/50">
                    {columns.map((c) => (
                      <th key={c.key} scope="col" className="px-3 py-2 font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={`${r.model}-${r.task}`} className="border-t border-white/10 font-mono text-[0.8rem]">
                      {columns.map((c) => (
                        <td key={c.key} className="px-3 py-2">
                          {cell(r, c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 max-w-2xl text-sm text-white/65">
              Published only from measured Foundry evaluation runs over the golden dataset: quality, latency, cost, structured-output and
              tool-call success, evidence accuracy. Nothing shown until then.
            </p>
          )}
        </Glass>
      </Reveal>
    </Section>
  );
}
