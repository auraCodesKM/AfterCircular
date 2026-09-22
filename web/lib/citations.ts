import type { CitationItem } from "@/components/agents/citations";
import type { Evidence, PolicyEvidence, PolicySource, RegulatorySource } from "@/lib/pipeline-types";
import { policySources, regulatorySources, type Source } from "@/lib/sources";

/** Sources → the beui CitationItem shape (favicon stack in the streaming footer). URLs come from the canonical sources only. */
export function toCitationItems(sources: Source[]): CitationItem[] {
  return sources.map((s) => ({ id: s.id, title: `${s.label} ${s.section ? `§${s.section}` : ""}`.trim(), domain: s.domain ?? (s.kind === "policy" ? "policy repository" : undefined), url: s.url ?? s.workspace_href ?? undefined }));
}

/** Evidence → citation items. Kept for callers that already hold the evidence arrays; the provenance object is required for real links. */
export function evidenceCitations(regulatory: Evidence[], policy: PolicyEvidence[], source: { label?: string; url?: string | null; regulatory?: RegulatorySource | null; policies?: Record<string, PolicySource> }): CitationItem[] {
  return toCitationItems([...regulatorySources(regulatory, source.regulatory, { label: source.label, url: source.url }), ...policySources(policy, source.policies)]);
}
