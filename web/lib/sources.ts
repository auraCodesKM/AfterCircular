import type { AnalysisRecord, DocCard, Evidence, PolicyEvidence, PolicySource, RegulatorySource } from "@/lib/pipeline-types";

/**
 * Canonical source object every citation renders from. URLs are the ones the backend persisted (connector page/PDF,
 * GitHub blob at the indexed commit) — never rebuilt from titles or guessed slugs. A source without a persisted URL has
 * `url: null` and the card offers only its workspace route.
 */
export type SourceKind = "regulator" | "policy" | "retrieval" | "web";
export type SourceStatus = "LIVE" | "DEMO_SNAPSHOT" | "INTERNAL" | "RETRIEVED" | "DISCOVERY";
export type Source = {
  id: string;
  kind: SourceKind;
  /** e.g. "SEBI", "GitHub", "Azure AI Search" */
  label: string;
  title: string;
  url: string | null;
  domain: string | null;
  status: SourceStatus;
  section?: string | null;
  excerpt?: string | null;
  document_id?: string | null;
  reference?: string | null;
  pdf_url?: string | null;
  repository?: string | null;
  path?: string | null;
  commit_sha?: string | null;
  /** internal route (policy viewer, analysis) */
  workspace_href?: string | null;
  rank?: number | null;
  score?: number | null;
  /** the real site icon (declared by the site itself), or null when the source has no site */
  favicon_url?: string | null;
  retrieved_at?: string | null;
};

// Site icons declared by the sites themselves (SEBI's <link rel="shortcut icon">, GitHub's /favicon.ico). Nothing generic.
export const SITE_ICON: Record<string, string> = { "www.sebi.gov.in": "https://www.sebi.gov.in/images/icons/sebi-icon.png", "github.com": "https://github.com/favicon.ico" };
export const faviconFor = (domain: string | null | undefined): string | null => (domain ? (SITE_ICON[domain] ?? null) : null);

export function domainOf(url: string | null | undefined): string | null {
  if (!url || url === "#") return null;
  try {
    const h = new URL(url).hostname;
    return h.endsWith("example.invalid") ? null : h;
  } catch {
    return null;
  }
}

const isReal = (url: string | null | undefined): url is string => !!domainOf(url);

/** Regulatory excerpts → one source per cited section, all pointing at the persisted circular page (+ PDF). */
export function regulatorySources(regulatory: Evidence[], reg: RegulatorySource | null | undefined, fallback?: { label?: string; url?: string | null; title?: string | null }): Source[] {
  const synthetic = reg?.synthetic ?? false;
  const page = reg?.detail_url ?? fallback?.url ?? null;
  const url = !synthetic && isReal(page) ? page : null;
  const label = reg?.regulator ?? fallback?.label ?? "Regulator";
  return regulatory.map((e, i) => ({
    id: `reg-${i}-${e.section}`,
    kind: "regulator",
    label,
    title: reg?.title ?? fallback?.title ?? `${label} circular`,
    url,
    domain: domainOf(url),
    status: synthetic ? "DEMO_SNAPSHOT" : "LIVE",
    section: e.section,
    excerpt: e.text,
    document_id: reg?.document_id ?? null,
    reference: reg?.reference ?? null,
    pdf_url: !synthetic && isReal(reg?.pdf_url) ? reg!.pdf_url : null,
    favicon_url: faviconFor(domainOf(url)),
    retrieved_at: reg?.fetched_at ?? null,
  }));
}

/** Policy excerpts → one source per (doc, section); GitHub file when the run recorded it, workspace route always. */
export function policySources(policy: PolicyEvidence[], sources: Record<string, PolicySource> | undefined, titles?: Record<string, string>): Source[] {
  const seen = new Set<string>();
  return policy
    .filter((e) => {
      const k = `${e.doc_id}#${e.section}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((e) => {
      const ps = sources?.[e.doc_id];
      const url = isReal(ps?.url) ? ps!.url : null;
      return {
        id: `pol-${e.doc_id}-${e.section}`,
        kind: "policy" as const,
        label: url ? "GitHub" : "Policy repository",
        title: titles?.[e.doc_id] ?? e.doc_id,
        url,
        domain: domainOf(url),
        status: "INTERNAL" as const,
        section: e.section,
        excerpt: e.text,
        document_id: e.doc_id,
        repository: ps?.repo ?? null,
        path: ps?.path ?? null,
        workspace_href: `/dashboard/policies?open=${encodeURIComponent(e.doc_id)}`,
        favicon_url: faviconFor(domainOf(url)),
      };
    });
}

/** Chunks Azure AI Search returned for this analysis — retrieval results, not evidence, so they carry rank/score and no external URL. */
export function retrievalSources(analysis: Pick<AnalysisRecord, "retrieved_chunks" | "metrics"> | null | undefined, sources?: Record<string, PolicySource>): Source[] {
  const backend = analysis?.metrics?.retrieval?.backend;
  const label = backend === "azure-ai-search" ? "Azure AI Search" : backend ? "Local hybrid index" : "Retrieval";
  return (analysis?.retrieved_chunks ?? []).map((c, i) => ({
    id: `ret-${c.chunk_id}`,
    kind: "retrieval" as const,
    label,
    title: c.title,
    url: null,
    domain: null,
    status: "RETRIEVED" as const,
    section: c.section,
    excerpt: c.text,
    document_id: c.doc_id,
    repository: sources?.[c.doc_id]?.repo ?? null,
    path: c.path,
    commit_sha: c.commit_sha ?? null,
    rank: i + 1,
    score: c.score,
    workspace_href: `/dashboard/policies?open=${encodeURIComponent(c.doc_id)}`,
  }));
}

/** Everything an Ask answer card can cite, from the card the backend built (it carries the persisted provenance). */
export function cardSources(card: DocCard): Source[] {
  return [
    ...regulatorySources(card.regulatory_evidence, card.regulatory_source, { label: card.source, url: card.url, title: card.title }),
    ...policySources(card.policy_evidence, card.policy_sources),
  ];
}

export function sourceCounts(sources: Source[]) {
  const by = (k: SourceKind) => sources.filter((s) => s.kind === k).length;
  return { total: sources.length, regulatory: by("regulator"), internal: by("policy"), retrieved: by("retrieval"), web: by("web") };
}
