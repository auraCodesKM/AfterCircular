import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { Glass } from "@/components/ui/glass";

export function ResponsibleAI() {
  return (
    <Section
      id="responsible-ai"
      index="06"
      eyebrow="Responsible AI"
      title="The AI drafts. A human decides."
      lede="Official company policies are never modified autonomously. A ticket is a request; a pull request is a proposal; only a human merge changes anything."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Reveal>
          <Glass tone="rose" className="h-full" bodyClassName="flex h-full min-h-[18rem] flex-col justify-between p-7 md:p-9">
            <p className="eyebrow text-white/75">Machine</p>
            <p className="display text-4xl md:text-5xl">
              AI detects.
              <br />
              AI analyzes.
              <br />
              AI drafts.
            </p>
          </Glass>
        </Reveal>
        <Reveal delay={120}>
          <Glass tone="ink" className="h-full" bodyClassName="flex h-full min-h-[18rem] flex-col justify-between p-7 md:p-9">
            <p className="eyebrow text-white/55">Human</p>
            <p className="display text-4xl md:text-5xl">
              Humans approve.
              <br />
              Humans decide.
            </p>
          </Glass>
        </Reveal>
      </div>
      <Reveal delay={200} className="mt-4 grid gap-4 sm:grid-cols-3">
        {[
          ["No silent guessing", "UNCERTAIN → no action. Waits for a person."],
          ["No invented evidence", "Missing citation → NEEDS_INVESTIGATION."],
          ["No self-merge", "The agent never merges its own PR."],
        ].map(([k, v]) => (
          <Glass key={k} tone="paper" bodyClassName="p-5">
            <p className="font-medium">{k}</p>
            <p className="mt-1 text-sm text-muted">{v}</p>
          </Glass>
        ))}
      </Reveal>
    </Section>
  );
}
