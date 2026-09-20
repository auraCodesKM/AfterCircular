import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { Glass } from "@/components/ui/glass";

const principles = [
  ["Tenant isolation", "Own index, own partition, per company."],
  ["Controlled access", "Channels bound by registered identity."],
  ["Private policy data", "Never crosses a tenant boundary."],
  ["Grounded retrieval", "Models see only the chunks they need."],
  ["Controlled tools", "Ticket, draft, notify. Never merge."],
  ["Human approval", "Changes open only after a human says so."],
  ["Auditability", "Every action is a row: actor, input, result."],
];

export function Security() {
  return (
    <Section
      id="security"
      index="05"
      eyebrow="Security"
      title="Boundaries in the architecture."
      lede="Regulatory text is public, untrusted input — extracted from, never executed. No certifications claimed."
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="list">
        {principles.map(([k, v], i) => (
          <Reveal as="li" key={k} delay={i * 50}>
            <Glass tone="paper" className="h-full" bodyClassName="flex h-full min-h-[10rem] flex-col justify-between p-5">
              <p className="eyebrow">{String(i + 1).padStart(2, "0")}</p>
              <div>
                <p className="text-lg font-medium tracking-tight">{k}</p>
                <p className="mt-1 text-sm text-muted">{v}</p>
              </div>
            </Glass>
          </Reveal>
        ))}
        <Reveal as="li" delay={360}>
          <Glass tone="ink" className="h-full" bodyClassName="flex h-full min-h-[10rem] flex-col justify-between p-5">
            <p className="eyebrow text-white/55">Threat model</p>
            <p className="text-sm text-white/75">Public documents are data, not instructions. Company documents are private. Notifications carry summary + citation, never full text.</p>
          </Glass>
        </Reveal>
      </ul>
    </Section>
  );
}
