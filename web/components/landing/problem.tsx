import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { Glass } from "@/components/ui/glass";

const manual = [
  "Monitor sources",
  "Discover publications",
  "Read obligations",
  "Find affected policies",
  "Check for conflicts",
  "Coordinate review",
  "Track actions",
];

const loop = [
  { tone: "bg-[#bd4468]", k: "Watch", v: "Sources polled on a schedule, every document remembered." },
  { tone: "bg-[#ad80ca]", k: "Understand", v: "Obligations extracted, matched to your policy text, cited." },
  { tone: "bg-[#e8703d]", k: "Act", v: "Conflicts become a ticket, a draft, a human decision." },
];

export function Problem() {
  return (
    <Section
      id="problem"
      index="01"
      eyebrow="The problem"
      title="Regulations change. Policies don't update themselves."
      lede="A chat session answers when asked, remembers nothing, and can't act. Compliance needs something that runs."
    >
      <div className="grid gap-4 md:grid-cols-12">
        <Reveal className="md:col-span-7">
          <Glass tone="paper" className="h-full" bodyClassName="p-6 md:p-8">
            <p className="eyebrow">Today · by hand · every publication</p>
            <ol className="mt-6 flex flex-wrap gap-2" role="list">
              {manual.map((step, i) => (
                <li key={step} className="chip">
                  <span className="text-accent">{String(i + 1).padStart(2, "0")}</span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="display mt-10 text-3xl md:text-4xl">
              Seven steps. Slow, reactive,
              <br />
              usually caught at audit.
            </p>
          </Glass>
        </Reveal>
        <Reveal className="md:col-span-5" delay={120}>
          <Glass tone="ink" className="h-full" bodyClassName="flex h-full flex-col p-6 md:p-8">
            <p className="eyebrow text-white/55">AfterCircular · continuous</p>
            <ul className="mt-6 flex flex-1 flex-col justify-center gap-5" role="list">
              {loop.map((l) => (
                <li key={l.k} className="flex items-start gap-4">
                  <span aria-hidden className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${l.tone} shadow-[0_0_0_4px_rgba(255,255,255,.08)]`} />
                  <div>
                    <p className="text-xl font-medium tracking-tight">{l.k}</p>
                    <p className="mt-0.5 text-sm text-white/65">{l.v}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Glass>
        </Reveal>
      </div>
    </Section>
  );
}
