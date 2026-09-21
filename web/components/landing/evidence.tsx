import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { Glass } from "@/components/ui/glass";

/** Illustrative only — fictional circular, fictional company. */
const demo = {
  circular: { label: "Regulatory evidence", source: "SEBI circular (illustrative)", cite: "Circular §3.2", text: "Members shall apply revised client-level position limits for index derivatives within thirty days." },
  policy: { label: "Internal policy evidence", source: "Acme Securities · Position Limits Policy (fictional)", cite: "Policy §4.1", text: "Client-level position limits for index derivatives follow the prior framework, reviewed annually." },
};

function Pane({ label, source, reference, text, dot }: { label: string; source: string; reference: string; text: string; dot: string }) {
  return (
    <div className="pane flex h-full flex-col p-5">
      <p className="eyebrow flex items-center gap-2 text-white/70">
        <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </p>
      <p className="mt-2 text-xs text-white/55">{source}</p>
      <blockquote className="mt-4 text-[1.05rem] leading-relaxed">&ldquo;{text}&rdquo;</blockquote>
      <p className="mt-auto pt-4 font-mono text-xs text-white/70">[{reference}]</p>
    </div>
  );
}

export function Evidence() {
  return (
    <Section
      id="evidence"
      index="03"
      eyebrow="Evidence"
      title="Both sides, every time."
      lede="A CONFLICT without a regulatory clause and a policy clause is rejected. Missing evidence becomes NEEDS_INVESTIGATION, never a guess."
    >
      <Reveal>
        <Glass tone="ink" bodyClassName="p-5 md:p-8">
          <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
            <Pane {...demo.circular} reference={demo.circular.cite} dot="bg-[#ff6796]" />
            <div className="flex items-center justify-center py-2 md:flex-col md:py-0">
              <span aria-hidden className="h-px w-10 bg-white/25 md:h-10 md:w-px" />
              <span className="chip border-brand/70 bg-brand/30 text-white">Conflict</span>
              <span aria-hidden className="h-px w-10 bg-white/25 md:h-10 md:w-px" />
            </div>
            <Pane {...demo.policy} reference={demo.policy.cite} dot="bg-[#c9b5e1]" />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["applicability", "YES"],
              ["alignment", "CONFLICT"],
              ["next", "Awaiting human approval"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 font-mono text-sm">
                <p className="text-[0.65rem] uppercase tracking-wider text-white/50">{k}</p>
                <p className={`mt-1 ${v === "CONFLICT" ? "text-[#ff8caf]" : ""}`}>{v}</p>
              </div>
            ))}
          </div>
        </Glass>
        <p className="mt-3 text-xs text-ink-3">Illustrative example. Fictional circular, fictional company. Not legal guidance.</p>
      </Reveal>
    </Section>
  );
}
