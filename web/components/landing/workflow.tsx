import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { Glass, type GlassTone } from "@/components/ui/glass";

type Phase = { id: string; index: string; label: string; tone: GlassTone; line: string; steps: [string, string][] };

const phases: Phase[] = [
  {
    id: "watch",
    index: "01",
    label: "Watch",
    tone: "rose",
    line: "Fetch on a timer. Hash every document. Never process twice.",
    steps: [
      ["Regulatory source", "SCHEDULED"],
      ["New document", "DISCOVERED"],
    ],
  },
  {
    id: "understand",
    index: "02",
    label: "Understand",
    tone: "plum",
    line: "Extract obligations with citations. Retrieve policy. Gate cheaply, judge carefully.",
    steps: [
      ["Obligation extraction", "EXTRACTING"],
      ["Azure AI Search", "INDEXING"],
      ["Impact analysis", "ANALYZING"],
      ["Aligned / Conflict", "DECISION"],
    ],
  },
  {
    id: "act",
    index: "03",
    label: "Act",
    tone: "ember",
    line: "Draft the memo. Open the ticket. A human approves the change.",
    steps: [
      ["Human review", "AWAITING_APPROVAL"],
      ["Compliance action", "PR_CREATED"],
    ],
  },
];

const machine = ["DISCOVERED", "EXTRACTING", "INDEXING", "ANALYZING", "ALIGNED | CONFLICT | UNCERTAIN", "DRAFTED", "AWAITING_APPROVAL", "APPROVED", "PR_CREATED", "MERGED"];

export function Workflow() {
  return (
    <Section
      id="how-it-works"
      index="02"
      eyebrow="How it works"
      title="One pipeline. Three phases."
      lede="Every circular moves through one explicit state machine. Dashboard, audit log and notifications all read from it."
    >
      <ol className="grid gap-4 lg:grid-cols-3" role="list">
        {phases.map((p, i) => (
          <Reveal as="li" key={p.id} delay={i * 110}>
            <Glass tone={p.tone} className="h-full" bodyClassName="flex h-full flex-col p-6 md:p-7">
              <div id={p.id} className="scroll-mt-28 flex items-baseline justify-between">
                <p className="display text-5xl md:text-6xl">{p.index}</p>
                <p className="eyebrow text-white/70">{p.label}</p>
              </div>
              <p className="display mt-6 text-3xl">{p.label}</p>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/80">{p.line}</p>
              <ol className="pane mt-6 flex flex-col divide-y divide-white/15 overflow-hidden" role="list">
                {p.steps.map(([name, state]) => (
                  <li key={name} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-[0.95rem] font-medium">{name}</span>
                    <code className="font-mono text-[0.65rem] tracking-wider text-white/75">{state}</code>
                  </li>
                ))}
              </ol>
            </Glass>
          </Reveal>
        ))}
      </ol>

      <Reveal className="mt-4" delay={200}>
        <Glass tone="ink" bodyClassName="p-6 md:p-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <p className="eyebrow text-white/55">Pipeline state machine</p>
            <p className="text-sm text-white/60">UNCERTAIN stops the pipeline until a human acts. It never guesses.</p>
          </div>
          <ol className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[0.7rem] tracking-wide" role="list">
            {machine.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className={`rounded-md border px-2 py-1 ${s.includes("|") ? "border-brand/70 bg-brand/20" : "border-white/15 bg-white/[0.06]"}`}>{s}</span>
                {i < machine.length - 1 ? <span aria-hidden className="text-white/30">→</span> : null}
              </li>
            ))}
          </ol>
        </Glass>
      </Reveal>
    </Section>
  );
}
