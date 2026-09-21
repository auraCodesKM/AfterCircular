import type { CitationItem } from "@/components/agents/citations";
import type { Evidence, PolicyEvidence } from "@/lib/pipeline-types";

/** Evidence → citation items for the beui Citations / CitationStack components. */
function hostOf(url: string | null | undefined): string | null {
  if (!url || url === "#") return null;
  try {
    const h = new URL(url).hostname;
    return h.endsWith("example.invalid") ? null : h;
  } catch {
    return null;
  }
}

export function evidenceCitations(regulatory: Evidence[], policy: PolicyEvidence[], source: { label?: string; url?: string | null; repo?: string }): CitationItem[] {
  const host = hostOf(source.url);
  const reg = regulatory.map((e, i) => ({
    id: `reg-${i}-${e.section}`,
    title: `${source.label ?? "Circular"} §${e.section}`,
    domain: host ?? "sebi.gov.in",
    url: host ? source.url! : undefined,
  }));
  const seen = new Set<string>();
  const pol = policy
    .filter((e) => {
      const k = `${e.doc_id}#${e.section}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((e) => ({ id: `pol-${e.doc_id}-${e.section}`, title: `${e.doc_id} §${e.section}`, domain: source.repo ? "github.com" : "policy repository", url: `/dashboard/policies?open=${e.doc_id}` }));
  return [...reg, ...pol];
}
